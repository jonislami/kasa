-- =====================================================================
-- 0007 – Hardening (Supabase security advisor): the RLS helper functions are not callable
-- without signing in. They returned nothing for anonymous callers anyway; now they are not
-- exposed to them at all. Signed-in users (RLS policies) and the service role keep access.
-- =====================================================================

revoke execute on function public.current_business_id() from public, anon;
revoke execute on function public.current_role_in_business() from public, anon;
revoke execute on function public.is_manager() from public, anon;
revoke execute on function public.is_platform_admin() from public, anon;

grant execute on function public.current_business_id() to authenticated, service_role;
grant execute on function public.current_role_in_business() to authenticated, service_role;
grant execute on function public.is_manager() to authenticated, service_role;
grant execute on function public.is_platform_admin() to authenticated, service_role;
