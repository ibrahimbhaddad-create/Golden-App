-- =============================================================================
-- Golden App — initial schema
-- Tables: profiles, invites, settings, price_ticks, alerts, alert_events,
--         push_subscriptions, login_events, source_health, broadcasts,
--         market_summaries
-- Everything is protected by Row Level Security. Writes that must bypass RLS
-- (cron, invites, admin actions) are done server-side with the service role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user (role + status)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null,
  display_name       text,
  role               text not null default 'viewer' check (role in ('admin', 'viewer')),
  status             text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  telegram_chat_id   text,
  telegram_link_code text unique,
  invite_id          uuid,
  created_at         timestamptz not null default now(),
  last_login_at      timestamptz
);
create index profiles_email_idx on public.profiles (lower(email));

-- -----------------------------------------------------------------------------
-- invites: registration is closed except through an invite
--   email null  => open link (anyone with the link, up to max_uses)
--   email set   => only that email can use it
-- -----------------------------------------------------------------------------
create table public.invites (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  email        text,
  role         text not null default 'viewer' check (role in ('admin', 'viewer')),
  auto_approve boolean not null default true,
  max_uses     int not null default 1 check (max_uses between 1 and 1000),
  uses         int not null default 0,
  expires_at   timestamptz not null default now() + interval '7 days',
  revoked      boolean not null default false,
  note         text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- settings: single row, edited by the admin
--   karats: {"24": {"making": SAR/g, "margin_pct": %}, ...}
--   fallback_spread_usd: total bid/ask spread (USD/oz) used when the price
--   source only gives spot.
-- -----------------------------------------------------------------------------
create table public.settings (
  id                  int primary key default 1 check (id = 1),
  usd_sar             numeric(10, 4) not null default 3.75 check (usd_sar > 0),
  karats              jsonb not null default '{
    "24": {"making": 0,  "margin_pct": 0},
    "22": {"making": 15, "margin_pct": 0},
    "21": {"making": 20, "margin_pct": 0},
    "18": {"making": 25, "margin_pct": 0}
  }'::jsonb,
  fallback_spread_usd numeric(10, 4) not null default 1.0 check (fallback_spread_usd >= 0),
  ai_summary_enabled  boolean not null default false,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null
);
insert into public.settings (id) values (1) on conflict do nothing;

-- -----------------------------------------------------------------------------
-- price_ticks: every fetched price (USD per troy ounce)
-- -----------------------------------------------------------------------------
create table public.price_ticks (
  id     bigint generated always as identity primary key,
  time   timestamptz not null default now(),
  spot   numeric(12, 4) not null check (spot > 0),
  bid    numeric(12, 4) check (bid > 0),
  ask    numeric(12, 4) check (ask > 0),
  source text not null
);
create index price_ticks_time_idx on public.price_ticks (time desc);

-- OHLC candles aggregated in the database (keeps payloads small).
-- p_origin aligns buckets; the default is midnight Asia/Riyadh (UTC+3).
create or replace function public.price_candles(
  p_bucket interval,
  p_since  timestamptz,
  p_until  timestamptz default now(),
  p_origin timestamptz default '2000-01-03 00:00:00+03'
)
returns table (bucket timestamptz, open numeric, high numeric, low numeric, close numeric, n int)
language sql
stable
security invoker
set search_path = public
as $$
  select date_bin(p_bucket, t.time, p_origin) as bucket,
         (array_agg(t.spot order by t.time asc))[1]  as open,
         max(t.spot)                                 as high,
         min(t.spot)                                 as low,
         (array_agg(t.spot order by t.time desc))[1] as close,
         count(*)::int                               as n
  from public.price_ticks t
  where t.time >= p_since and t.time < p_until
  group by 1
  order by 1;
$$;

-- -----------------------------------------------------------------------------
-- alerts: per-user alert rules
--   ounce_price : spot USD/oz  above|below threshold
--   gram_price  : SAR/g of a karat (bid|ask|spot) above|below threshold
--   pct_change  : change over change_window; above = rise >= X%, below = drop >= X%
-- -----------------------------------------------------------------------------
create table public.alerts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  type              text not null check (type in ('ounce_price', 'gram_price', 'pct_change')),
  direction         text not null check (direction in ('above', 'below')),
  threshold         numeric(14, 4) not null check (threshold > 0),
  karat             int check (karat in (24, 22, 21, 18)),
  price_side        text not null default 'ask' check (price_side in ('bid', 'ask', 'spot')),
  change_window     text check (change_window in ('1h', '24h', 'day_open')),
  mode              text not null default 'once' check (mode in ('once', 'recurring')),
  cooldown_minutes  int not null default 60 check (cooldown_minutes between 1 and 10080),
  channels          text[] not null default array['push'] check (channels <@ array['push', 'telegram'] and cardinality(channels) > 0),
  active            boolean not null default true,
  note              text check (char_length(note) <= 200),
  last_triggered_at timestamptz,
  trigger_count     int not null default 0,
  created_at        timestamptz not null default now(),
  constraint alerts_shape check (
       (type = 'ounce_price' and karat is null     and change_window is null)
    or (type = 'gram_price'  and karat is not null and change_window is null)
    or (type = 'pct_change'  and karat is null     and change_window is not null and threshold < 100)
  )
);
create index alerts_user_idx on public.alerts (user_id);
create index alerts_active_idx on public.alerts (active) where active;

-- -----------------------------------------------------------------------------
-- alert_events: log of fired alerts
-- -----------------------------------------------------------------------------
create table public.alert_events (
  id             bigint generated always as identity primary key,
  alert_id       uuid references public.alerts (id) on delete set null,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  fired_at       timestamptz not null default now(),
  title          text not null,
  body           text not null,
  observed_value numeric(14, 4),
  delivery       jsonb not null default '{}'::jsonb
);
create index alert_events_user_idx on public.alert_events (user_id, fired_at desc);

-- -----------------------------------------------------------------------------
-- push_subscriptions: Web Push endpoints per device
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- login_events: sign-in audit log (visible to admin)
-- -----------------------------------------------------------------------------
create table public.login_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users (id) on delete cascade,
  email      text not null,
  at         timestamptz not null default now(),
  ip         text,
  user_agent text,
  success    boolean not null default true,
  detail     text
);
create index login_events_at_idx on public.login_events (at desc);

-- -----------------------------------------------------------------------------
-- source_health: circuit breaker per price source
-- -----------------------------------------------------------------------------
create table public.source_health (
  source               text primary key,
  consecutive_failures int not null default 0,
  disabled_until       timestamptz,
  last_error           text,
  last_success_at      timestamptz,
  last_attempt_at      timestamptz
);

-- -----------------------------------------------------------------------------
-- broadcasts: admin notifications sent to all users
-- -----------------------------------------------------------------------------
create table public.broadcasts (
  id           bigint generated always as identity primary key,
  title        text not null,
  body         text not null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  sent_count   int not null default 0,
  failed_count int not null default 0
);

-- -----------------------------------------------------------------------------
-- market_summaries: optional daily AI summary (Claude)
-- -----------------------------------------------------------------------------
create table public.market_summaries (
  day        date primary key,
  content    text not null,
  model      text,
  indicators jsonb,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- Helper functions
-- =============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

-- New auth user => profile. Role/status come from raw_app_meta_data, which only
-- the service role can set (our server, after validating an invite). Anything
-- else (e.g. sign-ups accidentally left open) lands as a pending viewer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text := coalesce(new.raw_app_meta_data ->> 'app_role', 'viewer');
  v_status text := coalesce(new.raw_app_meta_data ->> 'app_status', 'pending');
begin
  if v_role not in ('admin', 'viewer') then v_role := 'viewer'; end if;
  if v_status not in ('pending', 'active', 'suspended') then v_status := 'pending'; end if;

  insert into public.profiles (id, email, role, status, invite_id)
  values (
    new.id,
    coalesce(new.email, ''),
    v_role,
    v_status,
    nullif(new.raw_app_meta_data ->> 'invite_id', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Atomically consume one use of an invite. Returns the invite row or nothing.
create or replace function public.consume_invite(p_token text, p_email text)
returns setof public.invites
language sql
volatile
security definer
set search_path = public
as $$
  update public.invites
     set uses = uses + 1
   where token = p_token
     and not revoked
     and expires_at > now()
     and uses < max_uses
     and (email is null or lower(email) = lower(p_email))
  returning *;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles           enable row level security;
alter table public.invites            enable row level security;
alter table public.settings           enable row level security;
alter table public.price_ticks        enable row level security;
alter table public.alerts             enable row level security;
alter table public.alert_events       enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.login_events       enable row level security;
alter table public.source_health      enable row level security;
alter table public.broadcasts         enable row level security;
alter table public.market_summaries   enable row level security;

-- Anonymous visitors get nothing.
revoke all on all tables in schema public from anon;
revoke execute on function public.is_admin()        from public, anon;
revoke execute on function public.is_active()       from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.consume_invite(text, text) from public, anon, authenticated;
revoke execute on function public.price_candles(interval, timestamptz, timestamptz, timestamptz) from public, anon;

-- Signed-in users: only the privileges each table needs (RLS narrows rows).
revoke all on all tables in schema public from authenticated;
grant select                         on public.profiles           to authenticated;
grant update (display_name)          on public.profiles           to authenticated;
grant select, insert, update, delete on public.invites            to authenticated;
grant select, update                 on public.settings           to authenticated;
grant select                         on public.price_ticks        to authenticated;
grant select, insert, update, delete on public.alerts             to authenticated;
grant select                         on public.alert_events       to authenticated;
grant select, delete                 on public.push_subscriptions to authenticated;
grant select                         on public.login_events       to authenticated;
grant select                         on public.source_health      to authenticated;
grant select                         on public.broadcasts         to authenticated;
grant select                         on public.market_summaries   to authenticated;

grant execute on function public.is_admin()  to authenticated, service_role;
grant execute on function public.is_active() to authenticated, service_role;
grant execute on function public.price_candles(interval, timestamptz, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.consume_invite(text, text) to service_role;

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- invites (admin only)
create policy invites_admin on public.invites
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- settings
create policy settings_select on public.settings
  for select to authenticated
  using (public.is_active());
create policy settings_update on public.settings
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- price_ticks
create policy price_ticks_select on public.price_ticks
  for select to authenticated
  using (public.is_active());

-- alerts: each user manages only their own; admin can read all
create policy alerts_select on public.alerts
  for select to authenticated
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin());
create policy alerts_insert on public.alerts
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active());
create policy alerts_update on public.alerts
  for update to authenticated
  using (user_id = auth.uid() and public.is_active())
  with check (user_id = auth.uid() and public.is_active());
create policy alerts_delete on public.alerts
  for delete to authenticated
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin());

-- alert_events
create policy alert_events_select on public.alert_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- push_subscriptions
create policy push_select on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy push_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

-- login_events
create policy login_events_select on public.login_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- admin-only reads
create policy source_health_admin on public.source_health
  for select to authenticated using (public.is_admin());
create policy broadcasts_admin on public.broadcasts
  for select to authenticated using (public.is_admin());

create policy market_summaries_select on public.market_summaries
  for select to authenticated using (public.is_active());

-- =============================================================================
-- Realtime: stream new price ticks to the app (RLS still applies)
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.price_ticks;
  end if;
end;
$$;
