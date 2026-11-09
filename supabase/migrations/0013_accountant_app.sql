-- =====================================================================
-- 0013 – "Kasa Kontabilist": the accountant's own program.
--
-- * The platform admin creates accountant accounts (Edge Function platform-admin,
--   action create_accountant). No invitation from a business any more.
-- * acc_clients: the accountant's own clients – any business, in Kasa or not.
-- * acc_documents: sales and purchase invoices / expenses the accountant enters
--   for a client (amounts per VAT rate, as in the sales and purchase books).
-- * acc_periods: VAT status per client and month.
-- * Link with a business that uses Kasa: the accountant asks with the NUI
--   (acc_request_link), the owner approves in Cilësimet → Kontabilisti
--   (respond_accountant_request). Approval creates the active business_members row
--   from 0012, so the read-only access to the Kasa books (RLS, accounting_summary)
--   works as before. The owner can take it away at any time.
-- * accounting_summary is split: _accounting_summary_core(business, …) is reused
--   by acc_client_books for a linked client.
-- * The 0012 invitation (_link_accountant, respond_invitation, my_clients) is removed.
-- Older clients keep working: nothing the live app (main) uses changes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Accountants (created by the platform admin)
-- ---------------------------------------------------------------------
alter table public.accountants add column if not exists office_name text;
alter table public.accountants add column if not exists phone text;
alter table public.accountants add column if not exists active boolean not null default true;
alter table public.accountants add column if not exists created_by uuid references auth.users (id) on delete set null;

create or replace function public.is_accountant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.accountants a where a.user_id = auth.uid() and a.active)
     and not exists (select 1 from public.profiles p where p.id = auth.uid())
$$;

-- The Kasa business the accountant has open (0012), now also only while the account is active.
create or replace function public.accountant_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
  from public.user_active_business a
  join public.business_members m on m.user_id = a.user_id and m.business_id = a.business_id
  join public.businesses b on b.id = m.business_id
  join public.accountants ac on ac.user_id = a.user_id and ac.active
  where a.user_id = auth.uid()
    and m.status = 'active'
    and m.role = 'accountant'
    and b.active
    and not exists (select 1 from public.profiles p where p.id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Clients, documents, VAT periods
-- ---------------------------------------------------------------------
create table if not exists public.acc_clients (
  id                uuid primary key default gen_random_uuid(),
  accountant_id     uuid not null default auth.uid() references public.accountants (user_id) on delete cascade,
  name              text not null check (length(trim(name)) > 0),
  nui               text,
  vat_number        text,
  fiscal_number     text,
  vat_registered    boolean not null default false,
  activity          text,
  address           text,
  city              text,
  phone             text,
  email             text,
  note              text,
  active            boolean not null default true,
  kasa_business_id  uuid references public.businesses (id) on delete set null,
  link_status       text not null default 'none' check (link_status in ('none', 'pending', 'approved', 'rejected', 'revoked')),
  link_requested_at timestamptz,
  link_responded_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists acc_clients_accountant_idx on public.acc_clients (accountant_id);
create index if not exists acc_clients_kasa_idx on public.acc_clients (kasa_business_id) where kasa_business_id is not null;

create table if not exists public.acc_documents (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.acc_clients (id) on delete cascade,
  accountant_id uuid not null references public.accountants (user_id) on delete cascade,
  kind          text not null check (kind in ('sale', 'purchase')),
  category      text not null default 'goods' check (category in (
                  'goods', 'services', 'assets', 'rent', 'utilities', 'wages', 'contributions', 'taxes',
                  'telecom', 'transport', 'maintenance', 'marketing', 'bank', 'other')),
  doc_date      date not null,
  doc_no        text,
  partner_name  text,
  partner_nui   text,
  partner_vat   text,
  description   text,
  payment       text not null default 'bank' check (payment in ('cash', 'bank', 'due')),
  net_e         numeric(14, 2) not null default 0,   -- base at 18%
  vat_e         numeric(14, 2) not null default 0,
  net_d         numeric(14, 2) not null default 0,   -- base at 8%
  vat_d         numeric(14, 2) not null default 0,
  amt_c         numeric(14, 2) not null default 0,   -- 0%
  amt_a         numeric(14, 2) not null default 0,   -- exempt
  total         numeric(14, 2) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists acc_documents_client_idx on public.acc_documents (client_id, kind, doc_date);

create table if not exists public.acc_periods (
  client_id  uuid not null references public.acc_clients (id) on delete cascade,
  month      date not null check (extract(day from month) = 1),
  vat_status text not null default 'open' check (vat_status in ('open', 'filed')),
  note       text,
  closed_at  timestamptz,
  primary key (client_id, month)
);

alter table public.acc_clients   enable row level security;
alter table public.acc_documents enable row level security;
alter table public.acc_periods   enable row level security;

drop policy if exists acc_clients_own on public.acc_clients;
create policy acc_clients_own on public.acc_clients
  for select to authenticated using (accountant_id = auth.uid() and public.is_accountant());

drop policy if exists acc_documents_own on public.acc_documents;
create policy acc_documents_own on public.acc_documents
  for select to authenticated using (accountant_id = auth.uid() and public.is_accountant());

drop policy if exists acc_periods_own on public.acc_periods;
create policy acc_periods_own on public.acc_periods
  for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());

-- Writes only through the RPCs below.
revoke all on public.acc_clients, public.acc_documents, public.acc_periods from anon, authenticated;
grant select on public.acc_clients, public.acc_documents, public.acc_periods to authenticated;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._require_accountant()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_accountant() then
    raise exception 'Vetëm për kontabilistin' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function public._own_client(p_client uuid)
returns public.acc_clients
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients;
begin
  select * into c from public.acc_clients where id = p_client and accountant_id = public._require_accountant();
  if not found then
    raise exception 'Klienti nuk u gjet' using errcode = 'P0002';
  end if;
  return c;
end $$;

-- Who the session belongs to (the accountant program).
create or replace function public.acc_me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_accountant', public.is_accountant(),
    'accountant', (select jsonb_build_object('full_name', a.full_name, 'email', a.email, 'office_name', a.office_name,
                                              'phone', a.phone, 'active', a.active)
                   from public.accountants a where a.user_id = auth.uid()),
    'has_business', exists (select 1 from public.profiles p where p.id = auth.uid())
  )
$$;

-- ---------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------
create or replace function public.acc_save_client(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public._require_accountant();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_name text := trim(coalesce(p->>'name', ''));
  v_nui text := nullif(regexp_replace(coalesce(p->>'nui', ''), '\s', '', 'g'), '');
  v_vat text := nullif(trim(coalesce(p->>'vat_number', '')), '');
  t text := '';
begin
  if v_name = '' then
    raise exception 'Shkruaj emrin e klientit' using errcode = '22023';
  end if;
  if v_nui is not null and v_nui !~ '^\d{9}$' then
    raise exception 'NUI ka 9 shifra' using errcode = '22023';
  end if;
  if v_nui is not null and exists (select 1 from public.acc_clients where accountant_id = v_me and nui = v_nui and id is distinct from v_id) then
    raise exception 'Ke tashmë një klient me këtë NUI' using errcode = '23505';
  end if;

  if v_id is null then
    insert into public.acc_clients (accountant_id, name, nui, vat_number, fiscal_number, vat_registered, activity, address, city, phone, email, note)
    values (v_me, left(v_name, 200), v_nui, v_vat, nullif(trim(coalesce(p->>'fiscal_number', '')), ''),
            coalesce((p->>'vat_registered')::boolean, v_vat is not null),
            nullif(trim(left(coalesce(p->>'activity', ''), 200)), ''), nullif(trim(left(coalesce(p->>'address', ''), 200)), ''),
            nullif(trim(left(coalesce(p->>'city', ''), 100)), ''), nullif(trim(left(coalesce(p->>'phone', ''), 50)), ''),
            nullif(trim(left(coalesce(p->>'email', ''), 200)), ''), nullif(trim(left(coalesce(p->>'note', ''), 500)), ''))
    returning id into v_id;
  else
    update public.acc_clients set
      name = left(v_name, 200), nui = v_nui, vat_number = v_vat,
      fiscal_number = nullif(trim(coalesce(p->>'fiscal_number', '')), ''),
      vat_registered = coalesce((p->>'vat_registered')::boolean, v_vat is not null),
      activity = nullif(trim(left(coalesce(p->>'activity', ''), 200)), ''),
      address = nullif(trim(left(coalesce(p->>'address', ''), 200)), ''),
      city = nullif(trim(left(coalesce(p->>'city', ''), 100)), ''),
      phone = nullif(trim(left(coalesce(p->>'phone', ''), 50)), ''),
      email = nullif(trim(left(coalesce(p->>'email', ''), 200)), ''),
      note = nullif(trim(left(coalesce(p->>'note', ''), 500)), ''),
      active = coalesce((p->>'active')::boolean, active),
      updated_at = now()
    where id = v_id and accountant_id = v_me;
    if not found then
      raise exception 'Klienti nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

-- Deletes a client with all its documents. A Kasa link is taken back first.
create or replace function public.acc_delete_client(p_client uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if c.kasa_business_id is not null and c.link_status in ('pending', 'approved') then
    perform public.acc_cancel_link(p_client);
  end if;
  delete from public.acc_clients where id = c.id;
end $$;

-- ---------------------------------------------------------------------
-- Documents (sales and purchase invoices, expenses)
-- ---------------------------------------------------------------------
create or replace function public.acc_save_document(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_kind text := p->>'kind';
  v_cat text := coalesce(nullif(p->>'category', ''), 'goods');
  v_date date := (p->>'doc_date')::date;
  ne numeric := round(coalesce((p->>'net_e')::numeric, 0), 2);
  ve numeric := round(coalesce((p->>'vat_e')::numeric, 0), 2);
  nd numeric := round(coalesce((p->>'net_d')::numeric, 0), 2);
  vd numeric := round(coalesce((p->>'vat_d')::numeric, 0), 2);
  ac numeric := round(coalesce((p->>'amt_c')::numeric, 0), 2);
  aa numeric := round(coalesce((p->>'amt_a')::numeric, 0), 2);
  v_total numeric;
begin
  if v_kind not in ('sale', 'purchase') then
    raise exception 'Lloji i dokumentit nuk njihet' using errcode = '22023';
  end if;
  if v_kind = 'sale' and v_cat not in ('goods', 'services') then
    v_cat := 'goods';
  end if;
  if v_date is null or v_date < date '2000-01-01' or v_date > public._local_date() + 366 then
    raise exception 'Data nuk është e saktë' using errcode = '22023';
  end if;
  v_total := ne + ve + nd + vd + ac + aa;
  if v_total = 0 then
    raise exception 'Shkruaj shumat e faturës' using errcode = '22023';
  end if;
  if abs(v_total) > 100000000 then
    raise exception 'Shuma është shumë e madhe' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.acc_documents (client_id, accountant_id, kind, category, doc_date, doc_no, partner_name, partner_nui, partner_vat,
                                      description, payment, net_e, vat_e, net_d, vat_d, amt_c, amt_a, total)
    values (c.id, c.accountant_id, v_kind, v_cat, v_date,
            nullif(trim(left(coalesce(p->>'doc_no', ''), 60)), ''), nullif(trim(left(coalesce(p->>'partner_name', ''), 200)), ''),
            nullif(regexp_replace(coalesce(p->>'partner_nui', ''), '\s', '', 'g'), ''), nullif(trim(left(coalesce(p->>'partner_vat', ''), 30)), ''),
            nullif(trim(left(coalesce(p->>'description', ''), 300)), ''), coalesce(nullif(p->>'payment', ''), 'bank'),
            ne, ve, nd, vd, ac, aa, v_total)
    returning id into v_id;
  else
    update public.acc_documents set
      kind = v_kind, category = v_cat, doc_date = v_date,
      doc_no = nullif(trim(left(coalesce(p->>'doc_no', ''), 60)), ''),
      partner_name = nullif(trim(left(coalesce(p->>'partner_name', ''), 200)), ''),
      partner_nui = nullif(regexp_replace(coalesce(p->>'partner_nui', ''), '\s', '', 'g'), ''),
      partner_vat = nullif(trim(left(coalesce(p->>'partner_vat', ''), 30)), ''),
      description = nullif(trim(left(coalesce(p->>'description', ''), 300)), ''),
      payment = coalesce(nullif(p->>'payment', ''), 'bank'),
      net_e = ne, vat_e = ve, net_d = nd, vat_d = vd, amt_c = ac, amt_a = aa, total = v_total,
      updated_at = now()
    where id = v_id and client_id = c.id;
    if not found then
      raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.acc_delete_document(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.acc_documents where id = p_id and accountant_id = public._require_accountant();
  if not found then
    raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
  end if;
end $$;

-- Excel import: many documents at once (all or nothing).
create or replace function public.acc_import_documents(p_client uuid, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  n int := 0;
begin
  perform public._own_client(p_client);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Deri në 5000 rreshta njëherësh' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    begin
      perform public.acc_save_document((r - 'id') || jsonb_build_object('client_id', p_client));
    exception when others then
      raise exception 'Rreshti %: %', n, sqlerrm using errcode = '22023';
    end;
  end loop;
  return n;
end $$;

create or replace function public.acc_set_period(p_client uuid, p_month date, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if p_month is null or p_status not in ('open', 'filed') then
    raise exception 'Statusi nuk njihet' using errcode = '22023';
  end if;
  insert into public.acc_periods (client_id, month, vat_status, note, closed_at)
  values (c.id, date_trunc('month', p_month)::date, p_status, nullif(trim(coalesce(p_note, '')), ''), case when p_status = 'filed' then now() end)
  on conflict (client_id, month) do update
    set vat_status = excluded.vat_status, note = coalesce(excluded.note, public.acc_periods.note), closed_at = excluded.closed_at;
end $$;

-- ---------------------------------------------------------------------
-- Link with a business in Kasa (the owner approves)
-- ---------------------------------------------------------------------
create or replace function public.acc_request_link(p_client uuid, p_nui text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_nui text := regexp_replace(coalesce(p_nui, ''), '\s', '', 'g');
  v_biz uuid;
  v_count int;
begin
  if v_nui !~ '^\d{9}$' then
    raise exception 'NUI ka 9 shifra' using errcode = '22023';
  end if;
  select count(*), min(id::text)::uuid into v_count, v_biz from public.businesses where nui = v_nui and active;
  if v_count = 0 then
    raise exception 'Asnjë biznes aktiv në Kasa me këtë NUI. Pronari duhet ta shkruajë NUI-n te Cilësimet → Të dhënat e biznesit.' using errcode = 'P0002';
  end if;
  if v_count > 1 then
    raise exception 'Më shumë se një biznes në Kasa ka këtë NUI. Kontakto administratorin e platformës.' using errcode = '23505';
  end if;
  if exists (select 1 from public.acc_clients where accountant_id = c.accountant_id and kasa_business_id = v_biz and id <> c.id) then
    raise exception 'Ky biznes është lidhur tashmë me një klient tjetër tëndin' using errcode = '23505';
  end if;
  if c.kasa_business_id = v_biz and c.link_status = 'approved' then
    return;
  end if;
  update public.acc_clients
     set kasa_business_id = v_biz, link_status = 'pending', link_requested_at = now(), link_responded_at = null,
         nui = coalesce(nui, v_nui), updated_at = now()
   where id = c.id;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_biz, auth.uid(), 'accountant_request', 'accountant', auth.uid()::text,
          (select jsonb_build_object('name', a.full_name, 'email', a.email, 'office', a.office_name) from public.accountants a where a.user_id = auth.uid()));
end $$;

-- The accountant takes the link back (or deletes the client).
create or replace function public.acc_cancel_link(p_client uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if c.kasa_business_id is null then
    return;
  end if;
  update public.business_members set status = 'revoked', revoked_at = now()
   where user_id = c.accountant_id and business_id = c.kasa_business_id and status <> 'revoked';
  delete from public.user_active_business where user_id = c.accountant_id and business_id = c.kasa_business_id;
  update public.acc_clients set kasa_business_id = null, link_status = 'none', link_requested_at = null, link_responded_at = null, updated_at = now()
   where id = c.id;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (c.kasa_business_id, auth.uid(), 'accountant_unlink', 'accountant', auth.uid()::text,
          (select jsonb_build_object('name', a.full_name, 'email', a.email) from public.accountants a where a.user_id = auth.uid()));
end $$;

-- Owner / manager: the accountants of the business (requests and approved ones).
drop function if exists public.business_accountants();
create or replace function public.business_accountants()
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
             'client_id', c.id, 'user_id', c.accountant_id, 'full_name', a.full_name, 'email', a.email,
             'office_name', a.office_name, 'phone', a.phone, 'status', c.link_status,
             'requested_at', c.link_requested_at, 'responded_at', c.link_responded_at,
             'last_opened_at', m.last_opened_at)
           order by case c.link_status when 'pending' then 0 when 'approved' then 1 else 2 end, c.link_requested_at desc), '[]'::jsonb)
    from public.acc_clients c
    join public.accountants a on a.user_id = c.accountant_id
    left join public.business_members m on m.user_id = c.accountant_id and m.business_id = c.kasa_business_id
    where c.kasa_business_id = v_business and c.link_status in ('pending', 'approved') and a.active
  );
end $$;

-- Owner approves or rejects a request.
create or replace function public.respond_accountant_request(p_client uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  c public.acc_clients;
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  select * into c from public.acc_clients where id = p_client and kasa_business_id = v_business and link_status = 'pending';
  if not found then
    raise exception 'Kërkesa nuk u gjet' using errcode = 'P0002';
  end if;
  update public.acc_clients
     set link_status = case when p_approve then 'approved' else 'rejected' end, link_responded_at = now(), updated_at = now()
   where id = c.id;
  if p_approve then
    insert into public.business_members (user_id, business_id, role, status, invited_by, responded_at)
    values (c.accountant_id, v_business, 'accountant', 'active', auth.uid(), now())
    on conflict (user_id, business_id) do update
      set status = 'active', invited_by = excluded.invited_by, responded_at = now(), revoked_at = null;
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), case when p_approve then 'accountant_approve' else 'accountant_reject' end,
          'accountant', c.accountant_id::text,
          (select jsonb_build_object('name', a.full_name, 'email', a.email, 'office', a.office_name) from public.accountants a where a.user_id = c.accountant_id));
end $$;

-- Owner takes the access away.
create or replace function public.revoke_accountant(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  update public.acc_clients set link_status = 'revoked', link_responded_at = now(), updated_at = now()
   where accountant_id = p_user and kasa_business_id = v_business and link_status in ('pending', 'approved');
  update public.business_members set status = 'revoked', revoked_at = now()
   where user_id = p_user and business_id = v_business and status <> 'revoked';
  if not found and not exists (select 1 from public.acc_clients where accountant_id = p_user and kasa_business_id = v_business and link_status = 'revoked') then
    raise exception 'Kontabilisti nuk u gjet' using errcode = 'P0002';
  end if;
  delete from public.user_active_business where user_id = p_user and business_id = v_business;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'accountant_revoke', 'accountant', p_user::text,
          (select jsonb_build_object('name', a.full_name, 'email', a.email) from public.accountants a where a.user_id = p_user));
end $$;

-- Open a linked Kasa business (or none): only through an approved link of an active account.
create or replace function public.set_active_business(p_business uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Nuk je i kyçur' using errcode = '42501';
  end if;
  if p_business is null then
    delete from public.user_active_business where user_id = auth.uid();
    return;
  end if;
  if not public.is_accountant() then
    raise exception 'Nuk ke qasje në këtë biznes' using errcode = '42501';
  end if;
  select m.last_opened_at into v_last
  from public.business_members m
  join public.businesses b on b.id = m.business_id
  where m.user_id = auth.uid() and m.business_id = p_business and m.status = 'active' and b.active;
  if not found then
    raise exception 'Nuk ke qasje në këtë biznes' using errcode = '42501';
  end if;
  insert into public.user_active_business (user_id, business_id)
  values (auth.uid(), p_business)
  on conflict (user_id) do update set business_id = excluded.business_id, updated_at = now();
  update public.business_members set last_opened_at = now() where user_id = auth.uid() and business_id = p_business;
  if v_last is null or v_last < now() - interval '30 minutes' then
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (p_business, auth.uid(), 'accountant_open', 'accountant', auth.uid()::text,
            jsonb_build_object('name', (select full_name from public.accountants where user_id = auth.uid())));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Books: the Kasa part (shared by the owner's panel and the accountant program)
-- ---------------------------------------------------------------------
create or replace function public._accounting_summary_core(p_business uuid, p_from date, p_to date, p_manager boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := p_business;
  v_manager boolean := p_manager;
  v_biz jsonb;
  v_sales jsonb;
  v_vat_out jsonb;
  v_purchases jsonb;
  v_vat_in jsonb;
  v_expenses jsonb;
  v_exp_cat jsonb;
  v_exp_vat jsonb;
  v_cogs jsonb;
  v_stock jsonb;
  v_adjust jsonb;
  v_daily jsonb;
  v_shifts jsonb;
  v_registers jsonb;
  v_period jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Periudha nuk është e saktë (deri në 400 ditë)' using errcode = '22023';
  end if;

  select jsonb_build_object('id', b.id, 'name', b.name, 'type', b.type, 'city', b.city, 'address', b.address,
                            'nui', b.nui, 'vat_number', b.vat_number, 'fiscal_number', b.fiscal_number,
                            'vat_registered', nullif(trim(coalesce(b.vat_number, '')), '') is not null)
    into v_biz from public.businesses b where b.id = v_business;

  select jsonb_build_object(
    'gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_total), 0), 'vat', coalesce(sum(vat_total), 0),
    'docs', count(*) filter (where kind = 'sale'),
    'voids', count(*) filter (where kind = 'void'), 'void_total', coalesce(sum(total) filter (where kind = 'void'), 0),
    'refunds', count(*) filter (where kind = 'refund'), 'refund_total', coalesce(sum(total) filter (where kind = 'refund'), 0),
    'cash', coalesce(sum(cash_amount), 0), 'card', coalesce(sum(card_amount), 0),
    'discounts', coalesce(sum(discount_total), 0),
    'offline', count(*) filter (where offline),
    'first_no', min(invoice_no), 'last_no', max(invoice_no)
  ) into v_sales
  from public.sales where business_id = v_business and sale_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'gross', gross, 'net', net, 'vat', vat) order by code), '[]'::jsonb)
    into v_vat_out
  from (
    select l->>'code' as code, sum((l->>'gross')::numeric) as gross, sum((l->>'net')::numeric) as net, sum((l->>'vat')::numeric) as vat
    from public.sales s, jsonb_array_elements(s.vat_lines) l
    where s.business_id = v_business and s.sale_date between p_from and p_to
    group by 1
  ) t;

  select jsonb_build_object(
    'gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_total), 0), 'vat', coalesce(sum(vat_total), 0),
    'docs', count(*),
    'due', coalesce(sum(total) filter (where payment = 'due'), 0),
    'cash', coalesce(sum(total) filter (where payment = 'cash'), 0),
    'bank', coalesce(sum(total) filter (where payment = 'bank'), 0)
  ) into v_purchases
  from public.stock_entries
  where business_id = v_business and status = 'confirmed' and entry_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'gross', gross, 'net', net, 'vat', vat) order by code), '[]'::jsonb)
    into v_vat_in
  from (
    select l->>'code' as code, sum((l->>'gross')::numeric) as gross, sum((l->>'net')::numeric) as net, sum((l->>'vat')::numeric) as vat
    from public.stock_entries e, jsonb_array_elements(e.vat_lines) l
    where e.business_id = v_business and e.status = 'confirmed' and e.entry_date between p_from and p_to
    group by 1
  ) t;

  select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_total), 0),
                            'vat', coalesce(sum(vat_total), 0), 'docs', count(*),
                            'due', coalesce(sum(total) filter (where payment = 'due'), 0))
    into v_expenses
  from public.expenses where business_id = v_business and expense_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'gross', gross, 'net', net, 'vat', vat) order by gross desc), '[]'::jsonb)
    into v_exp_cat
  from (
    select category, sum(total) as gross, sum(net_total) as net, sum(vat_total) as vat
    from public.expenses where business_id = v_business and expense_date between p_from and p_to
    group by category
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'gross', gross, 'net', net, 'vat', vat) order by code), '[]'::jsonb)
    into v_exp_vat
  from (
    select vat_code::text as code, sum(total) as gross, sum(net_total) as net, sum(vat_total) as vat
    from public.expenses where business_id = v_business and expense_date between p_from and p_to
    group by vat_code
  ) t;

  -- Cost of goods sold from the purchase prices stored at sale time (VAT included → also without VAT).
  select jsonb_build_object(
    'gross', coalesce(round(sum(i.quantity * coalesce(c.purchase_price, 0)), 2), 0),
    'net', coalesce(round(sum(i.quantity * coalesce(c.purchase_price, 0) / (1 + i.vat_rate)), 2), 0)
  ) into v_cogs
  from public.sale_items i
  join public.sales s on s.id = i.sale_id
  left join public.sale_item_costs c on c.sale_item_id = i.id
  where s.business_id = v_business and s.sale_date between p_from and p_to;

  -- Stock on hand today, at purchase price.
  select jsonb_build_object(
    'items', count(*) filter (where p.stock > 0),
    'gross', coalesce(round(sum(p.stock * coalesce(c.purchase_price, 0)) filter (where p.stock > 0), 2), 0),
    'net', coalesce(round(sum(p.stock * coalesce(c.purchase_price, 0) / (1 + public._vat_rate(p.vat_code))) filter (where p.stock > 0), 2), 0),
    'sale_value', coalesce(round(sum(p.stock * p.sale_price) filter (where p.stock > 0), 2), 0)
  ) into v_stock
  from public.products p
  left join public.product_costs c on c.product_id = p.id
  where p.business_id = v_business and p.kind = 'product' and p.active;

  -- Write-offs and inventory differences in the period, at today's purchase price.
  select jsonb_build_object(
    'writeoffs', coalesce(round(sum(m.quantity * coalesce(c.purchase_price, 0)) filter (where m.kind = 'adjustment'), 2), 0),
    'inventory', coalesce(round(sum(m.quantity * coalesce(c.purchase_price, 0)) filter (where m.kind = 'inventory'), 2), 0)
  ) into v_adjust
  from public.stock_movements m
  left join public.product_costs c on c.product_id = m.product_id
  where m.business_id = v_business and m.kind in ('adjustment', 'inventory')
    and m.created_at >= public._day_start(p_from) and m.created_at < public._day_start(p_to + 1);

  -- Daily sales book (the day's totals per VAT rate, as on the daily report of the till).
  select coalesce(jsonb_agg(d order by d->>'date'), '[]'::jsonb) into v_daily
  from (
    select jsonb_build_object(
      'date', s.sale_date, 'docs', count(*) filter (where s.kind = 'sale'),
      'corrections', count(*) filter (where s.kind <> 'sale'),
      'first_no', min(s.invoice_no), 'last_no', max(s.invoice_no),
      'gross', sum(s.total), 'net', sum(s.net_total), 'vat', sum(s.vat_total),
      'cash', sum(s.cash_amount), 'card', sum(s.card_amount),
      'rates', (
        select coalesce(jsonb_object_agg(code, jsonb_build_object('gross', gross, 'net', net, 'vat', vat)), '{}'::jsonb)
        from (
          select l->>'code' as code, sum((l->>'gross')::numeric) as gross, sum((l->>'net')::numeric) as net, sum((l->>'vat')::numeric) as vat
          from public.sales s2, jsonb_array_elements(s2.vat_lines) l
          where s2.business_id = v_business and s2.sale_date = s.sale_date
          group by 1
        ) r
      )
    ) as d
    from public.sales s
    where s.business_id = v_business and s.sale_date between p_from and p_to
    group by s.sale_date
  ) t;

  -- Cash reconciliation per closed shift: opening + cash sales of that shift vs. counted cash.
  select coalesce(jsonb_agg(x order by x->>'started_at' desc), '[]'::jsonb) into v_shifts
  from (
    select jsonb_build_object(
      'id', h.id, 'started_at', h.started_at, 'ended_at', h.ended_at,
      'register', (select r.name from public.registers r where r.id = h.register_id),
      'worker', case when v_manager then (select nullif(pr.full_name, '') from public.profiles pr where pr.id = h.worker_id) end,
      'opening', h.opening_cash, 'counted', h.closing_cash,
      'cash_sales', coalesce(cs.cash, 0), 'card_sales', coalesce(cs.card, 0), 'docs', coalesce(cs.docs, 0)
    ) as x
    from public.shifts h
    left join lateral (
      select sum(s.cash_amount) as cash, sum(s.card_amount) as card, count(*) filter (where s.kind = 'sale') as docs
      from public.sales s
      where s.business_id = v_business and s.worker_id = h.worker_id
        and s.created_at >= h.started_at and s.created_at < coalesce(h.ended_at, now())
    ) cs on true
    where h.business_id = v_business
      and h.started_at >= public._day_start(p_from) and h.started_at < public._day_start(p_to + 1)
    order by h.started_at desc
    limit 500
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name), '[]'::jsonb)
    into v_registers from public.registers r where r.business_id = v_business;

  select coalesce(jsonb_agg(jsonb_build_object('month', p.month, 'vat_status', p.vat_status, 'note', p.note, 'closed_at', p.closed_at) order by p.month), '[]'::jsonb)
    into v_period
  from public.accounting_periods p
  where p.business_id = v_business and p.month between date_trunc('month', p_from)::date and p_to;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'business', v_biz,
    'sales', v_sales, 'vat_out', v_vat_out,
    'purchases', v_purchases, 'vat_in', v_vat_in,
    'expenses', v_expenses, 'expense_categories', v_exp_cat, 'expense_vat', v_exp_vat,
    'cogs', v_cogs, 'stock', v_stock, 'adjustments', v_adjust,
    'daily', v_daily, 'shifts', v_shifts, 'registers', v_registers, 'periods', v_period
  );
end $$;

create or replace function public.accounting_summary(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public._accounting_summary_core(public._require_books(), p_from, p_to, public.is_manager())
$$;

-- VAT rows of a client's documents: [{code, net, vat, gross}].
create or replace function public._acc_vat_rows(p_client uuid, p_kind text, p_from date, p_to date, p_group text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'net', net, 'vat', vat, 'gross', net + vat) order by code), '[]'::jsonb)
  from (
    select x.code, sum(x.net) as net, sum(x.vat) as vat
    from public.acc_documents d,
         lateral (values ('E', d.net_e, d.vat_e), ('D', d.net_d, d.vat_d), ('C', d.amt_c, 0::numeric), ('A', d.amt_a, 0::numeric)) as x(code, net, vat)
    where d.client_id = p_client and d.kind = p_kind and d.doc_date between p_from and p_to
      and (p_group = 'all'
           or (p_group = 'stock' and d.category in ('goods', 'assets'))
           or (p_group = 'expense' and d.category not in ('goods', 'assets')))
    group by x.code
    having sum(x.net) <> 0 or sum(x.vat) <> 0
  ) t
$$;

-- Everything the program shows for one client and period.
create or replace function public.acc_client_books(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_kasa jsonb;
  v_manual jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Periudha nuk është e saktë (deri në 400 ditë)' using errcode = '22023';
  end if;

  if c.kasa_business_id is not null and c.link_status = 'approved'
     and exists (select 1 from public.business_members m join public.businesses b on b.id = m.business_id
                 where m.user_id = c.accountant_id and m.business_id = c.kasa_business_id and m.status = 'active' and b.active) then
    v_kasa := public._accounting_summary_core(c.kasa_business_id, p_from, p_to, false);
  end if;

  select jsonb_build_object(
    'sales', (select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_e + net_d + amt_c + amt_a), 0),
                                        'vat', coalesce(sum(vat_e + vat_d), 0), 'docs', count(*))
              from public.acc_documents where client_id = c.id and kind = 'sale' and doc_date between p_from and p_to),
    'vat_out', public._acc_vat_rows(c.id, 'sale', p_from, p_to, 'all'),
    'purchases', (select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_e + net_d + amt_c + amt_a), 0),
                                            'vat', coalesce(sum(vat_e + vat_d), 0), 'docs', count(*),
                                            'due', coalesce(sum(total) filter (where payment = 'due'), 0),
                                            'cash', coalesce(sum(total) filter (where payment = 'cash'), 0),
                                            'bank', coalesce(sum(total) filter (where payment = 'bank'), 0))
                  from public.acc_documents where client_id = c.id and kind = 'purchase' and category in ('goods', 'assets') and doc_date between p_from and p_to),
    'vat_in', public._acc_vat_rows(c.id, 'purchase', p_from, p_to, 'stock'),
    'cogs', (select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_e + net_d + amt_c + amt_a), 0))
             from public.acc_documents where client_id = c.id and kind = 'purchase' and category = 'goods' and doc_date between p_from and p_to),
    'expenses', (select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_e + net_d + amt_c + amt_a), 0),
                                           'vat', coalesce(sum(vat_e + vat_d), 0), 'docs', count(*),
                                           'due', coalesce(sum(total) filter (where payment = 'due'), 0))
                 from public.acc_documents where client_id = c.id and kind = 'purchase' and category not in ('goods', 'assets') and doc_date between p_from and p_to),
    'expense_categories', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'gross', gross, 'net', net, 'vat', vat) order by gross desc), '[]'::jsonb)
                           from (select category, sum(total) as gross, sum(net_e + net_d + amt_c + amt_a) as net, sum(vat_e + vat_d) as vat
                                 from public.acc_documents where client_id = c.id and kind = 'purchase' and category not in ('goods', 'assets') and doc_date between p_from and p_to
                                 group by category) t),
    'expense_vat', public._acc_vat_rows(c.id, 'purchase', p_from, p_to, 'expense'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
                       'date', doc_date, 'docs', docs, 'gross', gross, 'net', net, 'vat', vat,
                       'rates', jsonb_strip_nulls(jsonb_build_object(
                          'E', case when ne <> 0 or ve <> 0 then jsonb_build_object('net', ne, 'vat', ve, 'gross', ne + ve) end,
                          'D', case when nd <> 0 or vd <> 0 then jsonb_build_object('net', nd, 'vat', vd, 'gross', nd + vd) end,
                          'C', case when ac <> 0 then jsonb_build_object('net', ac, 'vat', 0, 'gross', ac) end,
                          'A', case when aa <> 0 then jsonb_build_object('net', aa, 'vat', 0, 'gross', aa) end))
                     ) order by doc_date), '[]'::jsonb)
              from (select doc_date, count(*) as docs, sum(total) as gross, sum(net_e + net_d + amt_c + amt_a) as net, sum(vat_e + vat_d) as vat,
                           sum(net_e) as ne, sum(vat_e) as ve, sum(net_d) as nd, sum(vat_d) as vd, sum(amt_c) as ac, sum(amt_a) as aa
                    from public.acc_documents where client_id = c.id and kind = 'sale' and doc_date between p_from and p_to
                    group by doc_date) t)
  ) into v_manual;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'client', to_jsonb(c) - 'accountant_id',
    'manual', v_manual,
    'kasa', v_kasa,
    'periods', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'vat_status', vat_status, 'note', note, 'closed_at', closed_at) order by month), '[]'::jsonb)
                from public.acc_periods where client_id = c.id and month between date_trunc('month', p_from)::date and p_to)
  );
end $$;

-- "Klientët": every client of the accountant with the month's figures.
create or replace function public.acc_clients_overview(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public._require_accountant();
  v_from date := date_trunc('month', coalesce(p_month, public._local_date()))::date;
  v_to date := (date_trunc('month', coalesce(p_month, public._local_date())) + interval '1 month - 1 day')::date;
begin
  return (
    select coalesce(jsonb_agg(row order by (row->>'active')::boolean desc, row->>'name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'nui', c.nui, 'vat_number', c.vat_number, 'vat_registered', c.vat_registered,
        'city', c.city, 'activity', c.activity, 'note', c.note, 'active', c.active,
        'link_status', c.link_status, 'kasa_name', case when c.link_status = 'approved' then b.name end,
        'kasa_type', case when c.link_status = 'approved' then b.type end,
        'sales', coalesce(ms.gross, 0) + coalesce(ks.gross, 0),
        'docs', coalesce(ms.docs, 0) + coalesce(ks.docs, 0),
        'purchases', coalesce(mp.gross, 0) + coalesce(ke.gross, 0),
        'vat_out', coalesce(ms.vat, 0) + coalesce(ks.vat, 0),
        'vat_in', coalesce(mp.vat, 0) + coalesce(ke.vat, 0) + coalesce(kx.vat, 0),
        'corrections', coalesce(ks.corrections, 0),
        'offline', coalesce(ks.offline, 0),
        'last_activity', greatest((select max(d.updated_at) from public.acc_documents d where d.client_id = c.id), ks.last_at),
        'vat_status', case when not c.vat_registered then 'na'
                           else coalesce((select p.vat_status from public.acc_periods p where p.client_id = c.id and p.month = v_from), 'open') end
      ) as row
      from public.acc_clients c
      left join public.businesses b on b.id = c.kasa_business_id
      left join lateral (
        select sum(total) as gross, sum(vat_e + vat_d) as vat, count(*) as docs
        from public.acc_documents where client_id = c.id and kind = 'sale' and doc_date between v_from and v_to
      ) ms on true
      left join lateral (
        select sum(total) as gross, sum(vat_e + vat_d) as vat
        from public.acc_documents where client_id = c.id and kind = 'purchase' and doc_date between v_from and v_to
      ) mp on true
      left join lateral (
        select sum(s.total) as gross, sum(s.vat_total) as vat, count(*) filter (where s.kind = 'sale') as docs,
               count(*) filter (where s.kind <> 'sale') as corrections, count(*) filter (where s.offline) as offline,
               max(s.created_at) as last_at
        from public.sales s
        where c.link_status = 'approved' and b.active and s.business_id = c.kasa_business_id and s.sale_date between v_from and v_to
      ) ks on true
      left join lateral (
        select sum(e.total) as gross, sum(e.vat_total) as vat
        from public.stock_entries e
        where c.link_status = 'approved' and b.active and e.business_id = c.kasa_business_id and e.status = 'confirmed' and e.entry_date between v_from and v_to
      ) ke on true
      left join lateral (
        select sum(x.vat_total) as vat
        from public.expenses x
        where c.link_status = 'approved' and b.active and x.business_id = c.kasa_business_id and x.expense_date between v_from and v_to
      ) kx on true
      where c.accountant_id = v_me
    ) t
  );
end $$;

-- ---------------------------------------------------------------------
-- Platform admin: the accountants
-- ---------------------------------------------------------------------
create or replace function public.platform_accountants()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Vetëm për adminin e platformës' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', a.user_id, 'full_name', a.full_name, 'email', a.email, 'office_name', a.office_name,
             'phone', a.phone, 'active', a.active, 'created_at', a.created_at,
             'clients', (select count(*) from public.acc_clients c where c.accountant_id = a.user_id),
             'kasa_clients', (select count(*) from public.acc_clients c where c.accountant_id = a.user_id and c.link_status = 'approved'),
             'last_sign_in_at', u.last_sign_in_at)
           order by a.created_at desc), '[]'::jsonb)
    from public.accountants a
    left join auth.users u on u.id = a.user_id
  );
end $$;

create or replace function public.platform_set_accountant_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Vetëm për adminin e platformës' using errcode = '42501';
  end if;
  update public.accountants set active = p_active where user_id = p_user;
  if not found then
    raise exception 'Kontabilisti nuk u gjet' using errcode = 'P0002';
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), case when p_active then 'accountant_activate' else 'accountant_deactivate' end, 'accountant', p_user::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- The 0012 invitation is gone (the platform creates accountants, owners approve requests).
-- ---------------------------------------------------------------------
drop function if exists public._link_accountant(uuid, uuid, text, text);
drop function if exists public.respond_invitation(uuid, boolean);
drop function if exists public.my_clients(date);

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.is_accountant(), public._require_accountant(), public._own_client(uuid), public.acc_me(),
  public.acc_save_client(jsonb), public.acc_delete_client(uuid), public.acc_save_document(jsonb), public.acc_delete_document(uuid),
  public.acc_import_documents(uuid, jsonb), public.acc_set_period(uuid, date, text, text), public.acc_request_link(uuid, text),
  public.acc_cancel_link(uuid), public.business_accountants(), public.respond_accountant_request(uuid, boolean),
  public.revoke_accountant(uuid), public.set_active_business(uuid), public._accounting_summary_core(uuid, date, date, boolean),
  public.accounting_summary(date, date), public._acc_vat_rows(uuid, text, date, date, text), public.acc_client_books(uuid, date, date),
  public.acc_clients_overview(date), public.platform_accountants(), public.platform_set_accountant_active(uuid, boolean),
  public.accountant_business_id() from public, anon;
grant execute on function public.is_accountant(), public.acc_me(),
  public.acc_save_client(jsonb), public.acc_delete_client(uuid), public.acc_save_document(jsonb), public.acc_delete_document(uuid),
  public.acc_import_documents(uuid, jsonb), public.acc_set_period(uuid, date, text, text), public.acc_request_link(uuid, text),
  public.acc_cancel_link(uuid), public.business_accountants(), public.respond_accountant_request(uuid, boolean),
  public.revoke_accountant(uuid), public.set_active_business(uuid), public.accounting_summary(date, date),
  public.acc_client_books(uuid, date, date), public.acc_clients_overview(date), public.platform_accountants(),
  public.platform_set_accountant_active(uuid, boolean), public.accountant_business_id() to authenticated;
-- Internal helpers are called only from the functions above.
revoke execute on function public._require_accountant(), public._own_client(uuid), public._accounting_summary_core(uuid, date, date, boolean),
  public._acc_vat_rows(uuid, text, date, date, text) from authenticated;
