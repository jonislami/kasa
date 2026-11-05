-- =====================================================================
-- Kasa – full schema for a NEW Supabase project (run once, in SQL Editor).
-- Later changes go to supabase/migrations/, one file per change.
--
-- Rules:
--   * every business table: business_id uuid not null default current_business_id()
--     + RLS business_id = current_business_id()
--   * current_business_id() returns the user's business only if it is active
--   * service_role is used only inside Edge Functions
--   * audit_log is append-only
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
do $$ begin
  create type public.business_type as enum ('market', 'restaurant', 'pharmacy', 'boutique', 'salon');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.user_role as enum ('admin', 'manager', 'worker');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Platform admins (people who run Kasa itself)
-- ---------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Businesses
-- ---------------------------------------------------------------------
create table if not exists public.businesses (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),
  type            public.business_type not null,           -- chosen once, never changed
  active          boolean not null default true,
  city            text,
  address         text,
  phone           text,
  nui             text,                                     -- Numri Unik Identifikues
  vat_number      text,                                     -- Nr. TVSH
  fiscal_number   text,                                     -- Nr. fiskal (ATK)
  owner_name      text,
  owner_email     text,
  invoice_counter bigint not null default 0,                -- locked row, incremented by create_sale
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id)
);

-- The business type is immutable.
create or replace function public.businesses_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type is distinct from old.type then
    raise exception 'Lloji i biznesit nuk mund të ndryshohet' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists businesses_guard on public.businesses;
create trigger businesses_guard
  before update on public.businesses
  for each row execute function public.businesses_guard();

-- ---------------------------------------------------------------------
-- Profiles (one per auth user that belongs to a business)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  business_id       uuid not null references public.businesses (id) on delete cascade,
  role              public.user_role not null default 'worker',
  full_name         text not null default '',
  email             text,
  active            boolean not null default true,
  -- PIN login (Edge Function pin-login, phase 6)
  pin_hash          text,
  pin_failed        int not null default 0,
  pin_locked_until  timestamptz,
  commission_pct    numeric(5, 2) not null default 0,       -- salon
  created_at        timestamptz not null default now()
);
create index if not exists profiles_business_idx on public.profiles (business_id);

-- ---------------------------------------------------------------------
-- Helper functions (security definer, fixed search_path)
-- ---------------------------------------------------------------------
create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.business_id
  from public.profiles p
  join public.businesses b on b.id = p.business_id
  where p.id = auth.uid()
    and p.active
    and b.active
$$;

create or replace function public.current_role_in_business()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  join public.businesses b on b.id = p.business_id
  where p.id = auth.uid()
    and p.active
    and b.active
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_role_in_business() in ('admin', 'manager'), false)
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Business settings (one row per business)
-- ---------------------------------------------------------------------
create table if not exists public.business_settings (
  business_id      uuid primary key default public.current_business_id()
                   references public.businesses (id) on delete cascade,
  receipt_header   text,
  receipt_footer   text default 'Faleminderit!',
  paper_width      int not null default 80 check (paper_width in (58, 80)),
  printer_chunk    int not null default 180 check (printer_chunk between 20 and 512),
  printer_charset  text not null default 'replace' check (printer_charset in ('cp1250', 'cp852', 'replace')),
  low_stock_alerts boolean not null default true,
  settings         jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Registers (cash registers / POS devices)
-- ---------------------------------------------------------------------
create table if not exists public.registers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
              references public.businesses (id) on delete cascade,
  name        text not null,
  device_id   text,          -- set when a device is linked
  atk_pos_id  text,          -- POS ID from ATK (phase 9)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists registers_business_idx on public.registers (business_id);

-- ---------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  business_id uuid references public.businesses (id) on delete cascade,  -- null = platform action
  user_id     uuid references auth.users (id) on delete set null,
  action      text not null,          -- login, sale, void, refund, price_change, settings_change, business_create…
  entity      text,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_business_idx on public.audit_log (business_id, created_at desc);

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Regjistri i veprimeve nuk ndryshohet' using errcode = '42501';
end $$;

drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- Clients write to the audit log only through this function.
create or replace function public.log_action(
  p_action text,
  p_entity text default null,
  p_entity_id text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
begin
  if auth.uid() is null then
    raise exception 'Nuk je i kyçur' using errcode = '42501';
  end if;
  if v_business is null and not public.is_platform_admin() then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- Session context: everything the app needs after login, in one call.
-- ---------------------------------------------------------------------
create or replace function public.my_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_platform_admin', public.is_platform_admin(),
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'business_id', p.business_id, 'role', p.role,
        'full_name', p.full_name, 'email', p.email, 'active', p.active
      )
      from public.profiles p where p.id = auth.uid()
    ),
    'business', (
      select jsonb_build_object(
        'id', b.id, 'name', b.name, 'type', b.type, 'active', b.active,
        'city', b.city, 'address', b.address, 'nui', b.nui, 'vat_number', b.vat_number
      )
      from public.profiles p
      join public.businesses b on b.id = p.business_id
      where p.id = auth.uid()
    )
  )
$$;

-- ---------------------------------------------------------------------
-- Platform admin RPCs (no access to a business's internal data)
-- ---------------------------------------------------------------------
create or replace function public.platform_businesses()
returns table (
  id uuid,
  name text,
  type public.business_type,
  active boolean,
  city text,
  owner_name text,
  owner_email text,
  users_count bigint,
  registers_count bigint,
  has_logged_in boolean,
  sales_today numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Vetëm për adminin e platformës' using errcode = '42501';
  end if;
  return query
  select
    b.id, b.name, b.type, b.active, b.city, b.owner_name, b.owner_email,
    (select count(*) from public.profiles p where p.business_id = b.id),
    (select count(*) from public.registers r where r.business_id = b.id and r.active),
    exists (
      select 1 from public.profiles p
      join auth.users u on u.id = p.id
      where p.business_id = b.id and u.last_sign_in_at is not null
    ),
    0::numeric,   -- replaced in the sales phase (sum of today's sales)
    b.created_at
  from public.businesses b
  order by b.created_at desc;
end $$;

create or replace function public.platform_set_business_active(p_business_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Vetëm për adminin e platformës' using errcode = '42501';
  end if;
  update public.businesses set active = p_active where id = p_business_id;
  if not found then
    raise exception 'Biznesi nuk u gjet' using errcode = 'P0002';
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), case when p_active then 'business_activate' else 'business_deactivate' end,
          'business', p_business_id::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.platform_admins   enable row level security;
alter table public.businesses        enable row level security;
alter table public.profiles          enable row level security;
alter table public.business_settings enable row level security;
alter table public.registers         enable row level security;
alter table public.audit_log         enable row level security;

-- platform_admins: you can only see whether you are one
drop policy if exists platform_admins_self on public.platform_admins;
create policy platform_admins_self on public.platform_admins
  for select to authenticated using (user_id = auth.uid());

-- businesses: own business (only while active). Platform admins use RPCs.
drop policy if exists businesses_select on public.businesses;
create policy businesses_select on public.businesses
  for select to authenticated using (id = public.current_business_id());

drop policy if exists businesses_update on public.businesses;
create policy businesses_update on public.businesses
  for update to authenticated
  using (id = public.current_business_id() and public.is_manager())
  with check (id = public.current_business_id() and public.is_manager());

-- Managers may edit only the descriptive columns; type/active/counter are off limits.
revoke insert, update, delete on public.businesses from anon, authenticated;
grant select on public.businesses to authenticated;
grant update (name, city, address, phone, nui, vat_number, fiscal_number) on public.businesses to authenticated;

-- profiles: yourself; managers see everyone in their business. Writes go through RPC/Edge Functions.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or (business_id = public.current_business_id() and public.is_manager()));

-- pin_hash / pin_failed / pin_locked_until are never readable by clients.
revoke all on public.profiles from anon, authenticated;
grant select (id, business_id, role, full_name, email, active, commission_pct, created_at)
  on public.profiles to authenticated;

-- business_settings: everyone in the business reads (printer), managers write.
drop policy if exists settings_select on public.business_settings;
create policy settings_select on public.business_settings
  for select to authenticated using (business_id = public.current_business_id());

drop policy if exists settings_write on public.business_settings;
create policy settings_write on public.business_settings
  for update to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

revoke insert, delete on public.business_settings from anon, authenticated;

-- registers: everyone in the business reads, managers manage.
drop policy if exists registers_select on public.registers;
create policy registers_select on public.registers
  for select to authenticated using (business_id = public.current_business_id());

drop policy if exists registers_insert on public.registers;
create policy registers_insert on public.registers
  for insert to authenticated
  with check (business_id = public.current_business_id() and public.is_manager());

drop policy if exists registers_update on public.registers;
create policy registers_update on public.registers
  for update to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());

drop policy if exists registers_delete on public.registers;
create policy registers_delete on public.registers
  for delete to authenticated
  using (business_id = public.current_business_id() and public.is_manager());

-- audit_log: managers read their business; inserts only via log_action / server code.
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log
  for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager());

revoke insert, update, delete on public.audit_log from anon, authenticated;

-- No anonymous access anywhere.
revoke all on all tables in schema public from anon;

-- RPC permissions
revoke execute on function public.platform_businesses() from public, anon;
revoke execute on function public.platform_set_business_active(uuid, boolean) from public, anon;
revoke execute on function public.log_action(text, text, text, jsonb) from public, anon;
revoke execute on function public.my_context() from public, anon;
grant execute on function public.platform_businesses() to authenticated;
grant execute on function public.platform_set_business_active(uuid, boolean) to authenticated;
grant execute on function public.log_action(text, text, text, jsonb) to authenticated;
grant execute on function public.my_context() to authenticated;
