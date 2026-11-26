-- OPTIONAL: run the price tick every minute from Supabase instead of Vercel Cron
-- (Vercel's Hobby plan only allows daily cron jobs; per-minute needs Pro).
-- 1) Replace the two placeholders below.
-- 2) Run this once in Supabase → SQL Editor.
-- To stop:  select cron.unschedule('gold-tick');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the secret in Vault rather than in the job text.
select vault.create_secret('YOUR_CRON_SECRET', 'gold_cron_secret');

select cron.schedule(
  'gold-tick',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-APP.vercel.app/api/cron/tick',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gold_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $$
);

-- Daily AI summary at 07:00 Riyadh (04:00 UTC)
select cron.schedule(
  'gold-daily-summary',
  '0 4 * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-APP.vercel.app/api/cron/daily-summary',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gold_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $$
);

-- Optional housekeeping: drop cron run history older than 3 days
select cron.schedule('gold-cron-cleanup', '17 3 * * *', $$ delete from cron.job_run_details where end_time < now() - interval '3 days' $$);
