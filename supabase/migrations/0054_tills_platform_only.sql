-- =====================================================================
-- 0054 – Only the KontoSef platform admin activates / deactivates a till and makes the activation key of a device.
-- The owner (also as "Administrator i biznesit") and managers can no longer:
--   * create a till or change its "active" flag directly (registers insert / update of active) – the platform admin
--     does it (platform_register_add / platform_register_remove, 0052–0053); functions that run as the database
--     owner (approval, the admin's actions) are not affected;
--   * make an activation key (owner_activation_key_create) or add a till themselves (owner_register_add).
-- The platform admin's own functions (platform_activation_key_create, …) are unchanged.
-- =====================================================================
create or replace function public._registers_platform_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- functions that run as the database owner (approval, the platform admin's RPCs) and the service role pass
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_platform_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Arkën e re e aktivizon administratori i KontoSef (Llogaria → Kërko arkë shtesë)' using errcode = '42501';
  end if;
  if new.active is distinct from old.active then
    raise exception 'Arkën e aktivizon ose e çaktivizon vetëm administratori i KontoSef' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists registers_platform_guard on public.registers;
create trigger registers_platform_guard before insert or update of active on public.registers
  for each row execute function public._registers_platform_guard();

revoke execute on function public.owner_activation_key_create(uuid) from public, anon, authenticated;
revoke execute on function public.owner_register_add(text) from public, anon, authenticated;
