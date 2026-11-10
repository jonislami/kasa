-- =====================================================================
-- 0015 – Fiscalization at ATK (SEF), phase 9: data.
--
-- * businesses: the fiscal unit (Hapi 1): branch id from ATK, environment test/prod.
--   NUI and fiscal number (EDI) already exist.
-- * registers: the POS at ATK (Hapi 2): POS ID, status, device that holds the key,
--   public key, certificate, coupon sequence. Fiscal columns change only through the
--   RPCs below or the Edge Function fiscal-relay (service role) – a trigger stops
--   direct updates from the client.
-- * fiscal_coupons: one row per fiscal coupon (sale, cancel, return), next to the
--   immutable sale: CouponId, NUIKF, time, signed details, signature, QR, status at ATK
--   (offline → sent | failed), TransactionNo. Written only by fiscal-relay.
-- * fiscal_log: every request to ATK (verify, signcsr, coupon) with the answer.
-- * fiscal_config: platform values (Application ID of Kasa at ATK, test and prod).
--
-- CouponId = BranchId·10^12 + PosId·10^8 + sequence of the register, so a register can
-- issue coupons offline without asking the server and stays unique for the whole NUI.
-- Nothing the live app uses changes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Platform config
-- ---------------------------------------------------------------------
create table if not exists public.fiscal_config (
  id                  int primary key default 1 check (id = 1),
  application_id_test bigint,
  application_id_prod bigint,
  updated_at          timestamptz not null default now()
);
insert into public.fiscal_config (id) values (1) on conflict do nothing;
alter table public.fiscal_config enable row level security;
drop policy if exists fiscal_config_select on public.fiscal_config;
create policy fiscal_config_select on public.fiscal_config for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- Fiscal unit (business) and POS (register)
-- ---------------------------------------------------------------------
alter table public.businesses add column if not exists fiscal_branch_id bigint check (fiscal_branch_id > 0);
alter table public.businesses add column if not exists fiscal_env text not null default 'test' check (fiscal_env in ('test', 'prod'));
alter table public.businesses add column if not exists fiscal_unit_saved_at timestamptz;

alter table public.registers add column if not exists fiscal_status text not null default 'none'
  check (fiscal_status in ('none', 'registered'));
alter table public.registers add column if not exists fiscal_device_id text;
alter table public.registers add column if not exists fiscal_platform text;
alter table public.registers add column if not exists fiscal_public_key text;
alter table public.registers add column if not exists fiscal_certificate text;
alter table public.registers add column if not exists fiscal_env text;
alter table public.registers add column if not exists fiscal_registered_at timestamptz;
alter table public.registers add column if not exists coupon_seq bigint not null default 0 check (coupon_seq >= 0);
alter table public.registers add column if not exists fiscal_last_sent_at timestamptz;
create unique index if not exists registers_atk_pos_idx on public.registers (business_id, atk_pos_id) where atk_pos_id is not null;

-- Direct updates of the fiscal columns are not allowed (only the RPCs below and fiscal-relay).
create or replace function public.registers_fiscal_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('kasa.fiscal_write', true) = 'on' or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if new.atk_pos_id is distinct from old.atk_pos_id or new.fiscal_status is distinct from old.fiscal_status
     or new.fiscal_device_id is distinct from old.fiscal_device_id or new.fiscal_platform is distinct from old.fiscal_platform
     or new.fiscal_public_key is distinct from old.fiscal_public_key
     or new.fiscal_certificate is distinct from old.fiscal_certificate or new.fiscal_env is distinct from old.fiscal_env
     or new.fiscal_registered_at is distinct from old.fiscal_registered_at or new.coupon_seq is distinct from old.coupon_seq
     or new.fiscal_last_sent_at is distinct from old.fiscal_last_sent_at then
    raise exception 'Të dhënat fiskale të arkës ndryshohen vetëm te Fiskalizimi' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists registers_fiscal_guard on public.registers;
create trigger registers_fiscal_guard before update on public.registers
  for each row execute function public.registers_fiscal_guard();

-- ---------------------------------------------------------------------
-- Fiscal coupons and the ATK log
-- ---------------------------------------------------------------------
create table if not exists public.fiscal_coupons (
  sale_id         uuid primary key references public.sales (id) on delete restrict,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  register_id     uuid not null references public.registers (id) on delete restrict,
  env             text not null check (env in ('test', 'prod')),
  coupon_type     smallint not null check (coupon_type in (1, 2, 3)),
  coupon_id       bigint not null check (coupon_id > 0),
  coupon_seq      bigint not null check (coupon_seq > 0),
  branch_id       bigint not null,
  pos_id          bigint not null,
  reference_no    bigint,
  verification_no text not null check (verification_no ~ '^[A-Za-z0-9]{1,16}$'),
  issued_at       timestamptz not null,
  details         text not null,
  signature       text not null,
  qr              text not null,
  offline         boolean not null default false,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  transaction_no  bigint,
  error           text,
  attempts        int not null default 0,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, coupon_id),
  unique (business_id, verification_no)
);
create index if not exists fiscal_coupons_status_idx on public.fiscal_coupons (business_id, status, issued_at);
create index if not exists fiscal_coupons_register_idx on public.fiscal_coupons (register_id, coupon_seq desc);

alter table public.fiscal_coupons enable row level security;
drop policy if exists fiscal_coupons_select on public.fiscal_coupons;
create policy fiscal_coupons_select on public.fiscal_coupons for select to authenticated
  using (business_id = public.current_business_id());
-- no insert/update/delete policies: written only by fiscal-relay (service role)

create table if not exists public.fiscal_log (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  register_id uuid references public.registers (id) on delete set null,
  sale_id     uuid,
  user_id     uuid references auth.users (id) on delete set null,
  env         text not null,
  action      text not null check (action in ('verify', 'signcsr', 'coupon')),
  ok          boolean not null,
  http_status int,
  coupon_id   bigint,
  message     text,
  created_at  timestamptz not null default now()
);
create index if not exists fiscal_log_business_idx on public.fiscal_log (business_id, created_at desc);
alter table public.fiscal_log enable row level security;
drop policy if exists fiscal_log_select on public.fiscal_log;
create policy fiscal_log_select on public.fiscal_log for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager());

-- ---------------------------------------------------------------------
-- RPCs (caller's own JWT)
-- ---------------------------------------------------------------------

-- Everything the device needs to sign coupons for one register (any staff of the business).
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
  c public.fiscal_config;
begin
  if v_business is null then
    raise exception 'Nuk je i kyçur' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = v_business;
  select * into c from public.fiscal_config where id = 1;
  if p_register is not null then
    select * into r from public.registers where id = p_register and business_id = v_business;
  end if;
  return jsonb_build_object(
    'nui', b.nui, 'fiscal_number', b.fiscal_number, 'branch_id', b.fiscal_branch_id, 'env', b.fiscal_env,
    'location', coalesce(nullif(trim(b.city), ''), ''), 'business_name', b.name,
    'unit_saved_at', b.fiscal_unit_saved_at,
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

-- Hapi 1 – the fiscal unit (owner only).
create or replace function public.fiscal_save_unit(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_nui text := regexp_replace(coalesce(p->>'nui', ''), '\s', '', 'g');
  v_fiscal text := nullif(trim(coalesce(p->>'fiscal_number', '')), '');
  v_branch bigint := nullif(trim(coalesce(p->>'branch_id', '')), '')::bigint;
  v_env text := coalesce(nullif(p->>'env', ''), 'test');
  v_old public.businesses;
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  if v_nui !~ '^\d{9}$' then
    raise exception 'NUI ka 9 shifra' using errcode = '22023';
  end if;
  if v_fiscal is null then
    raise exception 'Shkruaj numrin e fiskalizimit (nga EDI)' using errcode = '22023';
  end if;
  if v_branch is null or v_branch <= 0 then
    raise exception 'Shkruaj numrin e njësisë (Branch ID) nga ATK' using errcode = '22023';
  end if;
  if v_env not in ('test', 'prod') then
    raise exception 'Mjedisi duhet të jetë test ose prod' using errcode = '22023';
  end if;
  select * into v_old from public.businesses where id = v_business;
  if v_env = 'prod' and (select application_id_prod from public.fiscal_config where id = 1) is null then
    raise exception 'Kasa nuk është certifikuar ende nga ATK – përdor mjedisin test' using errcode = '22023';
  end if;
  -- A registered register keeps its certificate only for the unit it was issued for.
  if exists (select 1 from public.registers where business_id = v_business and fiscal_status = 'registered')
     and (v_old.nui is distinct from v_nui or v_old.fiscal_branch_id is distinct from v_branch or v_old.fiscal_env is distinct from v_env) then
    raise exception 'Ka arka të regjistruara në ATK. Çregjistroji ato para se të ndryshosh NUI-n, njësinë ose mjedisin.' using errcode = '42501';
  end if;
  update public.businesses
     set nui = v_nui, fiscal_number = v_fiscal, fiscal_branch_id = v_branch, fiscal_env = v_env, fiscal_unit_saved_at = now()
   where id = v_business;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'fiscal_unit', 'business', v_business::text,
          jsonb_build_object('nui', v_nui, 'fiscal_number', v_fiscal, 'branch_id', v_branch, 'env', v_env));
end $$;

-- Hapi 2 – POS ID of a register (owner only; not while registered).
create or replace function public.fiscal_set_pos_id(p_register uuid, p_pos_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_pos text := nullif(trim(coalesce(p_pos_id, '')), '');
  r public.registers;
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  select * into r from public.registers where id = p_register and business_id = v_business;
  if not found then
    raise exception 'Arka nuk u gjet' using errcode = 'P0002';
  end if;
  if v_pos is not null and (v_pos !~ '^\d{1,4}$' or v_pos::int = 0) then
    raise exception 'POS ID është numër 1–9999 (ai që jep ATK)' using errcode = '22023';
  end if;
  if r.fiscal_status = 'registered' and v_pos is distinct from r.atk_pos_id then
    raise exception 'Arka është e regjistruar në ATK; çregjistroje para se ta ndryshosh POS ID-në' using errcode = '42501';
  end if;
  if v_pos is not null and exists (select 1 from public.registers where business_id = v_business and atk_pos_id = v_pos and id <> r.id) then
    raise exception 'Një arkë tjetër e ka këtë POS ID' using errcode = '23505';
  end if;
  perform set_config('kasa.fiscal_write', 'on', true);
  update public.registers set atk_pos_id = v_pos where id = r.id;
  perform set_config('kasa.fiscal_write', 'off', true);
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'fiscal_pos_id', 'register', r.id::text, jsonb_build_object('name', r.name, 'pos_id', v_pos));
end $$;

-- The owner takes the register off this device (lost/broken device or new key). The coupon
-- sequence is kept, so CouponIds never repeat. ATK has to be told separately.
create or replace function public.fiscal_unregister(p_register uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  r public.registers;
  v_pending int;
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  select * into r from public.registers where id = p_register and business_id = v_business;
  if not found then
    raise exception 'Arka nuk u gjet' using errcode = 'P0002';
  end if;
  select count(*) into v_pending from public.fiscal_coupons where register_id = r.id and status <> 'sent';
  perform set_config('kasa.fiscal_write', 'on', true);
  update public.registers
     set fiscal_status = 'none', fiscal_device_id = null, fiscal_platform = null, fiscal_public_key = null,
         fiscal_certificate = null, fiscal_env = null, fiscal_registered_at = null,
         coupon_seq = greatest(coupon_seq, coalesce((select max(coupon_seq) from public.fiscal_coupons where register_id = r.id), 0))
   where id = r.id;
  perform set_config('kasa.fiscal_write', 'off', true);
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'fiscal_unregister', 'register', r.id::text,
          jsonb_build_object('name', r.name, 'pos_id', r.atk_pos_id, 'pending', v_pending));
end $$;

-- Owner / manager: the registers with their fiscal state (Fiskalizimi page).
create or replace function public.fiscal_registers()
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
      'id', r.id, 'name', r.name, 'active', r.active, 'pos_id', r.atk_pos_id, 'status', r.fiscal_status,
      'device_id', r.fiscal_device_id, 'platform', r.fiscal_platform, 'env', r.fiscal_env,
      'registered_at', r.fiscal_registered_at, 'last_sent_at', r.fiscal_last_sent_at,
      'coupon_seq', r.coupon_seq,
      'app_version', (select d.app_version from public.devices d where d.register_id = r.id and d.active order by d.last_seen_at desc nulls last limit 1),
      'last_seen_at', (select max(d.last_seen_at) from public.devices d where d.register_id = r.id and d.active),
      'sent', (select count(*) from public.fiscal_coupons f where f.register_id = r.id and f.status = 'sent'),
      'pending', (select count(*) from public.fiscal_coupons f where f.register_id = r.id and f.status = 'pending'),
      'failed', (select count(*) from public.fiscal_coupons f where f.register_id = r.id and f.status = 'failed'),
      'oldest_pending', (select min(f.issued_at) from public.fiscal_coupons f where f.register_id = r.id and f.status <> 'sent'))
      order by r.created_at), '[]'::jsonb)
    from public.registers r where r.business_id = v_business
  );
end $$;

-- ---------------------------------------------------------------------
-- Service role only (fiscal-relay)
-- ---------------------------------------------------------------------

-- After /ca/signcsr answered with the certificate.
create or replace function public._fiscal_registered(p_register uuid, p_device text, p_platform text, p_public_key text, p_certificate text, p_env text, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.registers;
begin
  select * into r from public.registers where id = p_register for update;
  perform set_config('kasa.fiscal_write', 'on', true);
  update public.registers
     set fiscal_status = 'registered', fiscal_device_id = p_device, fiscal_platform = p_platform,
         fiscal_public_key = p_public_key, fiscal_certificate = p_certificate, fiscal_env = p_env, fiscal_registered_at = now()
   where id = p_register;
  perform set_config('kasa.fiscal_write', 'off', true);
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (r.business_id, p_user, 'fiscal_register', 'register', r.id::text,
          jsonb_build_object('name', r.name, 'pos_id', r.atk_pos_id, 'env', p_env, 'platform', p_platform));
end $$;

-- Stores a signed coupon (first time) or the result of a send (again). Returns the row.
create or replace function public._fiscal_store(p jsonb)
returns public.fiscal_coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fiscal_coupons;
  v_status text := p->>'status';
begin
  -- With the signed data: first store (ignored when the coupon is already there). Without: only the send result.
  if p ? 'details' then
    insert into public.fiscal_coupons (sale_id, business_id, register_id, env, coupon_type, coupon_id, coupon_seq, branch_id, pos_id,
                                       reference_no, verification_no, issued_at, details, signature, qr, offline)
    values ((p->>'sale_id')::uuid, (p->>'business_id')::uuid, (p->>'register_id')::uuid, p->>'env', (p->>'coupon_type')::smallint,
            (p->>'coupon_id')::bigint, (p->>'coupon_seq')::bigint, (p->>'branch_id')::bigint, (p->>'pos_id')::bigint,
            nullif(p->>'reference_no', '')::bigint, p->>'verification_no', (p->>'issued_at')::timestamptz,
            p->>'details', p->>'signature', p->>'qr', coalesce((p->>'offline')::boolean, false))
    on conflict (sale_id) do nothing;
  end if;

  update public.fiscal_coupons
     set status = coalesce(v_status, status),
         transaction_no = coalesce(nullif(p->>'transaction_no', '')::bigint, transaction_no),
         error = case when v_status = 'sent' then null else coalesce(p->>'error', error) end,
         attempts = attempts + case when v_status is null then 0 else 1 end,
         sent_at = case when v_status = 'sent' then now() else sent_at end,
         updated_at = now()
   where sale_id = (p->>'sale_id')::uuid
  returning * into f;

  perform set_config('kasa.fiscal_write', 'on', true);
  update public.registers
     set coupon_seq = greatest(coupon_seq, f.coupon_seq),
         fiscal_last_sent_at = case when v_status = 'sent' then now() else fiscal_last_sent_at end
   where id = f.register_id;
  perform set_config('kasa.fiscal_write', 'off', true);
  return f;
end $$;

-- ---------------------------------------------------------------------
-- Receipt data: the fiscal part of a sale (and the CouponId of the original)
-- ---------------------------------------------------------------------
create or replace function public.sale_fiscal(p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'coupon_id', f.coupon_id, 'coupon_type', f.coupon_type, 'verification_no', f.verification_no,
    'issued_at', f.issued_at, 'qr', f.qr, 'status', f.status, 'offline', f.offline,
    'transaction_no', f.transaction_no, 'error', f.error, 'branch_id', f.branch_id, 'pos_id', f.pos_id,
    'reference_no', f.reference_no, 'env', f.env)
  from public.fiscal_coupons f
  where f.sale_id = p_sale_id and f.business_id = public.current_business_id()
$$;

revoke execute on function public.registers_fiscal_guard() from public, anon, authenticated;
revoke execute on function public._fiscal_registered(uuid, text, text, text, text, text, uuid), public._fiscal_store(jsonb) from public, anon, authenticated;
grant execute on function public._fiscal_registered(uuid, text, text, text, text, text, uuid), public._fiscal_store(jsonb) to service_role;
revoke execute on function public.fiscal_context(uuid), public.fiscal_save_unit(jsonb), public.fiscal_set_pos_id(uuid, text),
  public.fiscal_unregister(uuid), public.fiscal_registers(), public.sale_fiscal(uuid) from public, anon;
grant execute on function public.fiscal_context(uuid), public.fiscal_save_unit(jsonb), public.fiscal_set_pos_id(uuid, text),
  public.fiscal_unregister(uuid), public.fiscal_registers(), public.sale_fiscal(uuid) to authenticated;
grant select on public.fiscal_config, public.fiscal_coupons, public.fiscal_log to authenticated;
