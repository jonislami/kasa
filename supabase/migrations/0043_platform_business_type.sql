-- =====================================================================
-- 0043 – The platform admin may correct the type of a business (a client who chose "Market" instead of
-- "Kafiterie / Restorant"). The type stays locked for everyone else: businesses_guard lets it change only inside
-- platform_set_business_type, which records who, when, from what to what and why (business_events + audit_log).
-- Products whose ATK category was the default of the old type (market AU, restaurant UR, pharmacy BM, salon SHZ,
-- boutique VM) move to the default of the new type; a category chosen by hand stays. Nothing else changes: sales,
-- stock and coupons keep what they are.
-- =====================================================================
create or replace function public.businesses_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type is distinct from old.type and coalesce(current_setting('kasa.type_change', true), '') <> 'on' then
    raise exception 'Lloji i biznesit nuk mund të ndryshohet' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.platform_set_business_type(p_business uuid, p_type text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  v_old_default text;
  v_new_default text;
  v_products int := 0;
begin
  perform public._require_platform_admin();
  if p_type not in ('market', 'restaurant', 'pharmacy', 'boutique', 'salon') then
    raise exception 'Lloji nuk njihet' using errcode = '22023';
  end if;
  select * into b from public.businesses where id = p_business for update;
  if not found then raise exception 'Biznesi nuk u gjet' using errcode = 'P0002'; end if;
  if b.type::text = p_type then
    return jsonb_build_object('type', p_type, 'changed', false);
  end if;
  v_old_default := public._atk_default_type(b.id);
  perform set_config('kasa.type_change', 'on', true);
  update public.businesses set type = p_type::public.business_type where id = b.id;
  perform set_config('kasa.type_change', '', true);
  v_new_default := public._atk_default_type(b.id);
  if v_old_default is not null and v_new_default is not null and v_old_default <> v_new_default then
    update public.products set atk_type = v_new_default where business_id = b.id and atk_type = v_old_default;
    get diagnostics v_products = row_count;
  end if;
  insert into public.business_events (business_id, action, note, by_user)
  values (b.id, 'type_changed', concat_ws(' · ', b.type::text || ' → ' || p_type, nullif(trim(coalesce(p_note, '')), '')), auth.uid());
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), 'business_type_change', 'business', b.id::text,
          jsonb_build_object('from', b.type, 'to', p_type, 'note', p_note, 'products_recategorized', v_products));
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (b.id, auth.uid(), 'business_type_change', 'business', b.id::text, jsonb_build_object('from', b.type, 'to', p_type, 'by', 'platform'));
  return jsonb_build_object('type', p_type, 'changed', true, 'products_recategorized', v_products,
                            'sales', (select count(*) from public.sales where business_id = b.id));
end $$;

revoke execute on function public.platform_set_business_type(uuid, text, text) from public, anon;
grant execute on function public.platform_set_business_type(uuid, text, text) to authenticated;
