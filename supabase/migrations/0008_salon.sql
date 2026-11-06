-- =====================================================================
-- 0008 – Salon (phase 8a): who performed each line (staff_id), appointments per worker,
-- "Paguaj në arkë" from an appointment, commission on the lines a worker performed.
-- Run after 0001–0007. Safe for every business type (staff defaults to the seller).
--
--   * create_sale accepts items[].staff_id and appointment_id (the core function is kept as
--     _create_sale_core; older clients that send neither keep working)
--   * void / refund lines inherit the staff of the original line (commission goes down too)
--   * appointments: managers see and manage all; a worker sees and manages only their own
--   * commission = sum of the lines the person performed × commission_pct (salon), for
--     work_summary and workers_comparison as well
-- =====================================================================

-- ---------------------------------------------------------------------
-- Who performed the line
-- ---------------------------------------------------------------------
alter table public.sale_items add column if not exists staff_id uuid references auth.users (id);
create index if not exists sale_items_staff_idx on public.sale_items (business_id, staff_id);
alter table public.profiles add column if not exists specialty text;   -- "Flokë, ngjyrosje"
grant select (specialty) on public.profiles to authenticated;

-- Sets staff_id on new sale lines: from the sale being built (create_sale), else the original
-- line (void/refund), else the seller.
create or replace function public.sale_items_staff()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map jsonb;
  v_staff uuid;
begin
  if new.staff_id is not null then
    return new;
  end if;
  if new.ref_item_id is not null then
    select staff_id into v_staff from public.sale_items where id = new.ref_item_id;
  else
    v_map := nullif(current_setting('kasa.sale_staff', true), '')::jsonb;
    if v_map is not null then
      v_staff := nullif(v_map->>(new.position::text), '')::uuid;
    end if;
  end if;
  new.staff_id := coalesce(v_staff, new.worker_id);
  return new;
end $$;

drop trigger if exists sale_items_staff on public.sale_items;
create trigger sale_items_staff before insert on public.sale_items
  for each row execute function public.sale_items_staff();

-- Existing lines: performed by whoever sold them.
do $$ begin
  perform set_config('kasa.building_sale', 'on', true);
  update public.sale_items set staff_id = worker_id where staff_id is null;
end $$;

-- ---------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null default public.current_business_id()
                 references public.businesses (id) on delete cascade,
  staff_id       uuid not null references auth.users (id),
  customer_name  text not null check (length(trim(customer_name)) > 0),
  customer_phone text,
  product_id     uuid references public.products (id) on delete set null,
  service_name   text not null,
  price          numeric(12, 2) not null default 0,
  starts_at      timestamptz not null,
  duration_min   int not null default 30 check (duration_min between 5 and 720),
  status         text not null default 'booked'
                 check (status in ('booked', 'arrived', 'done', 'paid', 'no_show', 'cancelled')),
  sale_id        uuid references public.sales (id) on delete set null,
  note           text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists appointments_day_idx on public.appointments (business_id, starts_at);
create index if not exists appointments_staff_idx on public.appointments (staff_id, starts_at);

alter table public.appointments enable row level security;
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
  using (business_id = public.current_business_id() and (public.is_manager() or staff_id = auth.uid()));
revoke insert, update, delete on public.appointments from anon, authenticated;
revoke all on public.appointments from anon;

-- p: { id?, staff_id, customer_name, customer_phone?, product_id?, service_name?, price?,
--      starts_at, duration_min?, note? } → the appointment
create or replace function public.save_appointment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_manager boolean := public.is_manager();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_staff uuid := coalesce(nullif(p->>'staff_id', '')::uuid, auth.uid());
  v_old public.appointments%rowtype;
  prod public.products%rowtype;
  v_start timestamptz := (p->>'starts_at')::timestamptz;
  v_dur int := coalesce(nullif(p->>'duration_min', '')::int, 0);
  v_name text := nullif(trim(coalesce(p->>'service_name', '')), '');
  v_price numeric := nullif(p->>'price', '')::numeric;
  v_row public.appointments%rowtype;
begin
  if v_business is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  if not v_manager and v_staff <> auth.uid() then
    raise exception 'Mund të caktosh vetëm terminet e tua' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_staff and business_id = v_business and active) then
    raise exception 'Punëtori nuk u gjet' using errcode = 'P0002';
  end if;
  if v_start is null then
    raise exception 'Zgjidh datën dhe orën' using errcode = '22023';
  end if;
  if length(trim(coalesce(p->>'customer_name', ''))) = 0 then
    raise exception 'Shkruaj emrin e klientit' using errcode = '22023';
  end if;
  if nullif(p->>'product_id', '') is not null then
    select * into prod from public.products where id = (p->>'product_id')::uuid and business_id = v_business;
    if not found then
      raise exception 'Shërbimi nuk u gjet' using errcode = 'P0002';
    end if;
    v_name := coalesce(v_name, prod.name);
    v_price := coalesce(v_price, prod.sale_price);
    if v_dur = 0 then v_dur := coalesce(prod.duration_min, 30); end if;
  end if;
  if v_name is null then
    raise exception 'Zgjidh shërbimin' using errcode = '22023';
  end if;
  if v_dur = 0 then v_dur := 30; end if;
  if v_dur < 5 or v_dur > 720 then
    raise exception 'Kohëzgjatja duhet të jetë 5–720 minuta' using errcode = '22023';
  end if;

  if v_id is not null then
    select * into v_old from public.appointments where id = v_id and business_id = v_business for update;
    if not found or (not v_manager and v_old.staff_id <> auth.uid()) then
      raise exception 'Termini nuk u gjet' using errcode = 'P0002';
    end if;
    if v_old.status in ('paid', 'cancelled') then
      raise exception 'Termini i paguar ose i anuluar nuk ndryshohet' using errcode = '22023';
    end if;
  end if;

  -- The same worker cannot have two open appointments at the same time.
  if exists (
    select 1 from public.appointments a
    where a.business_id = v_business and a.staff_id = v_staff and a.id is distinct from v_id
      and a.status in ('booked', 'arrived')
      and a.starts_at < v_start + make_interval(mins => v_dur)
      and a.starts_at + make_interval(mins => a.duration_min) > v_start
  ) then
    raise exception 'Punëtori ka termin tjetër në këtë orë' using errcode = '23P01';
  end if;

  if v_id is null then
    insert into public.appointments (business_id, staff_id, customer_name, customer_phone, product_id, service_name,
                                     price, starts_at, duration_min, note, created_by)
    values (v_business, v_staff, trim(p->>'customer_name'), nullif(trim(coalesce(p->>'customer_phone', '')), ''),
            prod.id, v_name, round(coalesce(v_price, 0), 2), v_start, v_dur, nullif(trim(coalesce(p->>'note', '')), ''), auth.uid())
    returning * into v_row;
  else
    update public.appointments set
      staff_id = v_staff, customer_name = trim(p->>'customer_name'),
      customer_phone = nullif(trim(coalesce(p->>'customer_phone', '')), ''),
      product_id = coalesce(prod.id, case when p ? 'product_id' then null else product_id end),
      service_name = v_name, price = round(coalesce(v_price, price), 2),
      starts_at = v_start, duration_min = v_dur, note = nullif(trim(coalesce(p->>'note', '')), ''), updated_at = now()
    where id = v_id
    returning * into v_row;
  end if;

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), case when v_id is null then 'appointment_create' else 'appointment_update' end,
          'appointment', v_row.id::text, jsonb_build_object('customer', v_row.customer_name, 'service', v_row.service_name,
          'starts_at', v_row.starts_at, 'staff_id', v_row.staff_id));
  return to_jsonb(v_row);
end $$;

-- status: arrived | done | no_show | cancelled | booked (undo)
create or replace function public.set_appointment_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_row public.appointments%rowtype;
begin
  if p_status not in ('booked', 'arrived', 'done', 'no_show', 'cancelled') then
    raise exception 'Statusi nuk njihet' using errcode = '22023';
  end if;
  select * into v_row from public.appointments where id = p_id and business_id = v_business for update;
  if not found or (not public.is_manager() and v_row.staff_id <> auth.uid()) then
    raise exception 'Termini nuk u gjet' using errcode = 'P0002';
  end if;
  if v_row.status = 'paid' then
    raise exception 'Termini është paguar' using errcode = '22023';
  end if;
  update public.appointments set status = p_status, updated_at = now() where id = p_id returning * into v_row;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'appointment_status', 'appointment', p_id::text,
          jsonb_build_object('status', p_status, 'customer', v_row.customer_name));
  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------------
-- create_sale with staff per line + appointment (wraps the phase-3 function)
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'create_sale' and pg_get_function_identity_arguments(p.oid) = 'p jsonb')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = '_create_sale_core') then
    alter function public.create_sale(jsonb) rename to _create_sale_core;
  end if;
end $$;
revoke execute on function public._create_sale_core(jsonb) from public, anon, authenticated;

create or replace function public.create_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_map jsonb := '{}'::jsonb;
  v_pos int := 0;
  it jsonb;
  v_staff uuid;
  v_appt uuid := nullif(p->>'appointment_id', '')::uuid;
  v_sale jsonb;
begin
  if v_business is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  -- staff per line position (only people of this business; anything else falls back to the seller)
  if jsonb_typeof(p->'items') = 'array' then
    for it in select * from jsonb_array_elements(p->'items') loop
      v_pos := v_pos + 1;
      v_staff := nullif(it->>'staff_id', '')::uuid;
      if v_staff is not null and exists (select 1 from public.profiles where id = v_staff and business_id = v_business) then
        v_map := v_map || jsonb_build_object(v_pos::text, v_staff);
      end if;
    end loop;
  end if;
  perform set_config('kasa.sale_staff', v_map::text, true);
  v_sale := public._create_sale_core(p);
  perform set_config('kasa.sale_staff', '', true);

  if v_appt is not null then
    -- Whoever takes the payment closes the appointment (the cashier may not be the stylist).
    update public.appointments set status = 'paid', sale_id = (v_sale->>'id')::uuid, updated_at = now()
    where id = v_appt and business_id = v_business and status <> 'paid';
  end if;
  return v_sale;
end $$;

-- ---------------------------------------------------------------------
-- Commission on performed lines
-- ---------------------------------------------------------------------
create or replace function public._performed_value(p_business uuid, p_staff uuid, p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(i.total), 0)
  from public.sale_items i join public.sales s on s.id = i.sale_id
  where s.business_id = p_business and s.sale_date between p_from and p_to and i.staff_id = p_staff
$$;
revoke execute on function public._performed_value(uuid, uuid, date, date) from public, anon, authenticated;

-- commission_report(from, to): one row per person (managers only)
create or replace function public.commission_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_out jsonb;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Periudha nuk është e saktë' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(t order by t.value desc, t.name), '[]'::jsonb) into v_out
  from (
    select p.id as staff_id, coalesce(nullif(p.full_name, ''), p.email, '—') as name, p.role, p.active, p.specialty,
           p.commission_pct,
           coalesce(x.services, 0) as services, coalesce(x.products, 0) as products,
           coalesce(x.value, 0) as value, coalesce(x.service_value, 0) as service_value,
           round(coalesce(x.value, 0) * p.commission_pct / 100, 2) as commission
    from public.profiles p
    left join (
      select i.staff_id,
             sum(i.quantity) filter (where i.kind = 'service') as services,
             sum(i.quantity) filter (where i.kind <> 'service') as products,
             sum(i.total) as value,
             sum(i.total) filter (where i.kind = 'service') as service_value
      from public.sale_items i join public.sales s on s.id = i.sale_id
      where s.business_id = v_business and s.sale_date between p_from and p_to
      group by i.staff_id
    ) x on x.staff_id = p.id
    where p.business_id = v_business and (p.active or x.staff_id is not null)
  ) t;
  return v_out;
end $$;

-- work_summary / workers_comparison: commission from performed lines
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = '_work_summary_core') then
    alter function public.work_summary(uuid, date, date) rename to _work_summary_core;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = '_workers_comparison_core') then
    alter function public.workers_comparison(date, date) rename to _workers_comparison_core;
  end if;
end $$;
revoke execute on function public._work_summary_core(uuid, date, date) from public, anon, authenticated;
revoke execute on function public._workers_comparison_core(date, date) from public, anon, authenticated;

create or replace function public.work_summary(p_worker uuid default null, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r jsonb := public._work_summary_core(p_worker, p_from, p_to);
  v_value numeric := public._performed_value(public.current_business_id(), (r->'worker'->>'id')::uuid, (r->>'from')::date, (r->>'to')::date);
begin
  return r || jsonb_build_object(
    'performed_value', v_value,
    'commission', round(v_value * coalesce((r->'worker'->>'commission_pct')::numeric, 0) / 100, 2));
end $$;

create or replace function public.workers_comparison(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
begin
  return (
    select coalesce(jsonb_agg(e || jsonb_build_object('commission',
             round(public._performed_value(v_business, (e->>'worker_id')::uuid, p_from, p_to) * (e->>'commission_pct')::numeric / 100, 2))), '[]'::jsonb)
    from jsonb_array_elements(public._workers_comparison_core(p_from, p_to)) e
  );
end $$;

-- update_business_user: also the specialty (keeps the phase-6 rules)
create or replace function public.set_user_specialty(p_user uuid, p_specialty text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user <> auth.uid() and not public._can_manage(p_user) then
    raise exception 'Nuk ke të drejtë ta ndryshosh këtë përdorues' using errcode = '42501';
  end if;
  update public.profiles set specialty = nullif(trim(coalesce(p_specialty, '')), '')
    where id = p_user and business_id = public.current_business_id();
end $$;

-- Staff list for the till and the calendar (names only – any member of the business).
create or replace function public.business_staff()
returns table (id uuid, full_name text, role public.user_role, specialty text, commission_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role, p.specialty,
         case when public.is_manager() or p.id = auth.uid() then p.commission_pct end
  from public.profiles p
  where p.business_id = public.current_business_id() and p.active
  order by case p.role when 'worker' then 0 when 'manager' then 1 else 2 end, p.full_name
$$;

revoke execute on function public.business_staff() from public, anon;
grant execute on function public.business_staff() to authenticated;
revoke execute on function public.save_appointment(jsonb) from public, anon;
revoke execute on function public.set_appointment_status(uuid, text) from public, anon;
revoke execute on function public.create_sale(jsonb) from public, anon;
revoke execute on function public.commission_report(date, date) from public, anon;
revoke execute on function public.work_summary(uuid, date, date) from public, anon;
revoke execute on function public.workers_comparison(date, date) from public, anon;
revoke execute on function public.set_user_specialty(uuid, text) from public, anon;
grant execute on function public.save_appointment(jsonb) to authenticated;
grant execute on function public.set_appointment_status(uuid, text) to authenticated;
grant execute on function public.create_sale(jsonb) to authenticated;
grant execute on function public.commission_report(date, date) to authenticated;
grant execute on function public.work_summary(uuid, date, date) to authenticated;
grant execute on function public.workers_comparison(date, date) to authenticated;
grant execute on function public.set_user_specialty(uuid, text) to authenticated;
