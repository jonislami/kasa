-- Optional: automatic monthly report e-mails (Kasa Kontabilist, 0027).
-- On the 2nd of every month at 08:00 (Kosovo time ≈ 06:00/07:00 UTC) the Edge Function acc-notify sends
-- the report of the previous month to the clients of every office that turned "Raporti mujor automatik" on.
--
-- Before running: replace the three values in <...>.
--   <PROJECT_REF>  e.g. slleolfhjpvebleqirdm
--   <ANON_KEY>     Project Settings → API → anon public key (it only lets the request through the gateway)
--   <CRON_SECRET>  the same long random text you saved as the Edge Function secret CRON_SECRET
-- Supabase: Database → Extensions → enable pg_cron and pg_net (or the two lines below).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('acc-monthly-reports') where exists (select 1 from cron.job where jobname = 'acc-monthly-reports');

select cron.schedule(
  'acc-monthly-reports',
  '0 6 2 * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/acc-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := jsonb_build_object('kind', 'cron_monthly')
  );
  $$
);
