-- RLS + logic assertions. Run by scripts/test-db.sh (as superuser, switching roles).
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------- fixtures --
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@x.test', '{"app_role":"admin","app_status":"active"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'alice@x.test', '{"app_role":"viewer","app_status":"active"}'),
  ('00000000-0000-0000-0000-0000000000b0', 'bob@x.test',   '{"app_role":"viewer","app_status":"active"}'),
  ('00000000-0000-0000-0000-0000000000e0', 'eve@x.test',   '{}'),
  ('00000000-0000-0000-0000-0000000000f0', 'fake@x.test',  '{"app_role":"superuser","app_status":"weird"}');

insert into public.price_ticks (time, spot, bid, ask, source) values
  ('2026-01-05 06:00+00', 2000, 1999.5, 2000.5, 'test'),
  ('2026-01-05 06:30+00', 2010, null, null, 'test'),
  ('2026-01-05 07:10+00', 2005, null, null, 'test'),
  ('2026-01-05 07:50+00', 2020, null, null, 'test');

-- profiles were created by the trigger with safe defaults
do $$
begin
  assert (select role from public.profiles where email = 'admin@x.test') = 'admin', 'admin role';
  assert (select status from public.profiles where email = 'alice@x.test') = 'active', 'alice active';
  assert (select status from public.profiles where email = 'eve@x.test') = 'pending', 'eve pending by default';
  assert (select role from public.profiles where email = 'eve@x.test') = 'viewer', 'eve viewer by default';
  assert (select role || '/' || status from public.profiles where email = 'fake@x.test') = 'viewer/pending', 'bad meta sanitised';
end $$;

-- ------------------------------------------------------------------- alice --
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';

insert into public.alerts (type, direction, threshold) values ('ounce_price', 'above', 2100);
insert into public.alerts (type, direction, threshold, karat, price_side) values ('gram_price', 'below', 250, 21, 'ask');
insert into public.alerts (type, direction, threshold, change_window, mode) values ('pct_change', 'below', 1.5, '24h', 'recurring');

do $$
begin
  assert (select count(*) from public.alerts) = 3, 'alice sees her 3 alerts';
  assert (select count(*) from public.profiles) = 1, 'alice sees only her profile';
  assert (select count(*) from public.price_ticks) = 4, 'active user reads ticks';
  assert (select count(*) from public.settings) = 1, 'active user reads settings';
  assert (select count(*) from public.invites) = 0, 'viewer sees no invites';
  assert (select count(*) from public.price_candles('1 hour', '2026-01-05', '2026-01-06')) = 2, 'candles';
end $$;

-- may not write as someone else
do $$ begin
  insert into public.alerts (user_id, type, direction, threshold)
  values ('00000000-0000-0000-0000-0000000000b0', 'ounce_price', 'above', 1);
  raise exception 'FAIL: inserted alert for bob';
exception when insufficient_privilege then null; end $$;

-- may not escalate role
do $$ begin
  update public.profiles set role = 'admin' where id = auth.uid();
  raise exception 'FAIL: changed own role';
exception when insufficient_privilege then null; end $$;

-- may not write ticks / settings / invites
do $$ begin
  insert into public.price_ticks (spot, source) values (1, 'hack');
  raise exception 'FAIL: inserted tick';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.invites (email) values ('x@y.z');
  raise exception 'FAIL: viewer created invite';
exception when insufficient_privilege then null; end $$;
do $$
declare n int;
begin
  update public.settings set usd_sar = 9 where id = 1;
  get diagnostics n = row_count;
  assert n = 0, 'viewer cannot update settings';
end $$;

-- invalid alert shapes are rejected
do $$ begin
  insert into public.alerts (type, direction, threshold) values ('gram_price', 'above', 10);
  raise exception 'FAIL: gram alert without karat';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.alerts (type, direction, threshold, channels) values ('ounce_price', 'above', 10, array['sms']);
  raise exception 'FAIL: unknown channel';
exception when check_violation then null; end $$;

update public.profiles set display_name = 'Alice' where id = auth.uid();
commit;

-- --------------------------------------------------------------------- bob --
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b0"}';
insert into public.alerts (type, direction, threshold) values ('ounce_price', 'below', 1900);
do $$
declare n int;
begin
  assert (select count(*) from public.alerts) = 1, 'bob sees only his alert';
  update public.alerts set threshold = 1 where user_id <> auth.uid();
  get diagnostics n = row_count;
  assert n = 0, 'bob cannot update alice alerts';
  delete from public.alerts where user_id <> auth.uid();
  get diagnostics n = row_count;
  assert n = 0, 'bob cannot delete alice alerts';
end $$;
commit;

-- ----------------------------------------------------------- eve (pending) --
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e0"}';
do $$ begin
  assert (select count(*) from public.price_ticks) = 0, 'pending user sees no ticks';
  assert (select count(*) from public.settings) = 0, 'pending user sees no settings';
end $$;
do $$ begin
  insert into public.alerts (type, direction, threshold) values ('ounce_price', 'above', 1);
  raise exception 'FAIL: pending user created alert';
exception when insufficient_privilege then null; end $$;
commit;

-- -------------------------------------------------------------------- anon --
begin;
set local role anon;
do $$ begin
  perform count(*) from public.price_ticks;
  raise exception 'FAIL: anon read ticks';
exception when insufficient_privilege then null; end $$;
commit;

-- ------------------------------------------------------------------- admin --
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
insert into public.invites (email, note) values ('new@x.test', 'test');
update public.settings set usd_sar = 3.76 where id = 1;
do $$ begin
  assert (select count(*) from public.alerts) = 4, 'admin sees all alerts';
  assert (select count(*) from public.profiles) = 5, 'admin sees all profiles';
  assert (select usd_sar from public.settings) = 3.76, 'admin updated settings';
  assert (select count(*) from public.invites) = 1, 'admin sees invites';
end $$;
commit;

-- ------------------------------------------------- service role: invites --
begin;
set local role service_role;
insert into public.invites (token, email, max_uses) values ('tok-email', 'Carol@x.test', 1);
insert into public.invites (token, max_uses) values ('tok-open', 2);
insert into public.invites (token, expires_at) values ('tok-old', now() - interval '1 day');
do $$ begin
  assert (select count(*) from public.consume_invite('tok-email', 'someone@x.test')) = 0, 'email mismatch';
  assert (select count(*) from public.consume_invite('tok-email', 'carol@X.test')) = 1, 'email match (case-insensitive)';
  assert (select count(*) from public.consume_invite('tok-email', 'carol@x.test')) = 0, 'single use';
  assert (select count(*) from public.consume_invite('tok-open', 'a@x.test')) = 1, 'open 1';
  assert (select count(*) from public.consume_invite('tok-open', 'b@x.test')) = 1, 'open 2';
  assert (select count(*) from public.consume_invite('tok-open', 'c@x.test')) = 0, 'open exhausted';
  assert (select count(*) from public.consume_invite('tok-old', 'c@x.test')) = 0, 'expired';
end $$;
commit;

-- viewers cannot call consume_invite
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
do $$ begin
  perform public.consume_invite('tok-open', 'z@x.test');
  raise exception 'FAIL: viewer consumed invite';
exception when insufficient_privilege then null; end $$;
commit;

-- candles contents
do $$
declare r record;
begin
  select * into r from public.price_candles('1 hour', '2026-01-05', '2026-01-06') order by bucket limit 1;
  assert r.open = 2000 and r.close = 2010 and r.high = 2010 and r.low = 2000 and r.n = 2, 'first hourly candle OHLC';
end $$;

\echo 'RLS tests OK'
