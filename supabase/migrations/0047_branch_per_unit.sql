-- =====================================================================
-- 0047 – Branch ID (numri i njësisë nga ATK) for each unit of a business.
-- A business with two shops has two units; each unit has its own Branch ID and address, and every register belongs
-- to a unit. A register fiscalizes with the Branch ID of its unit; a register without a unit (older businesses)
-- keeps the business-wide Branch ID of Fiskalizimi → Hapi 1, so nothing that works today changes.
-- =====================================================================
alter table public.business_units add column if not exists fiscal_branch_id bigint;
create unique index if not exists business_units_branch on public.business_units (business_id, fiscal_branch_id) where fiscal_branch_id is not null;

-- a business with one unit: the unit takes the Branch ID already saved for the business
update public.business_units u
   set fiscal_branch_id = b.fiscal_branch_id
  from public.businesses b
 where u.business_id = b.id and b.fiscal_branch_id is not null and u.fiscal_branch_id is null
   and (select count(*) from public.business_units x where x.business_id = b.id) = 1;

-- the Branch ID a register fiscalizes with
create or replace function public._register_branch(p_register uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(u.fiscal_branch_id, b.fiscal_branch_id)
    from public.registers r
    join public.businesses b on b.id = r.business_id
    left join public.business_units u on u.id = r.unit_id
   where r.id = p_register
$$;
revoke execute on function public._register_branch(uuid) from public, anon, authenticated;

-- fiscal context: the register's unit (Branch ID, name, address) when it has one
create or replace function public.fiscal_context(p_register uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  b public.businesses;
  r public.registers;
  u public.business_units;
  c public.fiscal_config;
begin
  if v_business is null then
    raise exception 'Nuk je i kyçur' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = v_business;
  select * into c from public.fiscal_config where id = 1;
  if p_register is not null then
    select * into r from public.registers where id = p_register and business_id = v_business;
    if r.unit_id is not null then
      select * into u from public.business_units where id = r.unit_id and business_id = v_business;
    end if;
  end if;
  return jsonb_build_object(
    'nui', b.nui, 'fiscal_number', b.fiscal_number,
    'branch_id', coalesce(u.fiscal_branch_id, b.fiscal_branch_id), 'env', b.fiscal_env,
    'location', coalesce(nullif(trim(u.city), ''), nullif(trim(b.city), ''), ''), 'business_name', b.name,
    'unit_saved_at', b.fiscal_unit_saved_at,
    'unit', case when u.id is null then null else jsonb_build_object(
      'id', u.id, 'name', u.name, 'unit_no', u.unit_no, 'address', u.address, 'city', u.city, 'branch_id', u.fiscal_branch_id) end,
    'application_id', case b.fiscal_env when 'prod' then c.application_id_prod else c.application_id_test end,
    'register', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'name', r.name, 'pos_id', r.atk_pos_id, 'status', r.fiscal_status, 'device_id', r.fiscal_device_id,
      'platform', r.fiscal_platform, 'env', r.fiscal_env, 'registered_at', r.fiscal_registered_at,
      'coupon_seq', greatest(r.coupon_seq, coalesce((select max(f.coupon_seq) from public.fiscal_coupons f where f.register_id = r.id), 0)),
      'last_sent_at', r.fiscal_last_sent_at,
      'pending', (select count(*) from public.fiscal_coupons f where f.register_id = r.id and f.status <> 'sent'),
      'oldest_pending', (select min(f.issued_at) from public.fiscal_coupons f where f.register_id = r.id and f.status <> 'sent'))
    end
  );
end $$;

-- owner page: the units with their Branch ID
create or replace function public.fiscal_units()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'name', u.name, 'unit_no', u.unit_no, 'address', u.address, 'city', u.city,
      'branch_id', u.fiscal_branch_id,
      'registers', (select count(*) from public.registers r where r.unit_id = u.id),
      'registered', (select count(*) from public.registers r where r.unit_id = u.id and r.fiscal_status = 'registered'))
      order by u.sort, u.created_at), '[]'::jsonb)
    from public.business_units u where u.business_id = v_business
  );
end $$;
revoke execute on function public.fiscal_units() from public, anon;
grant execute on function public.fiscal_units() to authenticated;

create or replace function public.fiscal_set_unit_branch(p_unit uuid, p_branch bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  u public.business_units;
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  select * into u from public.business_units where id = p_unit and business_id = v_business for update;
  if not found then raise exception 'Njësia nuk u gjet' using errcode = 'P0002'; end if;
  if p_branch is not null and p_branch <= 0 then
    raise exception 'Shkruaj numrin e njësisë (Branch ID) nga ATK' using errcode = '22023';
  end if;
  if u.fiscal_branch_id is not distinct from p_branch then return; end if;
  -- a registered register keeps its certificate only for the Branch ID it was issued for
  if exists (select 1 from public.registers r where r.unit_id = u.id and r.fiscal_status = 'registered') then
    raise exception 'Kjo njësi ka arka të regjistruara në ATK. Çregjistroji ato para se të ndryshosh numrin e njësisë.' using errcode = '42501';
  end if;
  if p_branch is not null and exists (select 1 from public.business_units x where x.business_id = v_business and x.id <> u.id and x.fiscal_branch_id = p_branch) then
    raise exception 'Ky numër njësie është te një njësi tjetër' using errcode = '23505';
  end if;
  update public.business_units set fiscal_branch_id = p_branch, updated_at = now() where id = u.id;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'fiscal_unit', 'business_unit', u.id::text, jsonb_build_object('unit', u.name, 'branch_id', p_branch));
end $$;
revoke execute on function public.fiscal_set_unit_branch(uuid, bigint) from public, anon;
grant execute on function public.fiscal_set_unit_branch(uuid, bigint) to authenticated;

-- a register can be moved to another unit while it is not registered at ATK
create or replace function public.fiscal_set_register_unit(p_register uuid, p_unit uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  r public.registers;
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  select * into r from public.registers where id = p_register and business_id = v_business for update;
  if not found then raise exception 'Arka nuk u gjet' using errcode = 'P0002'; end if;
  if p_unit is not null and not exists (select 1 from public.business_units u where u.id = p_unit and u.business_id = v_business) then
    raise exception 'Njësia nuk u gjet' using errcode = 'P0002';
  end if;
  if r.unit_id is not distinct from p_unit then return; end if;
  if r.fiscal_status = 'registered' then
    raise exception 'Arka është e regjistruar në ATK. Çregjistroje para se ta kalosh në njësi tjetër.' using errcode = '42501';
  end if;
  update public.registers set unit_id = p_unit where id = r.id;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'register_unit', 'register', r.id::text, jsonb_build_object('register', r.name, 'unit_id', p_unit));
end $$;
revoke execute on function public.fiscal_set_register_unit(uuid, uuid) from public, anon;
grant execute on function public.fiscal_set_register_unit(uuid, uuid) to authenticated;

-- Hapi 1: the business-wide Branch ID is now only for registers without a unit (it may stay empty when every
-- register has a unit with its own Branch ID)
do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.fiscal_save_unit(jsonb)'::regprocedure);
  d := replace(d, '  if v_branch is null or v_branch <= 0 then', '  if v_branch is not null and v_branch <= 0 then');
  execute d;

  -- registers list: unit and the Branch ID the register uses
  d := pg_get_functiondef('public.fiscal_registers()'::regprocedure);
  if position('''unit_id''' in d) = 0 then
    d := replace(d, '''coupon_seq'', r.coupon_seq,',
      '''coupon_seq'', r.coupon_seq, ''unit_id'', r.unit_id, ''unit_name'', (select u.name from public.business_units u where u.id = r.unit_id), ''branch_id'', public._register_branch(r.id),');
    if position('''unit_id''' in d) = 0 then raise exception 'fiscal_registers: coupon_seq not found'; end if;
    execute d;
  end if;

  -- sale_json: the unit of the register (name, number, address) for the coupon header
  d := pg_get_functiondef('public.sale_json(uuid)'::regprocedure);
  if position('''unit''' in d) = 0 then
    d := replace(d, '''register_name'', (select r.name from public.registers r where r.id = s.register_id),',
      '''register_name'', (select r.name from public.registers r where r.id = s.register_id),' || chr(10) ||
      '    ''unit'', (select jsonb_build_object(''name'', u.name, ''unit_no'', u.unit_no, ''address'', u.address, ''city'', u.city) from public.registers r join public.business_units u on u.id = r.unit_id where r.id = s.register_id),');
    if position('''unit''' in d) = 0 then raise exception 'sale_json: register_name not found'; end if;
    execute d;
  end if;
end $$;
