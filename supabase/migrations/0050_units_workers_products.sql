-- =====================================================================
-- 0050 – Workers, products and reports by unit (a business with more than one unit).
-- 1. A worker works in all units (empty list, as before) or in the units chosen for them. The PIN screen of a till
--    shows the workers of that till's unit; owners and managers show on every till (they approve cancels).
-- 2. A product sells in all units (empty list, as before) or only in the chosen units; its variants follow it.
--    The till of a unit shows only its products. One catalog, one price.
-- 3. Raportet and Puna e punëtorëve can show one unit: report_summary(p_from, p_to, p_unit) and
--    workers_comparison(p_from, p_to, p_unit). The existing two-argument functions keep working unchanged.
-- Existing data does not change (empty list = every unit).
-- =====================================================================

alter table public.profiles add column if not exists unit_ids uuid[] not null default '{}';
alter table public.products add column if not exists unit_ids uuid[] not null default '{}';

-- the units of the caller's business among the given ones (others are dropped)
create or replace function public._own_units(p_units uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(u.id order by u.sort, u.created_at), '{}')
    from public.business_units u
   where u.business_id = public.current_business_id() and u.id = any (coalesce(p_units, '{}'))
$$;
revoke execute on function public._own_units(uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Workers
-- ---------------------------------------------------------------------
create or replace function public.set_worker_units(p_user uuid, p_units uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_units uuid[] := public._own_units(p_units);
  v_name text;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  update public.profiles set unit_ids = v_units where id = p_user and business_id = v_business returning full_name into v_name;
  if v_name is null then raise exception 'Punëtori nuk u gjet' using errcode = 'P0002'; end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'settings_change', 'profile', p_user::text,
          jsonb_build_object('section', 'worker_units', 'name', v_name,
                             'units', (select coalesce(jsonb_agg(u.name), '[]'::jsonb) from public.business_units u where u.id = any (v_units))));
  return v_units;
end $$;

-- the PIN screen: the workers of the device's unit (and everyone with no unit); owners / managers always
create or replace function public.pin_device_workers(p_device uuid, p_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._device_business(p_device, p_secret);
  v_unit uuid;
begin
  if v_business is null then
    return null;
  end if;
  select r.unit_id into v_unit
    from public.devices d join public.registers r on r.id = d.register_id
   where d.id = p_device and d.business_id = v_business;
  return jsonb_build_object(
    'business', (select jsonb_build_object('id', b.id, 'name', b.name, 'type', b.type) from public.businesses b where b.id = v_business),
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role,
                                          'has_pin', p.pin_hash is not null,
                                          'locked', coalesce(p.pin_locked_until > now(), false))
                       order by case p.role when 'worker' then 0 else 1 end, p.full_name)
      from public.profiles p
      where p.business_id = v_business and p.active
        and (v_unit is null or p.role in ('admin', 'manager') or cardinality(p.unit_ids) = 0 or v_unit = any (p.unit_ids))
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 2. Products
-- ---------------------------------------------------------------------
create or replace function public.set_product_units(p_product uuid, p_units uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_units uuid[] := public._own_units(p_units);
  v_name text;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri mund të ndryshojë produktet' using errcode = '42501';
  end if;
  update public.products set unit_ids = v_units, updated_at = now()
   where id = p_product and business_id = v_business returning name into v_name;
  if v_name is null then raise exception 'Produkti nuk u gjet' using errcode = 'P0002'; end if;
  -- the variants (size × colour) sell where their product sells
  update public.products set unit_ids = v_units, updated_at = now() where parent_id = p_product and business_id = v_business;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'product_update', 'product', p_product::text,
          jsonb_build_object('name', v_name,
                             'units', (select coalesce(jsonb_agg(u.name), '[]'::jsonb) from public.business_units u where u.id = any (v_units))));
  return v_units;
end $$;

-- ---------------------------------------------------------------------
-- 3. Reports by unit
-- ---------------------------------------------------------------------
-- the unit a report is limited to (set by the three-argument functions below, for this transaction only)
create or replace function public._report_unit()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('kasa.report_unit', true), '')::uuid
$$;

create or replace function public._report_unit_ok(p_register uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._report_unit() is null
      or exists (select 1 from public.registers r where r.id = p_register and r.unit_id = public._report_unit())
$$;
revoke execute on function public._report_unit(), public._report_unit_ok(uuid) from public, anon, authenticated;

-- the sales the two report functions read get the unit condition (each change must be found, or the migration stops)
do $$
declare
  r record;
  v_def text;
  v_new text;
  v_count int;
begin
  for r in
    select * from (values
      ('public.report_summary(date,date)', 'from public.sales where business_id = v_business and sale_date',
       'from public.sales where business_id = v_business and public._report_unit_ok(register_id) and sale_date', 4),
      ('public.report_summary(date,date)', 'where s.business_id = v_business and s.sale_date',
       'where s.business_id = v_business and public._report_unit_ok(s.register_id) and s.sale_date', 3),
      ('public._workers_comparison_core(date,date)', 'from public.sales where business_id = v_business and sale_date',
       'from public.sales where business_id = v_business and public._report_unit_ok(register_id) and sale_date', 1),
      ('public._workers_comparison_core(date,date)', 'where p.business_id = v_business and (p.active or x.worker_id is not null)',
       'where p.business_id = v_business and (p.active or x.worker_id is not null)'
       || ' and (public._report_unit() is null or x.worker_id is not null'
       || ' or (p.role = ''worker'' and (cardinality(p.unit_ids) = 0 or public._report_unit() = any (p.unit_ids))))', 1)
    ) as t(fn, old_text, new_text, expected)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.new_text in v_def) > 0 then
      continue; -- already changed (the migration runs a second time)
    end if;
    v_count := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    if v_count <> r.expected then
      raise exception '0050: % – "%" found % times, expected %', r.fn, r.old_text, v_count, r.expected;
    end if;
    v_new := replace(v_def, r.old_text, r.new_text);
    execute v_new;
  end loop;
end $$;

create or replace function public.report_summary(p_from date, p_to date, p_unit uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_unit is not null and not exists (select 1 from public.business_units u where u.id = p_unit and u.business_id = public.current_business_id()) then
    raise exception 'Njësia nuk u gjet' using errcode = 'P0002';
  end if;
  perform set_config('kasa.report_unit', coalesce(p_unit::text, ''), true);
  v := public.report_summary(p_from, p_to);
  perform set_config('kasa.report_unit', '', true);
  return v;
end $$;

create or replace function public.workers_comparison(p_from date, p_to date, p_unit uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_unit is not null and not exists (select 1 from public.business_units u where u.id = p_unit and u.business_id = public.current_business_id()) then
    raise exception 'Njësia nuk u gjet' using errcode = 'P0002';
  end if;
  perform set_config('kasa.report_unit', coalesce(p_unit::text, ''), true);
  v := public.workers_comparison(p_from, p_to);
  perform set_config('kasa.report_unit', '', true);
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.set_worker_units(uuid, uuid[]), public.set_product_units(uuid, uuid[]),
  public.report_summary(date, date, uuid), public.workers_comparison(date, date, uuid) from public, anon;
grant execute on function public.set_worker_units(uuid, uuid[]), public.set_product_units(uuid, uuid[]),
  public.report_summary(date, date, uuid), public.workers_comparison(date, date, uuid) to authenticated;
