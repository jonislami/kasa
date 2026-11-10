-- =====================================================================
-- 0016 – Kasa Kontabilist, phase K1: partners, invoices with lines, payments, debts.
--
-- * acc_clients: legal form, representative, registration date, bank account (for the invoice).
-- * acc_partners: customers and suppliers of each client (NUI, fiscal no., VAT no., contacts).
-- * acc_documents gets: partner, document type (invoice / credit note / debit note) with the
--   reference to the original, due date, export, non-deductible VAT (vat_nd), discount, note,
--   instalments, automatic numbers (F-2026-0001, KR-…, DB-…, PF-…), lines.
--   kind 'proforma' is a new kind, so every existing book query (kind = 'sale' / 'purchase')
--   leaves proformas out without change.
-- * acc_document_lines: products / services with quantity, price without VAT, discount, rate.
-- * acc_payments: payments (in for sales, out for purchases) by cash or bank.
-- * acc_doc_balances (view): paid, credited, open amount and payment status per document.
-- * acc_doc_history: who created / changed / paid what (historiku i ndryshimeve).
-- * acc_files + storage bucket "acc-files": PDF / photo of an invoice or expense.
-- Amounts of a credit note are stored negative, so every sum (sales, VAT, profit) is right as is.
-- Non-deductible VAT (vat_nd) is part of the cost, not of the input VAT.
-- Older clients keep working: nothing the live app uses changes shape.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Clients: data printed on the invoice
-- ---------------------------------------------------------------------
alter table public.acc_clients add column if not exists legal_form text;
alter table public.acc_clients add column if not exists representative text;
alter table public.acc_clients add column if not exists registration_date date;
alter table public.acc_clients add column if not exists bank_name text;
alter table public.acc_clients add column if not exists iban text;

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
  v_form text := nullif(trim(coalesce(p->>'legal_form', '')), '');
  v_reg date := nullif(p->>'registration_date', '')::date;
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
    insert into public.acc_clients (accountant_id, name, nui, vat_number, fiscal_number, vat_registered, activity, address, city, phone, email, note,
                                    legal_form, representative, registration_date, bank_name, iban)
    values (v_me, left(v_name, 200), v_nui, v_vat, nullif(trim(coalesce(p->>'fiscal_number', '')), ''),
            coalesce((p->>'vat_registered')::boolean, v_vat is not null),
            nullif(trim(left(coalesce(p->>'activity', ''), 200)), ''), nullif(trim(left(coalesce(p->>'address', ''), 200)), ''),
            nullif(trim(left(coalesce(p->>'city', ''), 100)), ''), nullif(trim(left(coalesce(p->>'phone', ''), 50)), ''),
            nullif(trim(left(coalesce(p->>'email', ''), 200)), ''), nullif(trim(left(coalesce(p->>'note', ''), 500)), ''),
            left(v_form, 60), nullif(trim(left(coalesce(p->>'representative', ''), 120)), ''), v_reg,
            nullif(trim(left(coalesce(p->>'bank_name', ''), 100)), ''), nullif(upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g')), ''))
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
      legal_form = left(v_form, 60),
      representative = nullif(trim(left(coalesce(p->>'representative', ''), 120)), ''),
      registration_date = v_reg,
      bank_name = nullif(trim(left(coalesce(p->>'bank_name', ''), 100)), ''),
      iban = nullif(upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g')), ''),
      active = coalesce((p->>'active')::boolean, active),
      updated_at = now()
    where id = v_id and accountant_id = v_me;
    if not found then
      raise exception 'Klienti nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Partners (customers / suppliers of a client)
-- ---------------------------------------------------------------------
create table if not exists public.acc_partners (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.acc_clients (id) on delete cascade,
  accountant_id uuid not null references public.accountants (user_id) on delete cascade,
  role          text not null default 'customer' check (role in ('customer', 'supplier', 'both')),
  name          text not null check (length(trim(name)) > 0),
  nui           text,
  fiscal_number text,
  vat_number    text,
  address       text,
  city          text,
  country       text not null default 'Kosovë',
  phone         text,
  email         text,
  note          text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists acc_partners_client_idx on public.acc_partners (client_id, name);
create unique index if not exists acc_partners_nui_idx on public.acc_partners (client_id, nui) where nui is not null;

-- ---------------------------------------------------------------------
-- Documents: new columns
-- ---------------------------------------------------------------------
alter table public.acc_documents drop constraint if exists acc_documents_kind_check;
alter table public.acc_documents add constraint acc_documents_kind_check check (kind in ('sale', 'purchase', 'proforma'));
alter table public.acc_documents drop constraint if exists acc_documents_category_check;
alter table public.acc_documents add constraint acc_documents_category_check check (category in (
  'goods', 'services', 'assets', 'rent', 'utilities', 'wages', 'contributions', 'taxes', 'telecom', 'transport',
  'maintenance', 'marketing', 'bank', 'fuel', 'vehicles', 'admin', 'operating', 'travel', 'representation', 'other'));

alter table public.acc_documents add column if not exists partner_id uuid references public.acc_partners (id) on delete set null;
alter table public.acc_documents add column if not exists partner_address text;
alter table public.acc_documents add column if not exists doc_type text not null default 'invoice'
  check (doc_type in ('invoice', 'credit_note', 'debit_note'));
alter table public.acc_documents add column if not exists ref_doc_id uuid references public.acc_documents (id) on delete set null;
alter table public.acc_documents add column if not exists due_date date;
alter table public.acc_documents add column if not exists export boolean not null default false;
alter table public.acc_documents add column if not exists vat_nd numeric(14, 2) not null default 0;   -- non-deductible VAT (purchases)
alter table public.acc_documents add column if not exists discount_total numeric(14, 2) not null default 0;
alter table public.acc_documents add column if not exists note text;
alter table public.acc_documents add column if not exists installments jsonb;
alter table public.acc_documents add column if not exists auto_number boolean not null default false;
alter table public.acc_documents add column if not exists has_lines boolean not null default false;
alter table public.acc_documents add column if not exists converted_to uuid references public.acc_documents (id) on delete set null;
alter table public.acc_documents add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.acc_documents add column if not exists updated_by uuid references auth.users (id) on delete set null;
create index if not exists acc_documents_partner_idx on public.acc_documents (partner_id);
create index if not exists acc_documents_ref_idx on public.acc_documents (ref_doc_id) where ref_doc_id is not null;

create table if not exists public.acc_document_lines (
  id           uuid primary key default gen_random_uuid(),
  doc_id       uuid not null references public.acc_documents (id) on delete cascade,
  position     int not null,
  description  text not null,
  unit         text not null default 'copë',
  quantity     numeric(14, 3) not null,
  unit_price   numeric(14, 4) not null,      -- without VAT
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  vat_code     char(1) not null check (vat_code in ('E', 'D', 'C', 'A')),
  net          numeric(14, 2) not null       -- after discount, without VAT
);
create index if not exists acc_document_lines_doc_idx on public.acc_document_lines (doc_id, position);

create table if not exists public.acc_payments (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.acc_clients (id) on delete cascade,
  doc_id     uuid not null references public.acc_documents (id) on delete cascade,
  pay_date   date not null,
  amount     numeric(14, 2) not null check (amount > 0),
  method     text not null check (method in ('cash', 'bank')),
  reference  text,
  note       text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists acc_payments_doc_idx on public.acc_payments (doc_id);
create index if not exists acc_payments_client_idx on public.acc_payments (client_id, pay_date);

create table if not exists public.acc_counters (
  client_id uuid not null references public.acc_clients (id) on delete cascade,
  series    text not null,
  year      int not null,
  last_no   int not null default 0,
  primary key (client_id, series, year)
);

create table if not exists public.acc_doc_history (
  id         bigint generated always as identity primary key,
  doc_id     uuid not null references public.acc_documents (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  action     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists acc_doc_history_doc_idx on public.acc_doc_history (doc_id, id);

create table if not exists public.acc_files (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.acc_clients (id) on delete cascade,
  doc_id      uuid references public.acc_documents (id) on delete cascade,
  path        text not null unique,          -- <client_id>/<uuid>-<name> in bucket acc-files
  file_name   text not null,
  mime        text,
  size_bytes  bigint,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists acc_files_doc_idx on public.acc_files (doc_id);

-- Balance of every document: paid, credited (credit notes pointing to it), open, status.
create or replace view public.acc_doc_balances with (security_invoker = true) as
select d.id, d.client_id, d.kind, d.doc_type, d.partner_id, d.doc_date, coalesce(d.due_date, d.doc_date) as due_date, d.total,
       pay.paid, cr.credited,
       case
         when d.kind = 'proforma' then 0
         when d.doc_type = 'credit_note' and d.ref_doc_id is not null then 0
         when d.doc_type = 'credit_note' then d.total + pay.paid
         else d.total + cr.credited - pay.paid
       end as open
from public.acc_documents d
left join lateral (
  select case
           when exists (select 1 from public.acc_payments x where x.doc_id = d.id) then (select sum(x.amount) from public.acc_payments x where x.doc_id = d.id)
           when d.payment <> 'due' and d.kind <> 'proforma' then abs(d.total)   -- older entries: paid at once by cash / bank
           else 0
         end as paid
) pay on true
left join lateral (
  select coalesce(sum(c.total), 0) as credited
  from public.acc_documents c
  where c.ref_doc_id = d.id and c.doc_type = 'credit_note'
) cr on true;

-- ---------------------------------------------------------------------
-- RLS: read own rows; writes only through the RPCs
-- ---------------------------------------------------------------------
alter table public.acc_partners       enable row level security;
alter table public.acc_document_lines enable row level security;
alter table public.acc_payments       enable row level security;
alter table public.acc_counters       enable row level security;
alter table public.acc_doc_history    enable row level security;
alter table public.acc_files          enable row level security;

drop policy if exists acc_partners_own on public.acc_partners;
create policy acc_partners_own on public.acc_partners for select to authenticated
  using (accountant_id = auth.uid() and public.is_accountant());
drop policy if exists acc_document_lines_own on public.acc_document_lines;
create policy acc_document_lines_own on public.acc_document_lines for select to authenticated
  using (exists (select 1 from public.acc_documents d where d.id = doc_id and d.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_payments_own on public.acc_payments;
create policy acc_payments_own on public.acc_payments for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_doc_history_own on public.acc_doc_history;
create policy acc_doc_history_own on public.acc_doc_history for select to authenticated
  using (exists (select 1 from public.acc_documents d where d.id = doc_id and d.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_files_own on public.acc_files;
create policy acc_files_own on public.acc_files for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());

revoke all on public.acc_partners, public.acc_document_lines, public.acc_payments, public.acc_counters, public.acc_doc_history, public.acc_files from anon, authenticated;
grant select on public.acc_partners, public.acc_document_lines, public.acc_payments, public.acc_doc_history, public.acc_files, public.acc_doc_balances to authenticated;

-- Files: private bucket, one folder per client of the accountant.
insert into storage.buckets (id, name, public, file_size_limit)
values ('acc-files', 'acc-files', false, 20971520)
on conflict (id) do nothing;

drop policy if exists acc_files_read on storage.objects;
create policy acc_files_read on storage.objects for select to authenticated
  using (bucket_id = 'acc-files' and public.is_accountant()
         and (storage.foldername(name))[1] in (select c.id::text from public.acc_clients c where c.accountant_id = auth.uid()));
drop policy if exists acc_files_write on storage.objects;
create policy acc_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'acc-files' and public.is_accountant()
              and (storage.foldername(name))[1] in (select c.id::text from public.acc_clients c where c.accountant_id = auth.uid()));
drop policy if exists acc_files_delete on storage.objects;
create policy acc_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'acc-files' and public.is_accountant()
         and (storage.foldername(name))[1] in (select c.id::text from public.acc_clients c where c.accountant_id = auth.uid()));

-- ---------------------------------------------------------------------
-- Partners
-- ---------------------------------------------------------------------
create or replace function public.acc_save_partner(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_name text := trim(coalesce(p->>'name', ''));
  v_nui text := nullif(regexp_replace(coalesce(p->>'nui', ''), '\s', '', 'g'), '');
  v_role text := coalesce(nullif(p->>'role', ''), 'customer');
begin
  if v_name = '' then
    raise exception 'Shkruaj emrin e partnerit' using errcode = '22023';
  end if;
  if v_role not in ('customer', 'supplier', 'both') then
    raise exception 'Roli i partnerit nuk njihet' using errcode = '22023';
  end if;
  if v_nui is not null and v_nui !~ '^\d{9}$' then
    raise exception 'NUI ka 9 shifra' using errcode = '22023';
  end if;
  if v_nui is not null and exists (select 1 from public.acc_partners where client_id = c.id and nui = v_nui and id is distinct from v_id) then
    raise exception 'Një partner tjetër i këtij klienti e ka këtë NUI' using errcode = '23505';
  end if;
  if v_id is null then
    insert into public.acc_partners (client_id, accountant_id, role, name, nui, fiscal_number, vat_number, address, city, country, phone, email, note)
    values (c.id, c.accountant_id, v_role, left(v_name, 200), v_nui,
            nullif(trim(left(coalesce(p->>'fiscal_number', ''), 30)), ''), nullif(trim(left(coalesce(p->>'vat_number', ''), 30)), ''),
            nullif(trim(left(coalesce(p->>'address', ''), 200)), ''), nullif(trim(left(coalesce(p->>'city', ''), 100)), ''),
            coalesce(nullif(trim(left(coalesce(p->>'country', ''), 60)), ''), 'Kosovë'),
            nullif(trim(left(coalesce(p->>'phone', ''), 50)), ''), nullif(trim(left(coalesce(p->>'email', ''), 200)), ''),
            nullif(trim(left(coalesce(p->>'note', ''), 500)), ''))
    returning id into v_id;
  else
    update public.acc_partners set
      role = v_role, name = left(v_name, 200), nui = v_nui,
      fiscal_number = nullif(trim(left(coalesce(p->>'fiscal_number', ''), 30)), ''),
      vat_number = nullif(trim(left(coalesce(p->>'vat_number', ''), 30)), ''),
      address = nullif(trim(left(coalesce(p->>'address', ''), 200)), ''),
      city = nullif(trim(left(coalesce(p->>'city', ''), 100)), ''),
      country = coalesce(nullif(trim(left(coalesce(p->>'country', ''), 60)), ''), 'Kosovë'),
      phone = nullif(trim(left(coalesce(p->>'phone', ''), 50)), ''),
      email = nullif(trim(left(coalesce(p->>'email', ''), 200)), ''),
      note = nullif(trim(left(coalesce(p->>'note', ''), 500)), ''),
      active = coalesce((p->>'active')::boolean, active),
      updated_at = now()
    where id = v_id and client_id = c.id;
    if not found then
      raise exception 'Partneri nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

-- A partner with documents is only archived; one without is deleted.
create or replace function public.acc_delete_partner(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
begin
  select client_id into v_client from public.acc_partners where id = p_id and accountant_id = public._require_accountant();
  if not found then
    raise exception 'Partneri nuk u gjet' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.acc_documents where partner_id = p_id) then
    update public.acc_partners set active = false, updated_at = now() where id = p_id;
    return 'archived';
  end if;
  delete from public.acc_partners where id = p_id;
  return 'deleted';
end $$;

-- Partners of a client with their open balances (what they owe us / what we owe them).
create or replace function public.acc_partners_list(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(pt) - 'accountant_id' || jsonb_build_object(
             'receivable', coalesce(b.receivable, 0), 'payable', coalesce(b.payable, 0),
             'overdue', coalesce(b.overdue, 0), 'docs', coalesce(b.docs, 0), 'last_doc', b.last_doc)
           order by pt.active desc, pt.name), '[]'::jsonb)
    from public.acc_partners pt
    left join lateral (
      select sum(x.open) filter (where x.kind = 'sale') as receivable,
             sum(x.open) filter (where x.kind = 'purchase') as payable,
             sum(x.open) filter (where x.due_date < public._local_date() and x.open > 0) as overdue,
             count(*) filter (where x.kind <> 'proforma') as docs, max(x.doc_date) as last_doc
      from public.acc_doc_balances x where x.partner_id = pt.id
    ) b on true
    where pt.client_id = c.id
  );
end $$;

-- ---------------------------------------------------------------------
-- Invoices with lines (sale, purchase, proforma; invoice / credit note / debit note)
-- ---------------------------------------------------------------------
create or replace function public._acc_next_number(p_client uuid, p_series text, p_year int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_no int;
begin
  insert into public.acc_counters (client_id, series, year, last_no) values (p_client, p_series, p_year, 1)
  on conflict (client_id, series, year) do update set last_no = public.acc_counters.last_no + 1
  returning last_no into v_no;
  return p_series || '-' || p_year || '-' || lpad(v_no::text, 4, '0');
end $$;

create or replace function public.acc_save_invoice(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.acc_documents;
  v_kind text := p->>'kind';
  v_type text := coalesce(nullif(p->>'doc_type', ''), 'invoice');
  v_cat text := coalesce(nullif(p->>'category', ''), 'goods');
  v_date date := (p->>'doc_date')::date;
  v_due date := nullif(p->>'due_date', '')::date;
  v_ref uuid := nullif(p->>'ref_doc_id', '')::uuid;
  v_partner public.acc_partners;
  v_no text := nullif(trim(left(coalesce(p->>'doc_no', ''), 60)), '');
  v_auto boolean := false;
  v_export boolean := coalesce((p->>'export')::boolean, false);
  v_deductible boolean := coalesce((p->>'vat_deductible')::boolean, true);
  v_sign int;
  v_lines jsonb := coalesce(p->'lines', '[]'::jsonb);
  l jsonb;
  i int := 0;
  v_q numeric; v_price numeric; v_disc numeric; v_code text; v_net numeric; v_gross_before numeric;
  ne numeric := 0; nd numeric := 0; ac numeric := 0; aa numeric := 0; ve numeric := 0; vd numeric := 0; vnd numeric := 0;
  v_disc_total numeric := 0;
  v_total numeric;
  v_series text;
  v_pay jsonb := p->'paid_now';
begin
  if v_kind not in ('sale', 'purchase', 'proforma') then
    raise exception 'Lloji i dokumentit nuk njihet' using errcode = '22023';
  end if;
  if v_type not in ('invoice', 'credit_note', 'debit_note') or (v_kind = 'proforma' and v_type <> 'invoice') then
    raise exception 'Lloji i faturës nuk njihet' using errcode = '22023';
  end if;
  if v_kind <> 'purchase' and v_cat not in ('goods', 'services') then
    v_cat := 'goods';
  end if;
  if v_date is null or v_date < date '2000-01-01' or v_date > public._local_date() + 366 then
    raise exception 'Data nuk është e saktë' using errcode = '22023';
  end if;
  if v_due is not null and v_due < v_date then
    raise exception 'Afati i pagesës nuk mund të jetë para datës së faturës' using errcode = '22023';
  end if;
  if v_type <> 'invoice' then
    if v_ref is null then
      raise exception 'Fatura korrigjuese duhet t''i referohet faturës origjinale' using errcode = '22023';
    end if;
    if not exists (select 1 from public.acc_documents where id = v_ref and client_id = c.id and kind = v_kind and doc_type = 'invoice') then
      raise exception 'Fatura origjinale nuk u gjet' using errcode = 'P0002';
    end if;
  else
    v_ref := null;
  end if;
  if nullif(p->>'partner_id', '') is not null then
    select * into v_partner from public.acc_partners where id = (p->>'partner_id')::uuid and client_id = c.id;
    if not found then
      raise exception 'Partneri nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  if v_id is not null then
    select * into v_old from public.acc_documents where id = v_id and client_id = c.id;
    if not found then
      raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
    end if;
    if v_old.kind <> v_kind then
      raise exception 'Lloji i dokumentit nuk ndryshohet' using errcode = '22023';
    end if;
  end if;
  v_sign := case when v_type = 'credit_note' then -1 else 1 end;

  -- Amounts: from the lines (price without VAT), or entered per rate (no lines).
  if jsonb_array_length(v_lines) > 0 then
    for l in select * from jsonb_array_elements(v_lines) loop
      i := i + 1;
      v_q := round(coalesce((l->>'quantity')::numeric, 0), 3);
      v_price := round(coalesce((l->>'unit_price')::numeric, 0), 4);
      v_disc := round(coalesce((l->>'discount_pct')::numeric, 0), 2);
      v_code := case when v_export then 'C' else coalesce(nullif(l->>'vat_code', ''), 'E') end;
      if trim(coalesce(l->>'description', '')) = '' then
        raise exception 'Rreshti % nuk ka përshkrim', i using errcode = '22023';
      end if;
      if v_q <= 0 or v_price < 0 or v_disc < 0 or v_disc > 100 or v_code not in ('E', 'D', 'C', 'A') then
        raise exception 'Rreshti % nuk është i saktë (sasia, çmimi, zbritja ose TVSH)', i using errcode = '22023';
      end if;
      v_gross_before := round(v_q * v_price, 2);
      v_net := round(v_q * v_price * (1 - v_disc / 100), 2);
      v_disc_total := v_disc_total + (v_gross_before - v_net);
      case v_code when 'E' then ne := ne + v_net; when 'D' then nd := nd + v_net; when 'C' then ac := ac + v_net; else aa := aa + v_net; end case;
    end loop;
    ve := round(ne * 0.18, 2);
    vd := round(nd * 0.08, 2);
  else
    ne := round(abs(coalesce((p->>'net_e')::numeric, 0)), 2);
    ve := round(abs(coalesce((p->>'vat_e')::numeric, 0)), 2);
    nd := round(abs(coalesce((p->>'net_d')::numeric, 0)), 2);
    vd := round(abs(coalesce((p->>'vat_d')::numeric, 0)), 2);
    ac := round(abs(coalesce((p->>'amt_c')::numeric, 0)), 2);
    aa := round(abs(coalesce((p->>'amt_a')::numeric, 0)), 2);
    if v_export then
      ac := ac + ne + nd + aa; ne := 0; nd := 0; aa := 0; ve := 0; vd := 0;
    end if;
  end if;
  -- Purchases whose VAT cannot be deducted: the VAT is a cost (vat_nd), not input VAT.
  if v_kind = 'purchase' and not v_deductible then
    vnd := ve + vd; ve := 0; vd := 0;
  end if;
  v_total := ne + ve + nd + vd + ac + aa + vnd;
  if v_total = 0 then
    raise exception 'Fatura nuk ka shuma' using errcode = '22023';
  end if;
  if v_total > 100000000 then
    raise exception 'Shuma është shumë e madhe' using errcode = '22023';
  end if;

  -- Number: sales, proformas and corrections get the next number of their series when left empty.
  if v_kind = 'purchase' then
    if v_no is null then
      raise exception 'Shkruaj numrin e faturës së furnitorit' using errcode = '22023';
    end if;
    -- The same supplier invoice twice?
    if not coalesce((p->>'force')::boolean, false) and exists (
      select 1 from public.acc_documents d
      where d.client_id = c.id and d.kind = 'purchase' and d.doc_type = v_type and d.id is distinct from v_id
        and lower(d.doc_no) = lower(v_no)
        and ((v_partner.id is not null and d.partner_id = v_partner.id)
             or (coalesce(v_partner.nui, nullif(regexp_replace(coalesce(p->>'partner_nui', ''), '\s', '', 'g'), '')) is not null
                 and d.partner_nui = coalesce(v_partner.nui, nullif(regexp_replace(coalesce(p->>'partner_nui', ''), '\s', '', 'g'), '')))
             or (v_partner.id is null and d.partner_id is null and lower(coalesce(d.partner_name, '')) = lower(trim(coalesce(p->>'partner_name', '')))))
    ) then
      raise exception 'Kjo faturë (nr. %) e këtij furnitori është regjistruar tashmë', v_no using errcode = '23505', hint = 'duplicate';
    end if;
  elsif v_id is not null then
    v_no := coalesce(v_no, v_old.doc_no);
    v_auto := v_old.auto_number and v_no = v_old.doc_no;
  elsif v_no is null then
    v_series := case when v_kind = 'proforma' then 'PF' when v_type = 'credit_note' then 'KR' when v_type = 'debit_note' then 'DB' else 'F' end;
    v_no := public._acc_next_number(c.id, v_series, extract(year from v_date)::int);
    v_auto := true;
  end if;
  if v_kind <> 'purchase' and exists (
    select 1 from public.acc_documents where client_id = c.id and kind = v_kind and lower(doc_no) = lower(v_no) and id is distinct from v_id
  ) then
    raise exception 'Numri % përdoret tashmë', v_no using errcode = '23505';
  end if;

  if v_id is null then
    insert into public.acc_documents (client_id, accountant_id, kind, doc_type, category, doc_date, due_date, doc_no, auto_number,
                                      partner_id, partner_name, partner_nui, partner_vat, partner_address, description, note, payment,
                                      ref_doc_id, export, net_e, vat_e, net_d, vat_d, amt_c, amt_a, vat_nd, discount_total, total,
                                      installments, has_lines, created_by, updated_by)
    values (c.id, c.accountant_id, v_kind, v_type, v_cat, v_date, v_due, v_no, v_auto,
            v_partner.id, coalesce(v_partner.name, nullif(trim(left(coalesce(p->>'partner_name', ''), 200)), '')),
            coalesce(v_partner.nui, nullif(regexp_replace(coalesce(p->>'partner_nui', ''), '\s', '', 'g'), '')),
            coalesce(v_partner.vat_number, nullif(trim(left(coalesce(p->>'partner_vat', ''), 30)), '')),
            coalesce(nullif(concat_ws(', ', v_partner.address, v_partner.city), ''), nullif(trim(left(coalesce(p->>'partner_address', ''), 200)), '')),
            nullif(trim(left(coalesce(p->>'description', ''), 300)), ''), nullif(trim(left(coalesce(p->>'note', ''), 1000)), ''),
            'due', v_ref, v_export,
            v_sign * ne, v_sign * ve, v_sign * nd, v_sign * vd, v_sign * ac, v_sign * aa, v_sign * vnd, v_disc_total, v_sign * v_total,
            nullif(p->'installments', 'null'::jsonb), jsonb_array_length(v_lines) > 0, auth.uid(), auth.uid())
    returning id into v_id;
    insert into public.acc_doc_history (doc_id, user_id, action, details)
    values (v_id, auth.uid(), 'create', jsonb_build_object('doc_no', v_no, 'total', v_sign * v_total));
  else
    update public.acc_documents set
      doc_type = v_type, category = v_cat, doc_date = v_date, due_date = v_due, doc_no = v_no, auto_number = v_auto,
      partner_id = v_partner.id,
      partner_name = coalesce(v_partner.name, nullif(trim(left(coalesce(p->>'partner_name', ''), 200)), '')),
      partner_nui = coalesce(v_partner.nui, nullif(regexp_replace(coalesce(p->>'partner_nui', ''), '\s', '', 'g'), '')),
      partner_vat = coalesce(v_partner.vat_number, nullif(trim(left(coalesce(p->>'partner_vat', ''), 30)), '')),
      partner_address = coalesce(nullif(concat_ws(', ', v_partner.address, v_partner.city), ''), nullif(trim(left(coalesce(p->>'partner_address', ''), 200)), '')),
      description = nullif(trim(left(coalesce(p->>'description', ''), 300)), ''),
      note = nullif(trim(left(coalesce(p->>'note', ''), 1000)), ''),
      payment = case when exists (select 1 from public.acc_payments x where x.doc_id = v_id) then 'due' else payment end,
      ref_doc_id = v_ref, export = v_export,
      net_e = v_sign * ne, vat_e = v_sign * ve, net_d = v_sign * nd, vat_d = v_sign * vd, amt_c = v_sign * ac, amt_a = v_sign * aa,
      vat_nd = v_sign * vnd, discount_total = v_disc_total, total = v_sign * v_total,
      installments = nullif(p->'installments', 'null'::jsonb), has_lines = jsonb_array_length(v_lines) > 0,
      updated_by = auth.uid(), updated_at = now()
    where id = v_id;
    insert into public.acc_doc_history (doc_id, user_id, action, details)
    values (v_id, auth.uid(), 'update', jsonb_build_object('doc_no', v_no, 'total', v_sign * v_total, 'before', v_old.total));
  end if;

  delete from public.acc_document_lines where doc_id = v_id;
  i := 0;
  for l in select * from jsonb_array_elements(v_lines) loop
    i := i + 1;
    insert into public.acc_document_lines (doc_id, position, description, unit, quantity, unit_price, discount_pct, vat_code, net)
    values (v_id, i, left(trim(l->>'description'), 300), coalesce(nullif(trim(l->>'unit'), ''), 'copë'),
            round((l->>'quantity')::numeric, 3), round((l->>'unit_price')::numeric, 4), round(coalesce((l->>'discount_pct')::numeric, 0), 2),
            case when v_export then 'C' else coalesce(nullif(l->>'vat_code', ''), 'E') end,
            round(round((l->>'quantity')::numeric, 3) * round((l->>'unit_price')::numeric, 4) * (1 - round(coalesce((l->>'discount_pct')::numeric, 0), 2) / 100), 2));
  end loop;

  -- Paid at once (cash / bank): one payment for the whole amount.
  if v_pay is not null and jsonb_typeof(v_pay) = 'object' and v_kind <> 'proforma' and v_type <> 'credit_note' then
    perform public.acc_save_payment(jsonb_build_object('doc_id', v_id, 'amount', v_total, 'pay_date', v_date,
                                                       'method', coalesce(v_pay->>'method', 'bank'), 'reference', v_pay->>'reference'));
  end if;

  return jsonb_build_object('id', v_id, 'doc_no', v_no);
end $$;

-- Proforma → invoice (copy with the lines, next invoice number).
create or replace function public.acc_convert_proforma(p_id uuid, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
  r jsonb;
begin
  select * into d from public.acc_documents where id = p_id and accountant_id = public._require_accountant() and kind = 'proforma';
  if not found then
    raise exception 'Proforma nuk u gjet' using errcode = 'P0002';
  end if;
  if d.converted_to is not null then
    raise exception 'Kjo proformë është kthyer tashmë në faturë' using errcode = '23505';
  end if;
  r := public.acc_save_invoice(jsonb_build_object(
    'client_id', d.client_id, 'kind', 'sale', 'category', d.category, 'doc_date', coalesce(p_date, public._local_date()),
    'due_date', case when d.due_date is not null then coalesce(p_date, public._local_date()) + (d.due_date - d.doc_date) end,
    'partner_id', d.partner_id, 'partner_name', d.partner_name, 'partner_nui', d.partner_nui, 'partner_vat', d.partner_vat,
    'partner_address', d.partner_address, 'description', d.description, 'note', d.note, 'export', d.export,
    'installments', d.installments,
    'net_e', d.net_e, 'vat_e', d.vat_e, 'net_d', d.net_d, 'vat_d', d.vat_d, 'amt_c', d.amt_c, 'amt_a', d.amt_a,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('description', description, 'unit', unit, 'quantity', quantity,
                                                           'unit_price', unit_price, 'discount_pct', discount_pct, 'vat_code', vat_code) order by position), '[]'::jsonb)
              from public.acc_document_lines where doc_id = d.id)));
  update public.acc_documents set converted_to = (r->>'id')::uuid where id = d.id;
  insert into public.acc_doc_history (doc_id, user_id, action, details) values (d.id, auth.uid(), 'converted', jsonb_build_object('invoice', r->>'doc_no'));
  return r;
end $$;

-- Deleting keeps a trace in the history of the original (credit notes) – and is refused while
-- credit/debit notes point to the document.
create or replace function public.acc_delete_document(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
begin
  select * into d from public.acc_documents where id = p_id and accountant_id = public._require_accountant();
  if not found then
    raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.acc_documents where ref_doc_id = p_id) then
    raise exception 'Kjo faturë ka fatura korrigjuese; fshiji ato së pari' using errcode = '23503';
  end if;
  if d.ref_doc_id is not null then
    insert into public.acc_doc_history (doc_id, user_id, action, details)
    values (d.ref_doc_id, auth.uid(), 'correction_deleted', jsonb_build_object('doc_no', d.doc_no, 'total', d.total));
  end if;
  update public.acc_documents set converted_to = null where converted_to = p_id;
  delete from public.acc_documents where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------
create or replace function public.acc_save_payment(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
  b public.acc_doc_balances;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_amount numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  v_date date := coalesce(nullif(p->>'pay_date', '')::date, public._local_date());
  v_method text := coalesce(nullif(p->>'method', ''), 'bank');
  v_old numeric := 0;
  v_open numeric;
begin
  select * into d from public.acc_documents where id = (p->>'doc_id')::uuid and accountant_id = public._require_accountant();
  if not found then
    raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
  end if;
  if d.kind = 'proforma' then
    raise exception 'Proforma nuk paguhet; ktheje së pari në faturë' using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'Shuma e pagesës duhet të jetë mbi zero' using errcode = '22023';
  end if;
  if v_method not in ('cash', 'bank') then
    raise exception 'Mënyra e pagesës nuk njihet' using errcode = '22023';
  end if;
  if v_date < d.doc_date - 366 or v_date > public._local_date() + 31 then
    raise exception 'Data e pagesës nuk është e saktë' using errcode = '22023';
  end if;
  if v_id is not null then
    select amount into v_old from public.acc_payments where id = v_id and doc_id = d.id;
    if not found then
      raise exception 'Pagesa nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  -- An older entry marked "cash/bank" counts as paid; the first explicit payment replaces that.
  if d.payment <> 'due' then
    update public.acc_documents set payment = 'due' where id = d.id;
  end if;
  select * into b from public.acc_doc_balances where id = d.id;
  v_open := abs(b.open) + v_old;
  if v_amount > v_open + 0.01 then
    raise exception 'Pagesa (%) është më e madhe se shuma e mbetur (%)', v_amount, v_open using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.acc_payments (client_id, doc_id, pay_date, amount, method, reference, note, created_by)
    values (d.client_id, d.id, v_date, v_amount, v_method, nullif(trim(left(coalesce(p->>'reference', ''), 100)), ''),
            nullif(trim(left(coalesce(p->>'note', ''), 300)), ''), auth.uid())
    returning id into v_id;
  else
    update public.acc_payments set pay_date = v_date, amount = v_amount, method = v_method,
           reference = nullif(trim(left(coalesce(p->>'reference', ''), 100)), ''), note = nullif(trim(left(coalesce(p->>'note', ''), 300)), '')
     where id = v_id;
  end if;
  insert into public.acc_doc_history (doc_id, user_id, action, details)
  values (d.id, auth.uid(), 'payment', jsonb_build_object('amount', v_amount, 'method', v_method, 'date', v_date));
  return v_id;
end $$;

create or replace function public.acc_delete_payment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.acc_payments;
begin
  select pm.* into x from public.acc_payments pm join public.acc_clients c on c.id = pm.client_id
   where pm.id = p_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Pagesa nuk u gjet' using errcode = 'P0002';
  end if;
  delete from public.acc_payments where id = p_id;
  insert into public.acc_doc_history (doc_id, user_id, action, details)
  values (x.doc_id, auth.uid(), 'payment_deleted', jsonb_build_object('amount', x.amount, 'date', x.pay_date));
end $$;

-- ---------------------------------------------------------------------
-- Lists, document detail, debts, partner statement
-- ---------------------------------------------------------------------
create or replace function public.acc_documents_list(p_client uuid, p_kind text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(d) - 'accountant_id' || jsonb_build_object(
             'paid', b.paid, 'credited', b.credited, 'open', b.open,
             'pay_status', case when d.kind = 'proforma' then null
                                when d.doc_type = 'credit_note' and d.ref_doc_id is not null then 'applied'
                                when abs(b.open) < 0.005 then 'paid'
                                when b.paid > 0 or b.credited <> 0 then 'partial'
                                else 'unpaid' end,
             'overdue_days', case when b.open > 0.005 and b.due_date < public._local_date() then public._local_date() - b.due_date end,
             'ref_doc_no', (select r.doc_no from public.acc_documents r where r.id = d.ref_doc_id),
             'files', (select count(*) from public.acc_files f where f.doc_id = d.id))
           order by d.doc_date desc, d.created_at desc), '[]'::jsonb)
    from public.acc_documents d
    join public.acc_doc_balances b on b.id = d.id
    where d.client_id = c.id and d.kind = p_kind and d.doc_date between p_from and p_to
  );
end $$;

create or replace function public.acc_document_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
  b public.acc_doc_balances;
begin
  select * into d from public.acc_documents where id = p_id and accountant_id = public._require_accountant();
  if not found then
    raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
  end if;
  select * into b from public.acc_doc_balances where id = d.id;
  return to_jsonb(d) - 'accountant_id' || jsonb_build_object(
    'paid', b.paid, 'credited', b.credited, 'open', b.open,
    'lines', (select coalesce(jsonb_agg(to_jsonb(l) - 'doc_id' order by l.position), '[]'::jsonb) from public.acc_document_lines l where l.doc_id = d.id),
    'payments', (select coalesce(jsonb_agg(to_jsonb(x) - 'client_id' order by x.pay_date, x.created_at), '[]'::jsonb) from public.acc_payments x where x.doc_id = d.id),
    'corrections', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'doc_no', r.doc_no, 'doc_type', r.doc_type, 'doc_date', r.doc_date, 'total', r.total) order by r.doc_date), '[]'::jsonb)
                    from public.acc_documents r where r.ref_doc_id = d.id),
    'ref_doc', (select jsonb_build_object('id', r.id, 'doc_no', r.doc_no, 'doc_date', r.doc_date, 'total', r.total) from public.acc_documents r where r.id = d.ref_doc_id),
    'converted_doc_no', (select r.doc_no from public.acc_documents r where r.id = d.converted_to),
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'file_name', f.file_name, 'mime', f.mime, 'size_bytes', f.size_bytes, 'created_at', f.created_at) order by f.created_at), '[]'::jsonb)
              from public.acc_files f where f.doc_id = d.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('action', h.action, 'details', h.details, 'created_at', h.created_at,
                                                             'user_name', coalesce((select a.full_name from public.accountants a where a.user_id = h.user_id), '')) order by h.id), '[]'::jsonb)
                from public.acc_doc_history h where h.doc_id = d.id)
  );
end $$;

-- Debts of a client: receivable (customers) or payable (suppliers), by partner and age.
create or replace function public.acc_debts(p_client uuid, p_side text, p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_as_of date := coalesce(p_as_of, public._local_date());
  v_kind text := case p_side when 'payable' then 'purchase' else 'sale' end;
begin
  if p_side not in ('receivable', 'payable') then
    raise exception 'Zgjidh borxhet e klientëve ose të furnitorëve' using errcode = '22023';
  end if;
  return (
    with docs as (
      select d.id, d.doc_no, d.doc_date, b.due_date, d.total, b.open, d.partner_id,
             coalesce(d.partner_name, '—') as partner_name, d.partner_nui,
             greatest(v_as_of - b.due_date, 0) as days
      from public.acc_documents d join public.acc_doc_balances b on b.id = d.id
      where d.client_id = c.id and d.kind = v_kind and d.doc_date <= v_as_of and abs(b.open) >= 0.005
    )
    select jsonb_build_object(
      'as_of', v_as_of,
      'total', coalesce(sum(open), 0),
      'buckets', jsonb_build_object(
        'current', coalesce(sum(open) filter (where days = 0), 0),
        'd30', coalesce(sum(open) filter (where days between 1 and 30), 0),
        'd60', coalesce(sum(open) filter (where days between 31 and 60), 0),
        'd90', coalesce(sum(open) filter (where days between 61 and 90), 0),
        'older', coalesce(sum(open) filter (where days > 90), 0)),
      'partners', coalesce((
        select jsonb_agg(jsonb_build_object('partner_id', partner_id, 'name', partner_name, 'nui', partner_nui, 'open', s_open,
                                            'overdue', s_overdue, 'max_days', s_days, 'docs', s_docs) order by s_open desc)
        from (select partner_id, partner_name, max(partner_nui) as partner_nui, sum(open) as s_open,
                     sum(open) filter (where days > 0) as s_overdue, max(days) as s_days,
                     jsonb_agg(jsonb_build_object('id', id, 'doc_no', doc_no, 'doc_date', doc_date, 'due_date', due_date, 'total', total, 'open', open, 'days', days) order by due_date) as s_docs
              from docs group by partner_id, partner_name) g), '[]'::jsonb)
    ) from docs
  );
end $$;

-- Statement of a partner (kartela): documents and payments in order with the running balance.
create or replace function public.acc_partner_statement(p_partner uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pt public.acc_partners;
  v_open numeric;
begin
  select * into pt from public.acc_partners where id = p_partner and accountant_id = public._require_accountant();
  if not found then
    raise exception 'Partneri nuk u gjet' using errcode = 'P0002';
  end if;
  -- Balance before the period: + for what the partner owes (sales) or what we owe (purchases).
  select coalesce(sum(d.total), 0) - coalesce((select sum(x.amount * sign(d2.total))
                                               from public.acc_payments x join public.acc_documents d2 on d2.id = x.doc_id
                                               where d2.partner_id = pt.id and d2.kind <> 'proforma' and x.pay_date < p_from), 0)
    into v_open
  from public.acc_documents d where d.partner_id = pt.id and d.kind <> 'proforma' and d.doc_date < p_from;
  return jsonb_build_object(
    'partner', to_jsonb(pt) - 'accountant_id',
    'from', p_from, 'to', p_to, 'opening', v_open,
    'rows', (
      select coalesce(jsonb_agg(r order by r->>'date', r->>'sort'), '[]'::jsonb) from (
        select jsonb_build_object('date', d.doc_date, 'sort', '1' || d.created_at, 'type', d.doc_type, 'kind', d.kind, 'doc_id', d.id,
                                  'doc_no', d.doc_no, 'debit', case when d.total > 0 then d.total else 0 end,
                                  'credit', case when d.total < 0 then -d.total else 0 end, 'text', d.description) as r
        from public.acc_documents d where d.partner_id = pt.id and d.kind <> 'proforma' and d.doc_date between p_from and p_to
        union all
        select jsonb_build_object('date', x.pay_date, 'sort', '2' || x.created_at, 'type', 'payment', 'kind', d.kind, 'doc_id', d.id,
                                  'doc_no', d.doc_no, 'debit', case when d.total < 0 then x.amount else 0 end,
                                  'credit', case when d.total >= 0 then x.amount else 0 end,
                                  'text', case x.method when 'cash' then 'Pagesë me kesh' else 'Pagesë me bankë' end || coalesce(' · ' || x.reference, ''))
        from public.acc_payments x join public.acc_documents d on d.id = x.doc_id
        where d.partner_id = pt.id and d.kind <> 'proforma' and x.pay_date between p_from and p_to
      ) t(r)
    )
  );
end $$;

-- ---------------------------------------------------------------------
-- Files (metadata; the file itself goes to storage bucket acc-files/<client_id>/…)
-- ---------------------------------------------------------------------
create or replace function public.acc_add_file(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_doc uuid := nullif(p->>'doc_id', '')::uuid;
  v_path text := p->>'path';
  v_id uuid;
begin
  if v_path is null or split_part(v_path, '/', 1) <> c.id::text then
    raise exception 'Skedari nuk është në dosjen e klientit' using errcode = '22023';
  end if;
  if v_doc is not null and not exists (select 1 from public.acc_documents where id = v_doc and client_id = c.id) then
    raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
  end if;
  insert into public.acc_files (client_id, doc_id, path, file_name, mime, size_bytes, uploaded_by)
  values (c.id, v_doc, v_path, left(coalesce(nullif(p->>'file_name', ''), 'skedar'), 200), left(p->>'mime', 100), (p->>'size_bytes')::bigint, auth.uid())
  returning id into v_id;
  if v_doc is not null then
    insert into public.acc_doc_history (doc_id, user_id, action, details) values (v_doc, auth.uid(), 'file', jsonb_build_object('name', p->>'file_name'));
  end if;
  return v_id;
end $$;

-- Returns the storage path, which the program then removes from the bucket.
create or replace function public.acc_delete_file(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.acc_files;
begin
  select fl.* into f from public.acc_files fl join public.acc_clients c on c.id = fl.client_id
   where fl.id = p_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Skedari nuk u gjet' using errcode = 'P0002';
  end if;
  delete from public.acc_files where id = p_id;
  return f.path;
end $$;

-- ---------------------------------------------------------------------
-- Books: non-deductible VAT is a cost (net) – everything else as in 0013
-- ---------------------------------------------------------------------
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
    'purchases', (select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_e + net_d + amt_c + amt_a + vat_nd), 0),
                                            'vat', coalesce(sum(vat_e + vat_d), 0), 'docs', count(*),
                                            'due', coalesce(sum(total) filter (where payment = 'due'), 0),
                                            'cash', coalesce(sum(total) filter (where payment = 'cash'), 0),
                                            'bank', coalesce(sum(total) filter (where payment = 'bank'), 0))
                  from public.acc_documents where client_id = c.id and kind = 'purchase' and category in ('goods', 'assets') and doc_date between p_from and p_to),
    'vat_in', public._acc_vat_rows(c.id, 'purchase', p_from, p_to, 'stock'),
    'cogs', (select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_e + net_d + amt_c + amt_a + vat_nd), 0))
             from public.acc_documents where client_id = c.id and kind = 'purchase' and category = 'goods' and doc_date between p_from and p_to),
    'expenses', (select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_e + net_d + amt_c + amt_a + vat_nd), 0),
                                           'vat', coalesce(sum(vat_e + vat_d), 0), 'docs', count(*),
                                           'due', coalesce(sum(total) filter (where payment = 'due'), 0))
                 from public.acc_documents where client_id = c.id and kind = 'purchase' and category not in ('goods', 'assets') and doc_date between p_from and p_to),
    'expense_categories', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'gross', gross, 'net', net, 'vat', vat) order by gross desc), '[]'::jsonb)
                           from (select category, sum(total) as gross, sum(net_e + net_d + amt_c + amt_a + vat_nd) as net, sum(vat_e + vat_d) as vat
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
                    group by doc_date) t),
    'receivable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = c.id and b.kind = 'sale'),
    'payable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = c.id and b.kind = 'purchase')
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

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public._acc_next_number(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.acc_save_partner(jsonb), public.acc_delete_partner(uuid), public.acc_partners_list(uuid),
  public.acc_save_invoice(jsonb), public.acc_convert_proforma(uuid, date), public.acc_save_payment(jsonb), public.acc_delete_payment(uuid),
  public.acc_documents_list(uuid, text, date, date), public.acc_document_detail(uuid), public.acc_debts(uuid, text, date),
  public.acc_partner_statement(uuid, date, date), public.acc_add_file(jsonb), public.acc_delete_file(uuid) from public, anon;
grant execute on function public.acc_save_partner(jsonb), public.acc_delete_partner(uuid), public.acc_partners_list(uuid),
  public.acc_save_invoice(jsonb), public.acc_convert_proforma(uuid, date), public.acc_save_payment(jsonb), public.acc_delete_payment(uuid),
  public.acc_documents_list(uuid, text, date, date), public.acc_document_detail(uuid), public.acc_debts(uuid, text, date),
  public.acc_partner_statement(uuid, date, date), public.acc_add_file(jsonb), public.acc_delete_file(uuid) to authenticated;
