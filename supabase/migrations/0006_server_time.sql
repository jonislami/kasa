-- =====================================================================
-- 0006 – Server time (phase 7). The app compares the device clock with the server clock
-- (Supabase/Postgres runs on NTP-synchronised UTC time) and warns when the device is off.
-- In phase 9 the same check also uses the time of the ATK server (fiscal coupons need it).
-- =====================================================================

create or replace function public.server_time()
returns timestamptz
language sql
volatile
set search_path = ''
as $$
  select clock_timestamp()
$$;

revoke execute on function public.server_time() from public;
grant execute on function public.server_time() to anon, authenticated;
