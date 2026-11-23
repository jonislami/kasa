-- =====================================================================
-- 0053 – The platform admin removes a till.
-- A till that never sold (no sale, fiscal coupon or shift) is deleted; one with history is deactivated, because its
-- coupons must stay (ATK, 10 years). Either way its devices are left without a till (they ask for one), its unused
-- activation keys are cancelled and the licence follows the number of active tills (the business pays per till).
-- Returns 'deleted' or 'deactivated'.
-- =====================================================================
create or replace function public.platform_register_remove(p_register uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.registers;
  v_result text;
begin
  perform public._require_platform_admin();
  select * into r from public.registers where id = p_register for update;
  if not found then raise exception 'Arka nuk u gjet' using errcode = 'P0002'; end if;

  update public.devices set register_id = null where register_id = r.id;
  update public.activation_keys set revoked_at = now() where register_id = r.id and used_at is null and revoked_at is null;

  if exists (select 1 from public.sales where register_id = r.id)
     or exists (select 1 from public.fiscal_coupons where register_id = r.id)
     or exists (select 1 from public.shifts where register_id = r.id) then
    update public.registers set active = false where id = r.id;
    v_result := 'deactivated';
  else
    delete from public.registers where id = r.id;
    v_result := 'deleted';
  end if;

  update public.business_licenses
     set max_devices = greatest(1, (select count(*) from public.registers x where x.business_id = r.business_id and x.active)), updated_at = now()
   where business_id = r.business_id;

  insert into public.business_events (business_id, action, note, by_user)
  values (r.business_id, 'register_removed', r.name || case when v_result = 'deactivated' then ' (çaktivizuar, ka histori)' else '' end, auth.uid());
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), 'register_removed', 'register', r.id::text, jsonb_build_object('business', r.business_id, 'name', r.name, 'result', v_result));
  return v_result;
end $$;

revoke execute on function public.platform_register_remove(uuid) from public, anon;
grant execute on function public.platform_register_remove(uuid) to authenticated;
