-- 60 days of synthetic ticks every 10 minutes ending ~20 min ago, near the
-- current real price so the live fetch passes the sanity check.
insert into public.price_ticks (time, spot, bid, ask, source)
select t,
       round((3500 + 45 * sin(extract(epoch from t) / 86400.0 / 3) + 20 * sin(extract(epoch from t) / 3600.0 / 5) + (extract(epoch from t - (now() - interval '60 days')) / 86400.0))::numeric, 2),
       null, null, 'seed'
from generate_series(now() - interval '60 days', now() - interval '20 minutes', interval '10 minutes') as t;
