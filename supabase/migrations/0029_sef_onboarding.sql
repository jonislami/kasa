-- =====================================================================
-- 0029 – SEF: registration by the client, approval, payment, license, application for a till.
--
-- Flow: the owner registers (Edge Function register-business) → business status 'pending', active = false
--   → the platform admin approves / rejects / asks for data → confirms the payment → license active
--   → status 'active', active = true → the owner applies for a till → the admin approves it → Install SEF.
--
-- * businesses.status: pending | needs_info | approved (waits for payment) | active | rejected | suspended.
--   businesses.active stays the one key of access (current_business_id, RLS): it is true only when
--   status = 'active' and the license is not suspended / cancelled. Existing businesses become
--   'active' with a license without expiry, so nothing that works today changes.
-- * business_licenses: one per business – plan, price, status, expiry, maximum devices.
--   Expiry: warning 7 days before, 7 days of grace, then no new sales (viewing still allowed).
-- * license_payments: bank / cash payments the admin confirms; each one extends the license.
-- * business_events: history of the registration (submitted, data requested, approved, payment…).
-- * register_applications: "Apliko për arkë" – approval creates / assigns the till in registers.
-- * platform_settings: payment instructions (bank, IBAN) and prices shown to the clients.
-- =====================================================================

alter table public.businesses add column if not exists status text not null default 'active';
do $$ begin
  alter table public.businesses add constraint businesses_status_check
    check (status in ('pending', 'needs_info', 'approved', 'active', 'rejected', 'suspended'));
exception when duplicate_object then null; end $$;
alter table public.businesses add column if not exists status_note text;          -- message of the admin to the client
alter table public.businesses add column if not exists applied_at timestamptz;
alter table public.businesses add column if not exists decided_at timestamptz;
alter table public.businesses add column if not exists decided_by uuid references auth.users (id) on delete set null;
alter table public.businesses add column if not exists activity text;             -- what the business does
alter table public.businesses add column if not exists registration jsonb not null default '{}'::jsonb;  -- other data from the form
create index if not exists businesses_status_idx on public.businesses (status, created_at desc);

-- ---------------------------------------------------------------------
-- Platform settings (payment instructions)
-- ---------------------------------------------------------------------
create table if not exists public.platform_settings (
  id             int primary key default 1 check (id = 1),
  bank_name      text,
  iban           text,
  account_holder text,
  monthly_price  numeric(10, 2) not null default 0,
  yearly_price   numeric(10, 2) not null default 0,
  payment_note   text,
  grace_days     int not null default 7 check (grace_days between 0 and 60),
  updated_at     timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings for select to authenticated using (true);
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to authenticated;

-- ---------------------------------------------------------------------
-- Licenses and payments
-- ---------------------------------------------------------------------
create table if not exists public.business_licenses (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  plan        text not null default 'monthly' check (plan in ('monthly', 'yearly', 'custom')),
  price       numeric(10, 2),
  status      text not null default 'active' check (status in ('active', 'suspended', 'cancelled')),
  starts_on   date,
  expires_on  date,                       -- null = no expiry
  max_devices int not null default 3 check (max_devices between 1 and 100),
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

create table if not exists public.license_payments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  amount       numeric(10, 2) not null check (amount >= 0),
  method       text not null default 'bank' check (method in ('bank', 'cash', 'other')),
  paid_on      date not null,
  reference    text,
  months       int not null default 1 check (months between 0 and 60),
  extended_to  date,
  note         text,
  confirmed_by uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists license_payments_business_idx on public.license_payments (business_id, paid_on desc);

create table if not exists public.business_events (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  action      text not null,
  note        text,
  by_user     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists business_events_business_idx on public.business_events (business_id, id desc);

create table if not exists public.register_applications (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'needs_info', 'approved', 'rejected')),
  name         text not null check (length(trim(name)) > 0),   -- e.g. "Arka 2 – bari"
  location     text,
  device_type  text not null default 'windows' check (device_type in ('windows', 'android', 'ios', 'web')),
  printer      text not null default 'bluetooth' check (printer in ('bluetooth', 'usb', 'network', 'none')),
  paper_width  int not null default 80 check (paper_width in (58, 80)),
  fiscal       boolean not null default true,
  contact      text,
  note         text,
  admin_note   text,
  register_id  uuid references public.registers (id) on delete set null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users (id) on delete set null
);
create index if not exists register_applications_business_idx on public.register_applications (business_id, created_at desc);

alter table public.business_licenses     enable row level security;
alter table public.license_payments      enable row level security;
alter table public.business_events       enable row level security;
alter table public.register_applications enable row level security;
-- reads go through the RPCs below; the platform admin reads everything
drop policy if exists business_licenses_admin on public.business_licenses;
create policy business_licenses_admin on public.business_licenses for select to authenticated using (public.is_platform_admin());
drop policy if exists license_payments_admin on public.license_payments;
create policy license_payments_admin on public.license_payments for select to authenticated using (public.is_platform_admin());
drop policy if exists business_events_admin on public.business_events;
create policy business_events_admin on public.business_events for select to authenticated using (public.is_platform_admin());
drop policy if exists register_applications_read on public.register_applications;
create policy register_applications_read on public.register_applications for select to authenticated
  using (public.is_platform_admin() or business_id = public.current_business_id());
revoke all on public.business_licenses, public.license_payments, public.business_events, public.register_applications from anon, authenticated;
grant select on public.business_licenses, public.license_payments, public.business_events, public.register_applications to authenticated;

-- Existing businesses: active, license without expiry. New ones get a license row by themselves.
insert into public.business_licenses (business_id, plan, status, starts_on, expires_on, note)
select b.id, 'custom', 'active', b.created_at::date, null, 'Biznes ekzistues para regjistrimit SEF'
from public.businesses b
on conflict (business_id) do nothing;

create or replace function public._business_license_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_licenses (business_id, plan, status, expires_on)
  values (new.id, case when new.status = 'active' then 'custom' else 'monthly' end, 'active', null)
  on conflict (business_id) do nothing;
  return new;
end $$;
drop trigger if exists business_license_row on public.businesses;
create trigger business_license_row after insert on public.businesses for each row execute function public._business_license_row();

-- ---------------------------------------------------------------------
-- License state and access
-- ---------------------------------------------------------------------
-- {state: active | expiring | grace | expired | suspended | cancelled, expires_on, grace_until, days_left, max_devices, plan}
create or replace function public._license_state(p_business uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'state', case
               when l.business_id is null then 'active'
               when l.status <> 'active' then l.status
               when l.expires_on is null then 'active'
               when public._local_date() > l.expires_on + s.grace_days then 'expired'
               when public._local_date() > l.expires_on then 'grace'
               when l.expires_on - public._local_date() <= 7 then 'expiring'
               else 'active' end,
    'plan', l.plan, 'expires_on', l.expires_on,
    'grace_until', case when l.expires_on is not null then l.expires_on + s.grace_days end,
    'days_left', case when l.expires_on is not null then l.expires_on - public._local_date() end,
    'max_devices', coalesce(l.max_devices, 3))
  from (select 1) one
  left join public.business_licenses l on l.business_id = p_business
  cross join public.platform_settings s
$$;

-- active = approved + paid + license not suspended / cancelled
create or replace function public._business_sync_active(p_business uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.businesses b
     set active = (b.status = 'active'
                   and coalesce((select l.status from public.business_licenses l where l.business_id = b.id), 'active') = 'active')
   where b.id = p_business;
end $$;

-- After the grace period: no new sales (voids and refunds still go, viewing still works).
create or replace function public._sales_license_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'sale' and public._license_state(new.business_id)->>'state' = 'expired' then
    raise exception 'Abonimi i Kasa-s ka skaduar. Shitjet e reja ndalen derisa të paguhet abonimi.' using errcode = 'P0001', hint = 'license_expired';
  end if;
  return new;
end $$;
drop trigger if exists sales_license_guard on public.sales;
create trigger sales_license_guard before insert on public.sales for each row execute function public._sales_license_guard();

-- Maximum devices of the license (counted when a new device is linked).
create or replace function public._devices_license_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int := (public._license_state(new.business_id)->>'max_devices')::int;
begin
  if (select count(*) from public.devices d where d.business_id = new.business_id and d.active) >= v_max then
    raise exception 'Licenca lejon % pajisje. Çaktivizo një pajisje te Cilësimet ose kërko zgjerim të licencës.', v_max
      using errcode = 'P0001', hint = 'license_devices';
  end if;
  return new;
end $$;
drop trigger if exists devices_license_guard on public.devices;
create trigger devices_license_guard before insert on public.devices for each row execute function public._devices_license_guard();

-- The app learns the license state with every heartbeat (0005) and with the session context.
create or replace function public.device_heartbeat(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_row public.devices%rowtype;
begin
  if v_business is null then
    return null;
  end if;
  update public.devices set last_seen_at = now(), last_user_id = auth.uid(),
         app_version = coalesce(nullif(p->>'app_version', ''), app_version)
  where id = nullif(p->>'device_id', '')::uuid and business_id = v_business
  returning * into v_row;
  if not found then
    return null;
  end if;
  return jsonb_build_object('device_id', v_row.id, 'register_id', v_row.register_id, 'name', v_row.name, 'active', v_row.active,
                            'license', public._license_state(v_business));
end $$;

-- May the business install / use the apps: active, and a till application approved (or a business made before SEF).
create or replace function public._can_install(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select b.active and b.status = 'active'
     and (b.applied_at is null
          or exists (select 1 from public.register_applications r where r.business_id = b.id and r.status = 'approved'))
  from public.businesses b where b.id = p_business
$$;

do $$
declare
  def text := pg_get_functiondef('public.my_context()'::regprocedure);
  n int;
begin
  if position('_license_state' in def) = 0 then
    n := (length(def) - length(replace(def, '''fiscal_number'', b.fiscal_number)', ''))) / length('''fiscal_number'', b.fiscal_number)');
    if n = 0 then raise exception 'my_context: business object not found'; end if;
    execute replace(def, '''fiscal_number'', b.fiscal_number)',
                    '''fiscal_number'', b.fiscal_number, ''status'', b.status, ''status_note'', b.status_note, ''license'', public._license_state(b.id), ''can_install'', public._can_install(b.id))');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- The owner while the business waits (works also when active = false)
-- ---------------------------------------------------------------------
create or replace function public._owner_business()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.business_id from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin'
$$;

create or replace function public.onboarding_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  b public.businesses;
  s public.platform_settings;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  select * into b from public.businesses where id = v_b;
  select * into s from public.platform_settings where id = 1;
  return jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'type', b.type, 'status', b.status, 'status_note', b.status_note, 'active', b.active,
                                   'nui', b.nui, 'fiscal_number', b.fiscal_number, 'vat_number', b.vat_number, 'address', b.address, 'city', b.city,
                                   'phone', b.phone, 'owner_name', b.owner_name, 'owner_email', b.owner_email, 'activity', b.activity,
                                   'registration', b.registration, 'applied_at', b.applied_at, 'decided_at', b.decided_at, 'created_at', b.created_at),
    'license', public._license_state(b.id) || (select jsonb_build_object('price', l.price, 'status', l.status, 'starts_on', l.starts_on)
                                                from public.business_licenses l where l.business_id = b.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('paid_on', p.paid_on, 'amount', p.amount, 'method', p.method, 'months', p.months,
                                                              'extended_to', p.extended_to, 'reference', p.reference) order by p.paid_on desc), '[]'::jsonb)
                 from public.license_payments p where p.business_id = b.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'note', e.note, 'created_at', e.created_at) order by e.id desc), '[]'::jsonb)
               from public.business_events e where e.business_id = b.id),
    'register_applications', (select coalesce(jsonb_agg(to_jsonb(r) - 'created_by' - 'decided_by' order by r.created_at desc), '[]'::jsonb)
                              from public.register_applications r where r.business_id = b.id),
    'can_install', public._can_install(b.id),
    'payment_info', jsonb_build_object('bank_name', s.bank_name, 'iban', s.iban, 'account_holder', s.account_holder, 'monthly_price', s.monthly_price,
                                       'yearly_price', s.yearly_price, 'payment_note', s.payment_note, 'grace_days', s.grace_days)
  );
end $$;

-- The owner completes / corrects the data while waiting (pending, needs_info, approved).
create or replace function public.onboarding_update(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  b public.businesses;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  select * into b from public.businesses where id = v_b for update;
  if b.status not in ('pending', 'needs_info', 'approved') then
    raise exception 'Të dhënat e biznesit aktiv ndryshohen te Cilësimet' using errcode = '22023';
  end if;
  update public.businesses
     set name = coalesce(nullif(trim(p->>'name'), ''), name),
         nui = case when p ? 'nui' then nullif(regexp_replace(p->>'nui', '\D', '', 'g'), '') else nui end,
         fiscal_number = case when p ? 'fiscal_number' then nullif(trim(p->>'fiscal_number'), '') else fiscal_number end,
         vat_number = case when p ? 'vat_number' then nullif(trim(p->>'vat_number'), '') else vat_number end,
         address = case when p ? 'address' then nullif(trim(p->>'address'), '') else address end,
         city = case when p ? 'city' then nullif(trim(p->>'city'), '') else city end,
         phone = case when p ? 'phone' then nullif(trim(p->>'phone'), '') else phone end,
         owner_name = coalesce(nullif(trim(p->>'owner_name'), ''), owner_name),
         activity = case when p ? 'activity' then nullif(trim(p->>'activity'), '') else activity end,
         registration = registration || coalesce(p->'registration', '{}'::jsonb),
         status = case when status = 'needs_info' then 'pending' else status end
   where id = v_b;
  insert into public.business_events (business_id, action, note, by_user)
  values (v_b, case when b.status = 'needs_info' then 'info_sent' else 'updated' end, nullif(trim(p->>'message'), ''), auth.uid());
end $$;

-- "Apliko për arkë": only an active (approved + paid) business.
create or replace function public.register_application_submit(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  v_status text;
  v_id uuid;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  select status into v_status from public.businesses where id = v_b;
  if v_status <> 'active' then
    raise exception 'Aplikimi për arkë hapet pasi të aprovohet llogaria dhe të konfirmohet pagesa' using errcode = '22023';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Shkruaj emrin e arkës' using errcode = '22023'; end if;
  if nullif(p->>'id', '') is not null then
    update public.register_applications
       set name = left(trim(p->>'name'), 100), location = nullif(trim(p->>'location'), ''), device_type = coalesce(p->>'device_type', device_type),
           printer = coalesce(p->>'printer', printer), paper_width = coalesce((p->>'paper_width')::int, paper_width),
           fiscal = coalesce((p->>'fiscal')::boolean, fiscal), contact = nullif(trim(p->>'contact'), ''), note = nullif(trim(p->>'note'), ''),
           status = 'pending'
     where id = (p->>'id')::uuid and business_id = v_b and status in ('pending', 'needs_info')
     returning id into v_id;
    if v_id is null then raise exception 'Aplikimi nuk u gjet ose është vendosur tashmë' using errcode = 'P0002'; end if;
  else
    insert into public.register_applications (business_id, name, location, device_type, printer, paper_width, fiscal, contact, note, created_by)
    values (v_b, left(trim(p->>'name'), 100), nullif(trim(p->>'location'), ''), coalesce(p->>'device_type', 'windows'),
            coalesce(p->>'printer', 'bluetooth'), coalesce((p->>'paper_width')::int, 80), coalesce((p->>'fiscal')::boolean, true),
            nullif(trim(p->>'contact'), ''), nullif(trim(p->>'note'), ''), auth.uid())
    returning id into v_id;
  end if;
  insert into public.business_events (business_id, action, note, by_user) values (v_b, 'register_applied', left(trim(p->>'name'), 100), auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Platform admin
-- ---------------------------------------------------------------------
create or replace function public._require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Vetëm për adminin e platformës' using errcode = '42501';
  end if;
end $$;

-- All businesses with their registration / payment / license state (newest applications first).
create or replace function public.platform_onboarding_list(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_platform_admin();
  return coalesce((
    select jsonb_agg(x order by x.waiting desc, x.created_at desc)
    from (
      select b.id, b.name, b.type, b.status, b.active, b.city, b.nui, b.fiscal_number, b.phone, b.owner_name, b.owner_email, b.created_at, b.applied_at,
             b.status in ('pending', 'needs_info') or exists (select 1 from public.register_applications r where r.business_id = b.id and r.status = 'pending') as waiting,
             public._license_state(b.id) as license,
             (select l.price from public.business_licenses l where l.business_id = b.id) as price,
             (select max(p.paid_on) from public.license_payments p where p.business_id = b.id) as last_payment,
             (select count(*) from public.register_applications r where r.business_id = b.id and r.status = 'pending') as register_pending,
             (select count(*) from public.devices d where d.business_id = b.id and d.active) as devices,
             (select count(*) from public.registers r where r.business_id = b.id and r.active) as registers
      from public.businesses b
      where p_status is null or b.status = p_status
         or (p_status = 'waiting' and (b.status in ('pending', 'needs_info')
                                       or exists (select 1 from public.register_applications r where r.business_id = b.id and r.status = 'pending')))
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.platform_onboarding_detail(p_business uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.businesses;
begin
  perform public._require_platform_admin();
  select * into b from public.businesses where id = p_business;
  if not found then raise exception 'Biznesi nuk u gjet' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'business', to_jsonb(b) - 'invoice_counter',
    'license', (select to_jsonb(l) from public.business_licenses l where l.business_id = b.id) || jsonb_build_object('computed', public._license_state(b.id)),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('confirmed_by_name', u.email) order by p.paid_on desc), '[]'::jsonb)
                 from public.license_payments p left join auth.users u on u.id = p.confirmed_by where p.business_id = b.id),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('by_name', u.email) order by e.id desc), '[]'::jsonb)
               from public.business_events e left join auth.users u on u.id = e.by_user where e.business_id = b.id),
    'register_applications', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) from public.register_applications r where r.business_id = b.id),
    'registers', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'active', r.active) order by r.name), '[]'::jsonb) from public.registers r where r.business_id = b.id),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'platform', d.platform, 'app_version', d.app_version, 'active', d.active,
                                                             'last_seen_at', d.last_seen_at, 'linked_at', d.linked_at, 'register', r.name) order by d.last_seen_at desc), '[]'::jsonb)
                from public.devices d left join public.registers r on r.id = d.register_id where d.business_id = b.id),
    'owner_last_sign_in', (select u.last_sign_in_at from public.profiles p join auth.users u on u.id = p.id where p.business_id = b.id and p.role = 'admin' order by u.last_sign_in_at desc nulls last limit 1)
  );
end $$;

-- p_action: approve | reject | request_info | suspend | reactivate
create or replace function public.platform_decide(p_business uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  v_paid boolean;
  v_status text;
begin
  perform public._require_platform_admin();
  select * into b from public.businesses where id = p_business for update;
  if not found then raise exception 'Biznesi nuk u gjet' using errcode = 'P0002'; end if;
  v_paid := exists (select 1 from public.license_payments where business_id = b.id);
  v_status := case p_action
    when 'approve' then case when v_paid or b.status in ('active', 'suspended') then 'active' else 'approved' end
    when 'reject' then 'rejected'
    when 'request_info' then 'needs_info'
    when 'suspend' then 'suspended'
    when 'reactivate' then case when v_paid or b.status = 'suspended' then 'active' else 'approved' end
  end;
  if v_status is null then raise exception 'Veprimi nuk vlen' using errcode = '22023'; end if;
  if p_action in ('reject', 'request_info') and coalesce(trim(p_note), '') = '' then
    raise exception 'Shkruaj arsyen / çka duhet të plotësojë klienti' using errcode = '22023';
  end if;
  update public.businesses
     set status = v_status, status_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now(), decided_by = auth.uid()
   where id = b.id;
  if p_action = 'reactivate' then
    update public.business_licenses set status = 'active', updated_at = now(), updated_by = auth.uid() where business_id = b.id and status <> 'active';
  end if;
  perform public._business_sync_active(b.id);
  insert into public.business_events (business_id, action, note, by_user) values (b.id, p_action, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), 'business_' || p_action, 'business', b.id::text, jsonb_build_object('status', v_status, 'note', p_note));
  return jsonb_build_object('status', v_status, 'active', (select active from public.businesses where id = b.id));
end $$;

-- Payment confirmed: extends the license by p.months from the later of today / current expiry; activates an approved business.
-- p = {business_id, amount, method?, paid_on?, reference?, months?, note?}
create or replace function public.platform_confirm_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  l public.business_licenses;
  v_months int := coalesce((p->>'months')::int, 1);
  v_paid_on date := coalesce(nullif(p->>'paid_on', '')::date, public._local_date());
  v_to date;
begin
  perform public._require_platform_admin();
  select * into b from public.businesses where id = (p->>'business_id')::uuid for update;
  if not found then raise exception 'Biznesi nuk u gjet' using errcode = 'P0002'; end if;
  if b.status in ('pending', 'needs_info', 'rejected') then
    raise exception 'Aprovo fillimisht regjistrimin, pastaj konfirmo pagesën' using errcode = '22023';
  end if;
  select * into l from public.business_licenses where business_id = b.id for update;
  v_to := case when v_months = 0 then l.expires_on
               else (greatest(coalesce(l.expires_on, v_paid_on - 1), v_paid_on - 1) + make_interval(months => v_months))::date end;
  insert into public.license_payments (business_id, amount, method, paid_on, reference, months, extended_to, note, confirmed_by)
  values (b.id, coalesce((p->>'amount')::numeric, 0), coalesce(nullif(p->>'method', ''), 'bank'), v_paid_on, nullif(trim(p->>'reference'), ''),
          v_months, v_to, nullif(trim(p->>'note'), ''), auth.uid());
  update public.business_licenses
     set expires_on = v_to, starts_on = coalesce(starts_on, v_paid_on), status = 'active',
         plan = case when v_months >= 12 and plan = 'monthly' then 'yearly' else plan end, updated_at = now(), updated_by = auth.uid()
   where business_id = b.id;
  if b.status = 'approved' then
    update public.businesses set status = 'active', decided_at = now(), decided_by = auth.uid() where id = b.id;
  end if;
  perform public._business_sync_active(b.id);
  insert into public.business_events (business_id, action, note, by_user)
  values (b.id, 'payment_confirmed', concat_ws(' · ', to_char(coalesce((p->>'amount')::numeric, 0), 'FM999990.00') || ' €',
                                            case when v_to is not null then 'deri më ' || to_char(v_to, 'DD.MM.YYYY') end, nullif(trim(p->>'reference'), '')), auth.uid());
  return jsonb_build_object('expires_on', v_to, 'status', (select status from public.businesses where id = b.id));
end $$;

create or replace function public.platform_payment_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid;
begin
  perform public._require_platform_admin();
  delete from public.license_payments where id = p_id returning business_id into v_b;
  if v_b is null then raise exception 'Pagesa nuk u gjet' using errcode = 'P0002'; end if;
  insert into public.business_events (business_id, action, note, by_user) values (v_b, 'payment_deleted', 'Afati i licencës nuk ndryshon vetë – rregulloje te licenca.', auth.uid());
end $$;

-- p = {business_id, plan?, price?, status?, expires_on? ('' = no expiry), max_devices?, note?}
create or replace function public.platform_license_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := (p->>'business_id')::uuid;
begin
  perform public._require_platform_admin();
  insert into public.business_licenses (business_id) values (v_b) on conflict do nothing;
  update public.business_licenses
     set plan = coalesce(nullif(p->>'plan', ''), plan),
         price = case when p ? 'price' then nullif(p->>'price', '')::numeric else price end,
         status = coalesce(nullif(p->>'status', ''), status),
         expires_on = case when p ? 'expires_on' then nullif(p->>'expires_on', '')::date else expires_on end,
         max_devices = coalesce(nullif(p->>'max_devices', '')::int, max_devices),
         note = case when p ? 'note' then nullif(trim(p->>'note'), '') else note end,
         updated_at = now(), updated_by = auth.uid()
   where business_id = v_b;
  if not found then raise exception 'Biznesi nuk u gjet' using errcode = 'P0002'; end if;
  perform public._business_sync_active(v_b);
  insert into public.business_events (business_id, action, note, by_user)
  values (v_b, 'license_changed', (select concat_ws(' · ', 'statusi: ' || l.status, 'skadon: ' || coalesce(to_char(l.expires_on, 'DD.MM.YYYY'), 'pa afat'),
                                                    'pajisje: ' || l.max_devices) from public.business_licenses l where l.business_id = v_b), auth.uid());
  return public._license_state(v_b);
end $$;

-- p_action: approve | reject | request_info. Approving creates the till (or uses p_register).
create or replace function public.platform_register_application_decide(p_id uuid, p_action text, p_note text default null, p_register uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.register_applications;
  v_reg uuid := p_register;
begin
  perform public._require_platform_admin();
  select * into a from public.register_applications where id = p_id for update;
  if not found then raise exception 'Aplikimi nuk u gjet' using errcode = 'P0002'; end if;
  if p_action not in ('approve', 'reject', 'request_info') then raise exception 'Veprimi nuk vlen' using errcode = '22023'; end if;
  if p_action <> 'approve' and coalesce(trim(p_note), '') = '' then raise exception 'Shkruaj arsyen' using errcode = '22023'; end if;
  if p_action = 'approve' then
    if v_reg is not null and not exists (select 1 from public.registers where id = v_reg and business_id = a.business_id) then
      raise exception 'Arka nuk është e këtij biznesi' using errcode = '22023';
    end if;
    if v_reg is null then
      -- the first application takes the till made at registration if no device uses it yet
      select r.id into v_reg from public.registers r
      where r.business_id = a.business_id and r.active
        and not exists (select 1 from public.register_applications x where x.register_id = r.id)
        and not exists (select 1 from public.devices d where d.register_id = r.id)
      order by r.created_at limit 1;
      if v_reg is null then
        insert into public.registers (business_id, name) values (a.business_id, left(a.name, 60)) returning id into v_reg;
      else
        update public.registers set name = left(a.name, 60) where id = v_reg;
      end if;
    end if;
  end if;
  update public.register_applications
     set status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'needs_info' end,
         admin_note = nullif(trim(coalesce(p_note, '')), ''), register_id = coalesce(v_reg, register_id), decided_at = now(), decided_by = auth.uid()
   where id = a.id;
  insert into public.business_events (business_id, action, note, by_user)
  values (a.business_id, 'register_' || p_action, concat_ws(' · ', a.name, nullif(trim(coalesce(p_note, '')), '')), auth.uid());
  return jsonb_build_object('register_id', v_reg);
end $$;

create or replace function public.platform_settings_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_platform_admin();
  update public.platform_settings
     set bank_name = case when p ? 'bank_name' then nullif(trim(p->>'bank_name'), '') else bank_name end,
         iban = case when p ? 'iban' then nullif(upper(regexp_replace(p->>'iban', '\s', '', 'g')), '') else iban end,
         account_holder = case when p ? 'account_holder' then nullif(trim(p->>'account_holder'), '') else account_holder end,
         monthly_price = coalesce(nullif(p->>'monthly_price', '')::numeric, monthly_price),
         yearly_price = coalesce(nullif(p->>'yearly_price', '')::numeric, yearly_price),
         payment_note = case when p ? 'payment_note' then nullif(trim(p->>'payment_note'), '') else payment_note end,
         grace_days = coalesce(nullif(p->>'grace_days', '')::int, grace_days),
         updated_at = now()
   where id = 1;
end $$;

create or replace function public.platform_device_set(p_device uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid;
begin
  perform public._require_platform_admin();
  update public.devices set active = p_active where id = p_device returning business_id into v_b;
  if v_b is null then raise exception 'Pajisja nuk u gjet' using errcode = 'P0002'; end if;
  insert into public.business_events (business_id, action, note, by_user) values (v_b, case when p_active then 'device_on' else 'device_off' end, p_device::text, auth.uid());
end $$;

-- The old on/off switch of /platforma now goes through the statuses (suspend / reactivate).
create or replace function public.platform_set_business_active(p_business_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.platform_decide(p_business_id, case when p_active then 'reactivate' else 'suspend' end, null);
end $$;

revoke execute on function public._business_license_row(), public._license_state(uuid), public._can_install(uuid), public._business_sync_active(uuid), public._sales_license_guard(),
  public._devices_license_guard(), public._owner_business(), public._require_platform_admin() from public, anon, authenticated;
revoke execute on function public.onboarding_state(), public.onboarding_update(jsonb), public.register_application_submit(jsonb),
  public.platform_onboarding_list(text), public.platform_onboarding_detail(uuid), public.platform_decide(uuid, text, text),
  public.platform_confirm_payment(jsonb), public.platform_payment_delete(uuid), public.platform_license_save(jsonb),
  public.platform_register_application_decide(uuid, text, text, uuid), public.platform_settings_save(jsonb), public.platform_device_set(uuid, boolean)
  from public, anon;
grant execute on function public.onboarding_state(), public.onboarding_update(jsonb), public.register_application_submit(jsonb),
  public.platform_onboarding_list(text), public.platform_onboarding_detail(uuid), public.platform_decide(uuid, text, text),
  public.platform_confirm_payment(jsonb), public.platform_payment_delete(uuid), public.platform_license_save(jsonb),
  public.platform_register_application_decide(uuid, text, text, uuid), public.platform_settings_save(jsonb), public.platform_device_set(uuid, boolean),
  public.device_heartbeat(jsonb), public.platform_set_business_active(uuid, boolean) to authenticated;
-- the Edge Function register-business (service role) writes the first event
grant execute on function public._license_state(uuid) to service_role;
