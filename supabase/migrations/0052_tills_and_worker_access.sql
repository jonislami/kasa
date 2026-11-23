-- =====================================================================
-- 0052 – Tills, who may work on them, and the report of a till.
-- The business pays for every till linked with ATK through KontoSef; several workers may work on one till, each with
-- their own PIN, so every coupon shows who issued it.
-- 1. Approval makes ONE till per unit (not the number asked in the form: that stays as information). An extra till
--    is asked by the owner for a chosen unit (register_applications.unit_id) or added by the platform admin in a
--    unit (platform_register_add); either way the licence grows to the number of tills.
-- 2. Access per till: registers.workers_restricted = false → every worker of the business (as before);
--    true → only the workers in register_workers. Owners and managers may always use every till.
--    The PIN screen of a device lists only the workers allowed on its till, and pin_check refuses the others
--    ('no_access'). The units chosen on workers in 0050 become the access lists of the tills of those units.
-- 3. The report of one till: report_summary(p_from, p_to, p_unit, p_register) – totals and the sales of every
--    worker on it.
-- Existing data: tills stay open to every worker unless 0050 had limited them by unit.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2. Access per till
-- ---------------------------------------------------------------------
alter table public.registers add column if not exists workers_restricted boolean not null default false;

create table if not exists public.register_workers (
  register_id uuid not null references public.registers (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  primary key (register_id, user_id)
);
create index if not exists register_workers_user_idx on public.register_workers (user_id);
alter table public.register_workers enable row level security;
drop policy if exists register_workers_read on public.register_workers;
create policy register_workers_read on public.register_workers for select to authenticated
  using (business_id = public.current_business_id() or public.is_platform_admin());
grant select on public.register_workers to authenticated;

create or replace function public._register_access(p_register uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.role in ('admin', 'manager'))
      or not coalesce((select r.workers_restricted from public.registers r where r.id = p_register), false)
      or exists (select 1 from public.register_workers w where w.register_id = p_register and w.user_id = p_user)
$$;

create or replace function public._device_user_access(p_device uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public._register_access(d.register_id, p_user) from public.devices d where d.id = p_device and d.register_id is not null), true)
$$;
revoke execute on function public._register_access(uuid, uuid), public._device_user_access(uuid, uuid) from public, anon, authenticated;

-- 0050 → 0052: a till of a unit some workers were not chosen for gets an access list with the workers of that unit
-- and the workers of every unit (so who could use it before still can)
with t as (
  select r.id as register_id, r.business_id, r.unit_id
    from public.registers r
   where r.active and r.unit_id is not null and not r.workers_restricted
     and exists (select 1 from public.profiles q where q.business_id = r.business_id and q.active and q.role = 'worker'
                   and cardinality(q.unit_ids) > 0 and not (r.unit_id = any (q.unit_ids)))
), x as (
  update public.registers r set workers_restricted = true from t where r.id = t.register_id returning r.id
)
insert into public.register_workers (register_id, user_id, business_id)
select t.register_id, p.id, t.business_id
  from t join public.profiles p on p.business_id = t.business_id
 where p.active and p.role = 'worker' and (cardinality(p.unit_ids) = 0 or t.unit_id = any (p.unit_ids))
on conflict do nothing;

-- who may change the access of a till: the platform admin, or the owner / manager of its business
create or replace function public._can_manage_register(p_register uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.registers where id = p_register;
  if v_business is null then raise exception 'Arka nuk u gjet' using errcode = 'P0002'; end if;
  if public.is_platform_admin() then return v_business; end if;
  if public.current_business_id() = v_business and public.is_manager() then return v_business; end if;
  raise exception 'Vetëm pronari, menaxheri ose administratori' using errcode = '42501';
end $$;
revoke execute on function public._can_manage_register(uuid) from public, anon, authenticated;

create or replace function public.register_access(p_register uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._can_manage_register(p_register);
  r public.registers;
begin
  select * into r from public.registers where id = p_register;
  return jsonb_build_object(
    'register', jsonb_build_object('id', r.id, 'name', r.name, 'unit', (select u.name from public.business_units u where u.id = r.unit_id)),
    'restricted', r.workers_restricted,
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'worker_no', p.worker_no,
                                          'has_pin', p.pin_hash is not null,
                                          'allowed', not r.workers_restricted or exists (select 1 from public.register_workers w where w.register_id = r.id and w.user_id = p.id))
                       order by p.full_name)
        from public.profiles p
       where p.business_id = v_business and p.active and p.role = 'worker'), '[]'::jsonb));
end $$;

-- give or take one worker's access to one till (the first change turns the "every worker" till into a list)
create or replace function public.register_access_set(p_register uuid, p_user uuid, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._can_manage_register(p_register);
  r public.registers;
  v_name text;
begin
  select full_name into v_name from public.profiles where id = p_user and business_id = v_business and role = 'worker';
  if v_name is null then raise exception 'Punëtori nuk u gjet' using errcode = 'P0002'; end if;
  select * into r from public.registers where id = p_register for update;
  if not r.workers_restricted then
    insert into public.register_workers (register_id, user_id, business_id, created_by)
    select r.id, p.id, v_business, auth.uid() from public.profiles p
     where p.business_id = v_business and p.active and p.role = 'worker'
    on conflict do nothing;
    update public.registers set workers_restricted = true where id = r.id;
  end if;
  if p_allowed then
    insert into public.register_workers (register_id, user_id, business_id, created_by) values (r.id, p_user, v_business, auth.uid())
    on conflict do nothing;
  else
    delete from public.register_workers where register_id = r.id and user_id = p_user;
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'register_access', 'register', r.id::text,
          jsonb_build_object('register', r.name, 'worker', v_name, 'allowed', p_allowed));
end $$;

-- back to "every worker of the business"
create or replace function public.register_access_open(p_register uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._can_manage_register(p_register);
begin
  update public.registers set workers_restricted = false where id = p_register;
  delete from public.register_workers where register_id = p_register;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'register_access', 'register', p_register::text, jsonb_build_object('open', true));
end $$;

-- the PIN screen: the workers allowed on the device's till (owners / managers always)
create or replace function public.pin_device_workers(p_device uuid, p_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._device_business(p_device, p_secret);
  v_register uuid;
  v_unit uuid;
begin
  if v_business is null then
    return null;
  end if;
  select r.id, r.unit_id into v_register, v_unit
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
        and (v_register is null or public._register_access(v_register, p.id))
    ), '[]'::jsonb)
  );
end $$;

-- the PIN sign-in refuses a worker who has no access to the device's till
do $$
declare
  v_def text := pg_get_functiondef('public.pin_check(uuid,text,uuid,text)'::regprocedure);
  v_old text := 'if v_p.pin_hash is null then';
  v_new text := 'if not public._device_user_access(p_device, p_user) then' || chr(10)
             || '    return jsonb_build_object(''ok'', false, ''error'', ''no_access'');' || chr(10)
             || '  end if;' || chr(10)
             || '  if v_p.pin_hash is null then';
begin
  if position('_device_user_access' in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception '0052: pin_check – the PIN check was not found once';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. One till per unit at approval; extra tills in a chosen unit
-- ---------------------------------------------------------------------
alter table public.register_applications add column if not exists unit_id uuid references public.business_units (id) on delete set null;

-- an approved unit of the business, or null
create or replace function public._business_unit(p_business uuid, p_unit text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from public.business_units u
   where u.business_id = p_business and u.status = 'approved' and u.id::text = nullif(trim(coalesce(p_unit, '')), '')
$$;
revoke execute on function public._business_unit(uuid, text) from public, anon, authenticated;

-- the licence covers at least the active tills
create or replace function public._license_cover_registers(p_business uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.business_licenses
     set max_devices = (select count(*) from public.registers r where r.business_id = p_business and r.active), updated_at = now()
   where business_id = p_business and max_devices < (select count(*) from public.registers r where r.business_id = p_business and r.active)
$$;
revoke execute on function public._license_cover_registers(uuid) from public, anon, authenticated;

do $$
declare
  r record;
  v_def text;
  v_count int;
begin
  for r in
    select * from (values
      -- approval: one till per unit, one for a business without units
      ('public._ensure_registers(uuid)', 'while v_have < u.registers loop', 'while v_have < 1 loop'),
      ('public._ensure_registers(uuid)',
       'select least(20, greatest(1, coalesce((b.registration->>''registers'')::int, 1))) into v_want from public.businesses b where b.id = p_business;',
       'v_want := 1;'),
      -- the owner asks for a till in a unit (required when the business has several units)
      ('public.register_application_submit(jsonb)',
       'then raise exception ''Shkruaj emrin e arkës'' using errcode = ''22023''; end if;',
       'then raise exception ''Shkruaj emrin e arkës'' using errcode = ''22023''; end if;' || chr(10)
       || '  if public._business_unit(v_b, p->>''unit_id'') is null and (select count(*) from public.business_units u where u.business_id = v_b and u.status = ''approved'') > 1 then' || chr(10)
       || '    raise exception ''Zgjidh njësinë ku do të jetë arka'' using errcode = ''22023'';' || chr(10)
       || '  end if;'),
      ('public.register_application_submit(jsonb)',
       'insert into public.register_applications (business_id, name, location, device_type, printer, paper_width, fiscal, contact, note, created_by)',
       'insert into public.register_applications (business_id, name, location, device_type, printer, paper_width, fiscal, contact, note, created_by, unit_id)'),
      ('public.register_application_submit(jsonb)',
       'nullif(trim(p->>''contact''), ''''), nullif(trim(p->>''note''), ''''), auth.uid())',
       'nullif(trim(p->>''contact''), ''''), nullif(trim(p->>''note''), ''''), auth.uid(), public._business_unit(v_b, p->>''unit_id''))'),
      ('public.register_application_submit(jsonb)',
       'status = ''pending''',
       'status = ''pending'', unit_id = coalesce(public._business_unit(v_b, p->>''unit_id''), unit_id)'),
      -- the admin approves: the till is made (or a free one taken) in that unit, and the licence covers it
      ('public.platform_register_application_decide(uuid,text,text,uuid)',
       'order by r.created_at limit 1;',
       'and (a.unit_id is null or r.unit_id = a.unit_id) order by r.created_at limit 1;'),
      ('public.platform_register_application_decide(uuid,text,text,uuid)',
       'insert into public.registers (business_id, name) values (a.business_id, left(a.name, 60)) returning id into v_reg;',
       'insert into public.registers (business_id, name, unit_id) values (a.business_id, left(a.name, 60), a.unit_id) returning id into v_reg;'),
      ('public.platform_register_application_decide(uuid,text,text,uuid)',
       'update public.registers set name = left(a.name, 60) where id = v_reg;',
       'update public.registers set name = left(a.name, 60), unit_id = coalesce(a.unit_id, unit_id) where id = v_reg;'),
      ('public.platform_register_application_decide(uuid,text,text,uuid)',
       'update public.register_applications',
       'if p_action = ''approve'' then perform public._license_cover_registers(a.business_id); end if;' || chr(10)
       || '  update public.register_applications')
    ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.new_text in v_def) > 0 then
      continue; -- already changed
    end if;
    v_count := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    if v_count <> 1 then
      raise exception '0052: % – "%" found % times, expected 1', r.fn, r.old_text, v_count;
    end if;
    execute replace(v_def, r.old_text, r.new_text);
  end loop;
end $$;

-- the platform admin activates one more till in a unit
create or replace function public.platform_register_add(p_business uuid, p_unit uuid, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.business_units;
  v_n int;
  v_multi boolean;
  v_name text;
  v_id uuid;
begin
  perform public._require_platform_admin();
  if not exists (select 1 from public.businesses where id = p_business and status = 'active') then
    raise exception 'Arka shtohet vetëm te biznesi aktiv' using errcode = '22023';
  end if;
  if p_unit is not null then
    select * into u from public.business_units where id = p_unit and business_id = p_business and status = 'approved';
    if u.id is null then raise exception 'Njësia nuk u gjet ose nuk është aprovuar' using errcode = 'P0002'; end if;
  elsif (select count(*) from public.business_units where business_id = p_business and status = 'approved') > 1 then
    raise exception 'Zgjidh njësinë e arkës' using errcode = '22023';
  else
    select * into u from public.business_units where business_id = p_business and status = 'approved' limit 1;
  end if;
  select count(*) > 1 into v_multi from public.business_units where business_id = p_business and status = 'approved';
  select count(*) + 1 into v_n from public.registers r where r.business_id = p_business and r.active and r.unit_id is not distinct from u.id;
  v_name := coalesce(nullif(trim(p_name), ''), case when v_multi then u.name || ' · Arka ' || v_n else 'Arka ' || v_n end);
  insert into public.registers (business_id, name, unit_id) values (p_business, left(v_name, 60), u.id) returning id into v_id;
  perform public._license_cover_registers(p_business);
  insert into public.business_events (business_id, action, note, by_user) values (p_business, 'register_added', v_name, auth.uid());
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), 'register_added', 'register', v_id::text, jsonb_build_object('business', p_business, 'name', v_name, 'unit', u.name));
  return v_id;
end $$;

-- the units of a business with their tills, for the platform admin
create or replace function public.platform_business_tills(p_business uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_platform_admin();
  return jsonb_build_object(
    'max_devices', (public._license_state(p_business)->>'max_devices')::int,
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'status', u.status) order by u.sort, u.created_at)
                         from public.business_units u where u.business_id = p_business), '[]'::jsonb),
    'registers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'name', r.name, 'unit_id', r.unit_id, 'active', r.active, 'restricted', r.workers_restricted,
               'workers', (select count(*) from public.register_workers w where w.register_id = r.id),
               'devices', (select count(*) from public.devices d where d.register_id = r.id and d.active))
             order by r.created_at, r.name)
        from public.registers r where r.business_id = p_business), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 3. The report of one till
-- ---------------------------------------------------------------------
create or replace function public._report_unit_ok(p_register uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public._report_unit() is null
          or exists (select 1 from public.registers r where r.id = p_register and r.unit_id = public._report_unit()))
     and (nullif(current_setting('kasa.report_register', true), '') is null
          or p_register::text = current_setting('kasa.report_register', true))
$$;
revoke execute on function public._report_unit_ok(uuid) from public, anon, authenticated;

create or replace function public.report_summary(p_from date, p_to date, p_unit uuid, p_register uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_register is not null and not exists (select 1 from public.registers r where r.id = p_register and r.business_id = public.current_business_id()) then
    raise exception 'Arka nuk u gjet' using errcode = 'P0002';
  end if;
  perform set_config('kasa.report_register', coalesce(p_register::text, ''), true);
  v := public.report_summary(p_from, p_to, p_unit);
  perform set_config('kasa.report_register', '', true);
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.register_access(uuid), public.register_access_set(uuid, uuid, boolean), public.register_access_open(uuid),
  public.platform_register_add(uuid, uuid, text), public.platform_business_tills(uuid),
  public.report_summary(date, date, uuid, uuid) from public, anon;
grant execute on function public.register_access(uuid), public.register_access_set(uuid, uuid, boolean), public.register_access_open(uuid),
  public.platform_register_add(uuid, uuid, text), public.platform_business_tills(uuid),
  public.report_summary(date, date, uuid, uuid) to authenticated;
