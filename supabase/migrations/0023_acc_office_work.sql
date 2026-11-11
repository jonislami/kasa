-- =====================================================================
-- 0023 – Kasa Kontabilist, phase K7 (part 2): the office's own work with its clients.
--
-- * Office profile (NUI, address, IBAN…) for the office's invoices to its clients.
-- * acc_contracts: service contract per client – monthly fee (with VAT), services, billing day, payment terms.
-- * acc_office_invoices / acc_office_payments: the office bills its clients (monthly from the contracts,
--   or by hand), numbered per office and year (2026-0001), with payments and the open balance.
--   Only office admins see and change billing.
-- * acc_tasks: tasks of the team (per client or for the office), assigned, due date, priority,
--   monthly repetition (done → the next one is created).
-- * acc_doc_requests: documents asked from a client (e.g. "Ekstrakti bankar – tetor"), status, reminders;
--   can be asked from many clients at once.
-- * acc_client_notes: communication with the client (call, e-mail, meeting, message, note).
-- Visibility: the office (_office_id) and the clients the member may see (_acc_client_visible, 0022).
-- Nothing existing changes shape.
-- =====================================================================

alter table public.accountants add column if not exists office_nui text;
alter table public.accountants add column if not exists office_vat_no text;
alter table public.accountants add column if not exists office_address text;
alter table public.accountants add column if not exists office_city text;
alter table public.accountants add column if not exists office_email text;
alter table public.accountants add column if not exists office_phone text;
alter table public.accountants add column if not exists office_bank text;
alter table public.accountants add column if not exists office_iban text;

create table if not exists public.acc_contracts (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references public.accountants (user_id) on delete cascade,
  client_id    uuid not null unique references public.acc_clients (id) on delete cascade,
  start_date   date not null,
  end_date     date,
  monthly_fee  numeric(14, 2) not null default 0 check (monthly_fee >= 0),   -- with VAT
  vat_rate     numeric(5, 2) not null default 0 check (vat_rate in (0, 8, 18)),
  services     text,
  billing_day  int not null default 1 check (billing_day between 1 and 28),
  payment_days int not null default 15 check (payment_days between 0 and 120),
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.acc_office_invoices (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid not null references public.accountants (user_id) on delete cascade,
  client_id   uuid references public.acc_clients (id) on delete set null,
  client_name text not null,
  client_nui  text,
  inv_no      text not null,
  issue_date  date not null,
  due_date    date,
  period      date check (period is null or extract(day from period) = 1),   -- month billed from the contract
  description text not null,
  vat_rate    numeric(5, 2) not null default 0,
  net         numeric(14, 2) not null,
  vat         numeric(14, 2) not null,
  total       numeric(14, 2) not null,
  paid        numeric(14, 2) not null default 0,
  status      text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (office_id, inv_no)
);
create unique index if not exists acc_office_invoices_period_idx on public.acc_office_invoices (client_id, period)
  where period is not null and status <> 'cancelled';
create index if not exists acc_office_invoices_office_idx on public.acc_office_invoices (office_id, issue_date desc);

create table if not exists public.acc_office_payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.acc_office_invoices (id) on delete cascade,
  pay_date   date not null,
  amount     numeric(14, 2) not null check (amount > 0),
  method     text not null default 'bank' check (method in ('cash', 'bank')),
  note       text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists acc_office_payments_inv_idx on public.acc_office_payments (invoice_id);

create table if not exists public.acc_tasks (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid not null references public.accountants (user_id) on delete cascade,
  client_id   uuid references public.acc_clients (id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  description text,
  due_date    date,
  assigned_to uuid references public.accountants (user_id) on delete set null,
  status      text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  repeat      text not null default 'none' check (repeat in ('none', 'monthly')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  done_at     timestamptz,
  done_by     uuid references auth.users (id) on delete set null
);
create index if not exists acc_tasks_office_idx on public.acc_tasks (office_id, status, due_date);

create table if not exists public.acc_doc_requests (
  id               uuid primary key default gen_random_uuid(),
  office_id        uuid not null references public.accountants (user_id) on delete cascade,
  client_id        uuid not null references public.acc_clients (id) on delete cascade,
  title            text not null check (length(trim(title)) > 0),
  period           date check (period is null or extract(day from period) = 1),
  due_date         date,
  status           text not null default 'requested' check (status in ('requested', 'received', 'cancelled')),
  note             text,
  requested_by     uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  received_at      timestamptz,
  reminders        int not null default 0,
  last_reminded_at timestamptz
);
create index if not exists acc_doc_requests_office_idx on public.acc_doc_requests (office_id, status, due_date);

create table if not exists public.acc_client_notes (
  id         uuid primary key default gen_random_uuid(),
  office_id  uuid not null references public.accountants (user_id) on delete cascade,
  client_id  uuid not null references public.acc_clients (id) on delete cascade,
  kind       text not null default 'note' check (kind in ('call', 'email', 'meeting', 'message', 'note')),
  body       text not null check (length(trim(body)) > 0),
  note_date  timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists acc_client_notes_client_idx on public.acc_client_notes (client_id, note_date desc);

-- ---------------------------------------------------------------------
-- RLS (reads); writes only through the RPCs below
-- ---------------------------------------------------------------------
alter table public.acc_contracts       enable row level security;
alter table public.acc_office_invoices enable row level security;
alter table public.acc_office_payments enable row level security;
alter table public.acc_tasks           enable row level security;
alter table public.acc_doc_requests    enable row level security;
alter table public.acc_client_notes    enable row level security;

drop policy if exists acc_contracts_own on public.acc_contracts;
create policy acc_contracts_own on public.acc_contracts for select to authenticated
  using (office_id = public._office_id() and public._acc_role() = 'admin' and public.is_accountant());
drop policy if exists acc_office_invoices_own on public.acc_office_invoices;
create policy acc_office_invoices_own on public.acc_office_invoices for select to authenticated
  using (office_id = public._office_id() and public._acc_role() = 'admin' and public.is_accountant());
drop policy if exists acc_office_payments_own on public.acc_office_payments;
create policy acc_office_payments_own on public.acc_office_payments for select to authenticated
  using (exists (select 1 from public.acc_office_invoices i where i.id = invoice_id and i.office_id = public._office_id())
         and public._acc_role() = 'admin' and public.is_accountant());
drop policy if exists acc_tasks_own on public.acc_tasks;
create policy acc_tasks_own on public.acc_tasks for select to authenticated
  using (public.is_accountant() and office_id = public._office_id() and (client_id is null or public._acc_client_visible(client_id)));
drop policy if exists acc_doc_requests_own on public.acc_doc_requests;
create policy acc_doc_requests_own on public.acc_doc_requests for select to authenticated
  using (public._acc_client_visible(client_id));
drop policy if exists acc_client_notes_own on public.acc_client_notes;
create policy acc_client_notes_own on public.acc_client_notes for select to authenticated
  using (public._acc_client_visible(client_id));

revoke all on public.acc_contracts, public.acc_office_invoices, public.acc_office_payments, public.acc_tasks,
  public.acc_doc_requests, public.acc_client_notes from anon, authenticated;
grant select on public.acc_contracts, public.acc_office_invoices, public.acc_office_payments, public.acc_tasks,
  public.acc_doc_requests, public.acc_client_notes to authenticated;

-- History (0022): labels also from title / body / services.
do $$
declare
  def text := pg_get_functiondef('public._acc_log()'::regprocedure);
begin
  if position('r->>''title''' in def) = 0 then
    if position('r->>''description'',' in def) = 0 then raise exception '_acc_log: label not found'; end if;
    execute replace(def, 'r->>''description'',', 'r->>''title'', r->>''description'', left(r->>''body'', 80), r->>''services'',');
  end if;
end $$;

-- History (0022) for tasks, requests, notes of a client.
do $$
declare
  t text;
begin
  foreach t in array array['acc_tasks', 'acc_doc_requests', 'acc_client_notes', 'acc_contracts']
  loop
    execute format('drop trigger if exists acc_log on public.%I', t);
    execute format('create trigger acc_log after insert or update or delete on public.%I for each row execute function public._acc_log()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Office profile (for its invoices)
-- ---------------------------------------------------------------------
create or replace function public.acc_office_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  o public.accountants;
begin
  select * into o from public.accountants where user_id = v_office;
  return jsonb_build_object('office_name', o.office_name, 'nui', o.office_nui, 'vat_no', o.office_vat_no, 'address', o.office_address,
                            'city', o.office_city, 'email', o.office_email, 'phone', o.office_phone, 'bank', o.office_bank, 'iban', o.office_iban);
end $$;

create or replace function public.acc_office_profile_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
  f text;
begin
  update public.accountants
     set office_name    = case when p ? 'office_name' then nullif(trim(p->>'office_name'), '') else office_name end,
         office_nui     = case when p ? 'nui' then nullif(regexp_replace(p->>'nui', '\D', '', 'g'), '') else office_nui end,
         office_vat_no  = case when p ? 'vat_no' then nullif(trim(p->>'vat_no'), '') else office_vat_no end,
         office_address = case when p ? 'address' then nullif(trim(p->>'address'), '') else office_address end,
         office_city    = case when p ? 'city' then nullif(trim(p->>'city'), '') else office_city end,
         office_email   = case when p ? 'email' then nullif(trim(p->>'email'), '') else office_email end,
         office_phone   = case when p ? 'phone' then nullif(trim(p->>'phone'), '') else office_phone end,
         office_bank    = case when p ? 'bank' then nullif(trim(p->>'bank'), '') else office_bank end,
         office_iban    = case when p ? 'iban' then nullif(upper(regexp_replace(p->>'iban', '\s', '', 'g')), '') else office_iban end
   where user_id = v_office;
end $$;

-- ---------------------------------------------------------------------
-- Contracts
-- ---------------------------------------------------------------------
create or replace function public.acc_contract_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid;
begin
  insert into public.acc_contracts (office_id, client_id, start_date, end_date, monthly_fee, vat_rate, services, billing_day, payment_days, active, note)
  values (v_office, c.id, coalesce(nullif(p->>'start_date', '')::date, public._local_date()), nullif(p->>'end_date', '')::date,
          coalesce((p->>'monthly_fee')::numeric, 0), coalesce((p->>'vat_rate')::numeric, 0), nullif(trim(p->>'services'), ''),
          coalesce((p->>'billing_day')::int, 1), coalesce((p->>'payment_days')::int, 15), coalesce((p->>'active')::boolean, true),
          nullif(trim(p->>'note'), ''))
  on conflict (client_id) do update
    set start_date = excluded.start_date, end_date = excluded.end_date, monthly_fee = excluded.monthly_fee, vat_rate = excluded.vat_rate,
        services = excluded.services, billing_day = excluded.billing_day, payment_days = excluded.payment_days,
        active = excluded.active, note = excluded.note, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.acc_contract_delete(p_client uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
begin
  delete from public.acc_contracts where client_id = p_client and office_id = v_office;
end $$;

-- Contracts with what each client owes the office.
create or replace function public.acc_contracts_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id', c.id, 'client_name', c.name, 'client_nui', c.nui, 'client_active', c.active,
      'contract', case when k.id is not null then to_jsonb(k) - 'office_id' end,
      'open', coalesce((select sum(i.total - i.paid) from public.acc_office_invoices i where i.client_id = c.id and i.status = 'open'), 0),
      'overdue', coalesce((select sum(i.total - i.paid) from public.acc_office_invoices i
                           where i.client_id = c.id and i.status = 'open' and i.due_date < public._local_date()), 0),
      'last_invoice', (select max(i.issue_date) from public.acc_office_invoices i where i.client_id = c.id and i.status <> 'cancelled')
    ) order by c.active desc, c.name)
    from public.acc_clients c
    left join public.acc_contracts k on k.client_id = c.id
    where c.accountant_id = v_office
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Office invoices
-- ---------------------------------------------------------------------
create or replace function public._acc_office_inv_no(p_office uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(p_date, 'YYYY');
  v_n int;
begin
  perform 1 from public.accountants where user_id = p_office for update;   -- one number at a time per office
  select coalesce(max(nullif(split_part(inv_no, '-', 2), '')::int), 0) + 1 into v_n
  from public.acc_office_invoices
  where office_id = p_office and inv_no like v_year || '-%' and split_part(inv_no, '-', 2) ~ '^\d+$';
  return v_year || '-' || lpad(v_n::text, 4, '0');
end $$;

-- p = {client_id, issue_date?, due_date?, description, total, vat_rate?, period?, note?}
create or replace function public.acc_office_invoice_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_date date := coalesce(nullif(p->>'issue_date', '')::date, public._local_date());
  v_total numeric := round(coalesce((p->>'total')::numeric, 0), 2);
  v_rate numeric := coalesce((p->>'vat_rate')::numeric, 0);
  v_net numeric;
  v_no text;
  v_id uuid;
begin
  if v_total <= 0 then raise exception 'Shuma duhet të jetë më e madhe se 0' using errcode = '22023'; end if;
  if v_rate not in (0, 8, 18) then raise exception 'Norma e TVSH-së nuk vlen' using errcode = '22023'; end if;
  if coalesce(trim(p->>'description'), '') = '' then raise exception 'Shkruaj përshkrimin' using errcode = '22023'; end if;
  v_net := round(v_total / (1 + v_rate / 100), 2);
  v_no := public._acc_office_inv_no(v_office, v_date);
  insert into public.acc_office_invoices (office_id, client_id, client_name, client_nui, inv_no, issue_date, due_date, period,
                                          description, vat_rate, net, vat, total, note, created_by)
  values (v_office, c.id, c.name, c.nui, v_no, v_date, nullif(p->>'due_date', '')::date, nullif(p->>'period', '')::date,
          left(trim(p->>'description'), 300), v_rate, v_net, v_total - v_net, v_total, nullif(trim(p->>'note'), ''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'inv_no', v_no);
end $$;

-- Monthly invoices from the active contracts (once per client and month).
create or replace function public.acc_office_bill_month(p_month date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
  v_month date := date_trunc('month', p_month)::date;
  k record;
  v_date date;
  v_n int := 0;
begin
  for k in
    select ct.*, c.name as client_name
    from public.acc_contracts ct
    join public.acc_clients c on c.id = ct.client_id
    where ct.office_id = v_office and ct.active and c.active and ct.monthly_fee > 0
      and ct.start_date < (v_month + interval '1 month')::date
      and (ct.end_date is null or ct.end_date >= v_month)
      and not exists (select 1 from public.acc_office_invoices i where i.client_id = ct.client_id and i.period = v_month and i.status <> 'cancelled')
    order by c.name
  loop
    v_date := v_month + (k.billing_day - 1);
    perform public.acc_office_invoice_save(jsonb_build_object(
      'client_id', k.client_id, 'issue_date', v_date, 'due_date', v_date + k.payment_days, 'period', v_month,
      'description', coalesce(k.services, 'Shërbime të kontabilitetit') || ' – ' || to_char(v_month, 'MM/YYYY'),
      'total', k.monthly_fee, 'vat_rate', k.vat_rate));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.acc_office_invoice_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
begin
  if exists (select 1 from public.acc_office_payments where invoice_id = p_id) then
    raise exception 'Fatura ka pagesa – fshiji pagesat fillimisht' using errcode = '22023';
  end if;
  update public.acc_office_invoices set status = 'cancelled' where id = p_id and office_id = v_office and status = 'open';
  if not found then raise exception 'Fatura nuk u gjet ose nuk është e hapur' using errcode = 'P0002'; end if;
end $$;

create or replace function public._acc_office_inv_refresh(p_invoice uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.acc_office_invoices i
     set paid = coalesce((select sum(amount) from public.acc_office_payments where invoice_id = i.id), 0),
         status = case when i.status = 'cancelled' then 'cancelled'
                       when coalesce((select sum(amount) from public.acc_office_payments where invoice_id = i.id), 0) >= i.total then 'paid'
                       else 'open' end
   where i.id = p_invoice
$$;

-- p = {invoice_id, pay_date?, amount?, method?, note?}  (amount defaults to what is still open)
create or replace function public.acc_office_payment_add(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
  i public.acc_office_invoices;
  v_amount numeric;
begin
  select * into i from public.acc_office_invoices where id = (p->>'invoice_id')::uuid and office_id = v_office for update;
  if not found or i.status = 'cancelled' then raise exception 'Fatura nuk u gjet' using errcode = 'P0002'; end if;
  v_amount := round(coalesce(nullif(p->>'amount', '')::numeric, i.total - i.paid), 2);
  if v_amount <= 0 then raise exception 'Shuma duhet të jetë më e madhe se 0' using errcode = '22023'; end if;
  insert into public.acc_office_payments (invoice_id, pay_date, amount, method, note, created_by)
  values (i.id, coalesce(nullif(p->>'pay_date', '')::date, public._local_date()), v_amount, coalesce(p->>'method', 'bank'),
          nullif(trim(p->>'note'), ''), auth.uid());
  perform public._acc_office_inv_refresh(i.id);
end $$;

create or replace function public.acc_office_payment_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
  v_inv uuid;
begin
  delete from public.acc_office_payments x using public.acc_office_invoices i
  where x.id = p_id and i.id = x.invoice_id and i.office_id = v_office
  returning x.invoice_id into v_inv;
  if v_inv is null then raise exception 'Pagesa nuk u gjet' using errcode = 'P0002'; end if;
  perform public._acc_office_inv_refresh(v_inv);
end $$;

create or replace function public.acc_office_invoices_list(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(i) - 'office_id' || jsonb_build_object(
      'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'pay_date', x.pay_date, 'amount', x.amount, 'method', x.method, 'note', x.note)
                                             order by x.pay_date), '[]'::jsonb)
                   from public.acc_office_payments x where x.invoice_id = i.id)
    ) order by i.issue_date desc, i.inv_no desc)
    from public.acc_office_invoices i
    where i.office_id = v_office and i.issue_date between p_from and p_to
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------
-- p = {id?, client_id?, title, description?, due_date?, assigned_to?, priority?, repeat?}
create or replace function public.acc_task_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_assignee uuid := nullif(p->>'assigned_to', '')::uuid;
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if v_client is not null then perform public._own_client(v_client); end if;
  if v_assignee is not null and not exists (select 1 from public.accountants a where a.user_id = v_assignee and coalesce(a.office_id, a.user_id) = v_office and a.active) then
    raise exception 'Anëtari nuk është në zyrë' using errcode = '22023';
  end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Shkruaj detyrën' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.acc_tasks (office_id, client_id, title, description, due_date, assigned_to, priority, repeat, created_by)
    values (v_office, v_client, left(trim(p->>'title'), 200), nullif(trim(p->>'description'), ''), nullif(p->>'due_date', '')::date,
            v_assignee, coalesce(p->>'priority', 'normal'), coalesce(p->>'repeat', 'none'), auth.uid())
    returning id into v_id;
  else
    update public.acc_tasks
       set client_id = v_client, title = left(trim(p->>'title'), 200), description = nullif(trim(p->>'description'), ''),
           due_date = nullif(p->>'due_date', '')::date, assigned_to = v_assignee,
           priority = coalesce(p->>'priority', priority), repeat = coalesce(p->>'repeat', repeat)
     where id = v_id and office_id = v_office and (client_id is null or public._acc_client_visible(client_id));
    if not found then raise exception 'Detyra nuk u gjet' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Done on a monthly task creates the next one (same day next month).
create or replace function public.acc_task_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  t public.acc_tasks;
begin
  if p_status not in ('todo', 'doing', 'done') then raise exception 'Statusi nuk vlen' using errcode = '22023'; end if;
  select * into t from public.acc_tasks
  where id = p_id and office_id = v_office and (client_id is null or public._acc_client_visible(client_id)) for update;
  if not found then raise exception 'Detyra nuk u gjet' using errcode = 'P0002'; end if;
  update public.acc_tasks
     set status = p_status,
         done_at = case when p_status = 'done' then now() end,
         done_by = case when p_status = 'done' then auth.uid() end
   where id = t.id;
  if p_status = 'done' and t.status <> 'done' and t.repeat = 'monthly' then
    insert into public.acc_tasks (office_id, client_id, title, description, due_date, assigned_to, priority, repeat, created_by)
    values (t.office_id, t.client_id, t.title, t.description,
            (coalesce(t.due_date, public._local_date()) + interval '1 month')::date, t.assigned_to, t.priority, 'monthly', auth.uid());
  end if;
end $$;

create or replace function public.acc_task_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
begin
  delete from public.acc_tasks where id = p_id and office_id = v_office and (client_id is null or public._acc_client_visible(client_id));
  if not found then raise exception 'Detyra nuk u gjet' using errcode = 'P0002'; end if;
end $$;

-- p_scope: 'mine' (assigned to me or created by me and unassigned) | 'all';  p_client: only that client
create or replace function public.acc_tasks_list(p_scope text default 'all', p_client uuid default null, p_done boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(t) - 'office_id' || jsonb_build_object('client_name', c.name, 'assigned_name', a.full_name)
                     order by (t.status = 'done'), t.due_date nulls last, case t.priority when 'high' then 0 when 'normal' then 1 else 2 end, t.created_at)
    from public.acc_tasks t
    left join public.acc_clients c on c.id = t.client_id
    left join public.accountants a on a.user_id = t.assigned_to
    where t.office_id = v_office
      and (t.client_id is null or public._acc_client_visible(t.client_id))
      and (p_client is null or t.client_id = p_client)
      and (p_scope <> 'mine' or t.assigned_to = auth.uid() or (t.assigned_to is null and t.created_by = auth.uid()))
      and (p_done or t.status <> 'done' or t.done_at > now() - interval '14 days')
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Document requests
-- ---------------------------------------------------------------------
-- p = {id?, client_id, title, period?, due_date?, note?}
create or replace function public.acc_request_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Shkruaj çka kërkohet' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.acc_doc_requests (office_id, client_id, title, period, due_date, note, requested_by)
    values (v_office, c.id, left(trim(p->>'title'), 200), nullif(p->>'period', '')::date, nullif(p->>'due_date', '')::date,
            nullif(trim(p->>'note'), ''), auth.uid())
    returning id into v_id;
  else
    update public.acc_doc_requests
       set title = left(trim(p->>'title'), 200), period = nullif(p->>'period', '')::date, due_date = nullif(p->>'due_date', '')::date,
           note = nullif(trim(p->>'note'), '')
     where id = v_id and client_id = c.id;
    if not found then raise exception 'Kërkesa nuk u gjet' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- The same request to many clients: p = {title, period?, due_date?, note?, client_ids?: uuid[]} (none = all active visible clients)
create or replace function public.acc_requests_bulk(p jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  v_n int;
begin
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Shkruaj çka kërkohet' using errcode = '22023'; end if;
  insert into public.acc_doc_requests (office_id, client_id, title, period, due_date, note, requested_by)
  select v_office, c.id, left(trim(p->>'title'), 200), nullif(p->>'period', '')::date, nullif(p->>'due_date', '')::date,
         nullif(trim(p->>'note'), ''), auth.uid()
  from public.acc_clients c
  where c.accountant_id = v_office and c.active and public._acc_client_visible(c.id)
    and (not (p ? 'client_ids') or jsonb_array_length(p->'client_ids') = 0
         or c.id in (select (jsonb_array_elements_text(p->'client_ids'))::uuid))
    and not exists (select 1 from public.acc_doc_requests r
                    where r.client_id = c.id and r.status = 'requested' and lower(r.title) = lower(trim(p->>'title'))
                      and r.period is not distinct from nullif(p->>'period', '')::date);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- p_status: requested | received | cancelled | reminded (counts a reminder)
create or replace function public.acc_request_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.acc_doc_requests;
begin
  perform public._require_accountant();
  select * into r from public.acc_doc_requests where id = p_id and public._acc_client_visible(client_id) for update;
  if not found then raise exception 'Kërkesa nuk u gjet' using errcode = 'P0002'; end if;
  if p_status = 'reminded' then
    update public.acc_doc_requests set reminders = reminders + 1, last_reminded_at = now() where id = r.id;
  elsif p_status in ('requested', 'received', 'cancelled') then
    update public.acc_doc_requests set status = p_status, received_at = case when p_status = 'received' then now() end where id = r.id;
  else
    raise exception 'Statusi nuk vlen' using errcode = '22023';
  end if;
end $$;

create or replace function public.acc_request_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_accountant();
  delete from public.acc_doc_requests where id = p_id and public._acc_client_visible(client_id);
  if not found then raise exception 'Kërkesa nuk u gjet' using errcode = 'P0002'; end if;
end $$;

create or replace function public.acc_requests_list(p_status text default 'requested', p_client uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(r) - 'office_id' || jsonb_build_object('client_name', c.name, 'client_email', c.email, 'client_phone', c.phone,
                                                                      'requested_by_name', a.full_name)
                     order by r.due_date nulls last, c.name, r.created_at)
    from public.acc_doc_requests r
    join public.acc_clients c on c.id = r.client_id
    left join public.accountants a on a.user_id = r.requested_by
    where r.office_id = v_office and public._acc_client_visible(r.client_id)
      and (p_status is null or r.status = p_status)
      and (p_client is null or r.client_id = p_client)
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Communication notes
-- ---------------------------------------------------------------------
create or replace function public.acc_note_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid;
begin
  if coalesce(trim(p->>'body'), '') = '' then raise exception 'Shkruaj shënimin' using errcode = '22023'; end if;
  insert into public.acc_client_notes (office_id, client_id, kind, body, note_date, created_by)
  values (v_office, c.id, coalesce(p->>'kind', 'note'), left(trim(p->>'body'), 4000), coalesce(nullif(p->>'note_date', '')::timestamptz, now()), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.acc_note_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_accountant();
  delete from public.acc_client_notes
  where id = p_id and public._acc_client_visible(client_id) and (created_by = auth.uid() or public._acc_role() = 'admin');
  if not found then raise exception 'Shënimi nuk u gjet (fshin vetëm autori ose administratori)' using errcode = 'P0002'; end if;
end $$;

create or replace function public.acc_notes_list(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'note_date', n.note_date,
                                        'created_by', n.created_by, 'author', a.full_name) order by n.note_date desc)
    from public.acc_client_notes n
    left join public.accountants a on a.user_id = n.created_by
    where n.client_id = c.id
  ), '[]'::jsonb);
end $$;

-- Contract of one client (admins) – for the client page.
create or replace function public.acc_client_contract(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if public._acc_role() <> 'admin' then return null; end if;
  return jsonb_build_object(
    'contract', (select to_jsonb(k) - 'office_id' from public.acc_contracts k where k.client_id = c.id),
    'open', coalesce((select sum(i.total - i.paid) from public.acc_office_invoices i where i.client_id = c.id and i.status = 'open'), 0),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'inv_no', i.inv_no, 'issue_date', i.issue_date, 'due_date', i.due_date,
                                                              'total', i.total, 'paid', i.paid, 'status', i.status, 'description', i.description)
                                           order by i.issue_date desc), '[]'::jsonb)
                 from (select * from public.acc_office_invoices where client_id = c.id order by issue_date desc limit 12) i));
end $$;

-- Counters for the header of the program.
create or replace function public.acc_work_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  v_today date := public._local_date();
begin
  return jsonb_build_object(
    'my_tasks', (select count(*) from public.acc_tasks t where t.office_id = v_office and t.status <> 'done'
                   and (t.assigned_to = auth.uid() or (t.assigned_to is null and t.created_by = auth.uid()))
                   and (t.client_id is null or public._acc_client_visible(t.client_id))),
    'overdue_tasks', (select count(*) from public.acc_tasks t where t.office_id = v_office and t.status <> 'done' and t.due_date < v_today
                        and (t.client_id is null or public._acc_client_visible(t.client_id))),
    'open_requests', (select count(*) from public.acc_doc_requests r where r.office_id = v_office and r.status = 'requested'
                        and public._acc_client_visible(r.client_id)),
    'overdue_requests', (select count(*) from public.acc_doc_requests r where r.office_id = v_office and r.status = 'requested'
                           and r.due_date < v_today and public._acc_client_visible(r.client_id)),
    'unpaid', case when public._acc_role() = 'admin' then
                (select coalesce(sum(i.total - i.paid), 0) from public.acc_office_invoices i where i.office_id = v_office and i.status = 'open') end
  );
end $$;

revoke execute on function public._acc_office_inv_no(uuid, date), public._acc_office_inv_refresh(uuid) from public, anon, authenticated;
revoke execute on function public.acc_office_profile(), public.acc_office_profile_save(jsonb), public.acc_contract_save(jsonb),
  public.acc_contract_delete(uuid), public.acc_contracts_list(), public.acc_office_invoice_save(jsonb), public.acc_office_bill_month(date),
  public.acc_office_invoice_cancel(uuid), public.acc_office_payment_add(jsonb), public.acc_office_payment_delete(uuid),
  public.acc_office_invoices_list(date, date), public.acc_task_save(jsonb), public.acc_task_status(uuid, text), public.acc_task_delete(uuid),
  public.acc_tasks_list(text, uuid, boolean), public.acc_request_save(jsonb), public.acc_requests_bulk(jsonb), public.acc_request_status(uuid, text),
  public.acc_request_delete(uuid), public.acc_requests_list(text, uuid), public.acc_note_save(jsonb), public.acc_note_delete(uuid),
  public.acc_notes_list(uuid), public.acc_client_contract(uuid), public.acc_work_summary() from public, anon;
grant execute on function public.acc_office_profile(), public.acc_office_profile_save(jsonb), public.acc_contract_save(jsonb),
  public.acc_contract_delete(uuid), public.acc_contracts_list(), public.acc_office_invoice_save(jsonb), public.acc_office_bill_month(date),
  public.acc_office_invoice_cancel(uuid), public.acc_office_payment_add(jsonb), public.acc_office_payment_delete(uuid),
  public.acc_office_invoices_list(date, date), public.acc_task_save(jsonb), public.acc_task_status(uuid, text), public.acc_task_delete(uuid),
  public.acc_tasks_list(text, uuid, boolean), public.acc_request_save(jsonb), public.acc_requests_bulk(jsonb), public.acc_request_status(uuid, text),
  public.acc_request_delete(uuid), public.acc_requests_list(text, uuid), public.acc_note_save(jsonb), public.acc_note_delete(uuid),
  public.acc_notes_list(uuid), public.acc_client_contract(uuid), public.acc_work_summary() to authenticated;
