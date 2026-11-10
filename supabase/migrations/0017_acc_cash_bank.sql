-- =====================================================================
-- 0017 – Kasa Kontabilist, phase K2: cash and bank, statement import, reconciliation,
--        loans, cash flow, the company dashboard.
--
-- * acc_money_accounts: the cash boxes and bank accounts of a client (opening balance).
-- * acc_payments.account_id: an invoice payment goes in / out of one account.
-- * acc_transactions: money movements without an invoice – owner deposits/withdrawals, loans,
--   tax / contribution payments, transfers between accounts (two rows, one group), other.
-- * acc_loans: loans and their instalments (annuity), paid through transactions (loan_id).
-- * acc_bank_lines: lines of an imported bank statement; each is matched to an open invoice
--   (→ a payment), booked as a movement or an expense (→ transaction / purchase document),
--   or ignored. Re-importing the same file adds nothing twice.
-- * acc_accounts_list, acc_account_ledger, acc_cash_flow, acc_client_dashboard.
-- Older clients keep working: nothing the live app uses changes shape.
-- =====================================================================

create table if not exists public.acc_money_accounts (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.acc_clients (id) on delete cascade,
  accountant_id   uuid not null references public.accountants (user_id) on delete cascade,
  kind            text not null check (kind in ('cash', 'bank')),
  name            text not null check (length(trim(name)) > 0),
  bank_name       text,
  iban            text,
  opening_balance numeric(14, 2) not null default 0,
  opening_date    date not null default date '2000-01-01',
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists acc_money_accounts_client_idx on public.acc_money_accounts (client_id);

alter table public.acc_payments add column if not exists account_id uuid references public.acc_money_accounts (id) on delete set null;
create index if not exists acc_payments_account_idx on public.acc_payments (account_id, pay_date);

create table if not exists public.acc_loans (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.acc_clients (id) on delete cascade,
  lender        text not null,
  principal     numeric(14, 2) not null check (principal > 0),
  rate_pct      numeric(6, 3) not null default 0 check (rate_pct >= 0),
  start_date    date not null,
  months        int not null check (months between 1 and 600),
  account_id    uuid references public.acc_money_accounts (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists acc_loans_client_idx on public.acc_loans (client_id);

create table if not exists public.acc_transactions (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.acc_clients (id) on delete cascade,
  account_id     uuid not null references public.acc_money_accounts (id) on delete cascade,
  tx_date        date not null,
  amount         numeric(14, 2) not null check (amount <> 0),   -- + in, − out
  category       text not null check (category in (
                   'income', 'owner', 'loan', 'interest', 'wages', 'taxes', 'vat', 'contributions',
                   'bank_fee', 'transfer', 'other')),
  description    text,
  reference      text,
  partner_id     uuid references public.acc_partners (id) on delete set null,
  loan_id        uuid references public.acc_loans (id) on delete set null,
  transfer_group uuid,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists acc_transactions_account_idx on public.acc_transactions (account_id, tx_date);
create index if not exists acc_transactions_client_idx on public.acc_transactions (client_id, tx_date);

create table if not exists public.acc_bank_lines (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.acc_clients (id) on delete cascade,
  account_id   uuid not null references public.acc_money_accounts (id) on delete cascade,
  line_date    date not null,
  amount       numeric(14, 2) not null check (amount <> 0),
  description  text,
  counterparty text,
  reference    text,
  hash         text not null,
  status       text not null default 'new' check (status in ('new', 'matched', 'ignored')),
  payment_id   uuid references public.acc_payments (id) on delete set null,
  tx_id        uuid references public.acc_transactions (id) on delete set null,
  doc_id       uuid references public.acc_documents (id) on delete set null,
  imported_at  timestamptz not null default now(),
  unique (account_id, hash)
);
create index if not exists acc_bank_lines_account_idx on public.acc_bank_lines (account_id, status, line_date);

alter table public.acc_money_accounts enable row level security;
alter table public.acc_loans          enable row level security;
alter table public.acc_transactions   enable row level security;
alter table public.acc_bank_lines     enable row level security;

drop policy if exists acc_money_accounts_own on public.acc_money_accounts;
create policy acc_money_accounts_own on public.acc_money_accounts for select to authenticated
  using (accountant_id = auth.uid() and public.is_accountant());
drop policy if exists acc_loans_own on public.acc_loans;
create policy acc_loans_own on public.acc_loans for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_transactions_own on public.acc_transactions;
create policy acc_transactions_own on public.acc_transactions for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_bank_lines_own on public.acc_bank_lines;
create policy acc_bank_lines_own on public.acc_bank_lines for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());

revoke all on public.acc_money_accounts, public.acc_loans, public.acc_transactions, public.acc_bank_lines from anon, authenticated;
grant select on public.acc_money_accounts, public.acc_loans, public.acc_transactions, public.acc_bank_lines to authenticated;

-- Signed effect of an invoice payment on the account: customer pays in (+), we pay a supplier (−);
-- a refund on a credit note goes the other way.
create or replace function public._acc_pay_sign(p_kind text, p_type text)
returns int
language sql
immutable
set search_path = ''
as $$
  select (case when p_kind = 'sale' then 1 else -1 end) * (case when p_type = 'credit_note' then -1 else 1 end)
$$;

create or replace function public._own_account(p_account uuid)
returns public.acc_money_accounts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.acc_money_accounts;
begin
  select * into a from public.acc_money_accounts where id = p_account and accountant_id = public._require_accountant();
  if not found then
    raise exception 'Llogaria nuk u gjet' using errcode = 'P0002';
  end if;
  return a;
end $$;

-- Balance of an account up to and including a date.
create or replace function public._acc_balance(p_account uuid, p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select a.opening_balance
       + coalesce((select sum(public._acc_pay_sign(d.kind, d.doc_type) * x.amount)
                   from public.acc_payments x join public.acc_documents d on d.id = x.doc_id
                   where x.account_id = a.id and x.pay_date <= p_date), 0)
       + coalesce((select sum(t.amount) from public.acc_transactions t where t.account_id = a.id and t.tx_date <= p_date), 0)
  from public.acc_money_accounts a where a.id = p_account
$$;

-- ---------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------
create or replace function public.acc_save_account(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_kind text := coalesce(nullif(p->>'kind', ''), 'bank');
  v_name text := trim(coalesce(p->>'name', ''));
begin
  if v_kind not in ('cash', 'bank') then
    raise exception 'Lloji i llogarisë nuk njihet' using errcode = '22023';
  end if;
  if v_name = '' then
    v_name := case v_kind when 'cash' then 'Arka' else coalesce(nullif(trim(p->>'bank_name'), ''), 'Banka') end;
  end if;
  if v_id is null then
    insert into public.acc_money_accounts (client_id, accountant_id, kind, name, bank_name, iban, opening_balance, opening_date)
    values (c.id, c.accountant_id, v_kind, left(v_name, 100), nullif(trim(left(coalesce(p->>'bank_name', ''), 100)), ''),
            nullif(upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g')), ''),
            round(coalesce((p->>'opening_balance')::numeric, 0), 2), coalesce(nullif(p->>'opening_date', '')::date, date '2000-01-01'))
    returning id into v_id;
  else
    update public.acc_money_accounts set
      kind = v_kind, name = left(v_name, 100),
      bank_name = nullif(trim(left(coalesce(p->>'bank_name', ''), 100)), ''),
      iban = nullif(upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g')), ''),
      opening_balance = round(coalesce((p->>'opening_balance')::numeric, 0), 2),
      opening_date = coalesce(nullif(p->>'opening_date', '')::date, opening_date),
      active = coalesce((p->>'active')::boolean, active)
    where id = v_id and client_id = c.id;
    if not found then
      raise exception 'Llogaria nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.acc_delete_account(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.acc_money_accounts := public._own_account(p_id);
begin
  if exists (select 1 from public.acc_payments where account_id = a.id)
     or exists (select 1 from public.acc_transactions where account_id = a.id)
     or exists (select 1 from public.acc_bank_lines where account_id = a.id) then
    update public.acc_money_accounts set active = false where id = a.id;
    return 'archived';
  end if;
  delete from public.acc_money_accounts where id = a.id;
  return 'deleted';
end $$;

create or replace function public.acc_accounts_list(p_client uuid, p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_date date := coalesce(p_as_of, public._local_date());
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(a) - 'accountant_id' || jsonb_build_object(
             'balance', public._acc_balance(a.id, v_date),
             'to_match', (select count(*) from public.acc_bank_lines l where l.account_id = a.id and l.status = 'new'))
           order by a.active desc, a.kind, a.name), '[]'::jsonb)
    from public.acc_money_accounts a where a.client_id = c.id
  );
end $$;

-- Ledger of an account: opening, every payment and movement of the period, closing.
create or replace function public.acc_account_ledger(p_account uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.acc_money_accounts := public._own_account(p_account);
begin
  return jsonb_build_object(
    'account', to_jsonb(a) - 'accountant_id',
    'opening', public._acc_balance(a.id, p_from - 1),
    'closing', public._acc_balance(a.id, p_to),
    'rows', (
      select coalesce(jsonb_agg(r order by r->>'date', r->>'at'), '[]'::jsonb) from (
        select jsonb_build_object('date', x.pay_date, 'at', x.created_at, 'source', 'payment', 'id', x.id, 'doc_id', d.id,
                                  'amount', public._acc_pay_sign(d.kind, d.doc_type) * x.amount,
                                  'text', concat_ws(' · ', case d.kind when 'sale' then 'Arkëtim' else 'Pagesë' end || ' ' || coalesce(d.doc_no, ''), d.partner_name),
                                  'reference', x.reference, 'category', case d.kind when 'sale' then 'customer' else 'supplier' end) as r
        from public.acc_payments x join public.acc_documents d on d.id = x.doc_id
        where x.account_id = a.id and x.pay_date between p_from and p_to
        union all
        select jsonb_build_object('date', t.tx_date, 'at', t.created_at, 'source', 'tx', 'id', t.id, 'doc_id', null,
                                  'amount', t.amount, 'text', coalesce(t.description, ''), 'reference', t.reference,
                                  'category', t.category, 'transfer_group', t.transfer_group, 'loan_id', t.loan_id,
                                  'partner', (select p.name from public.acc_partners p where p.id = t.partner_id))
        from public.acc_transactions t where t.account_id = a.id and t.tx_date between p_from and p_to
      ) q(r)
    )
  );
end $$;

-- ---------------------------------------------------------------------
-- Movements without an invoice; transfers; loans
-- ---------------------------------------------------------------------
create or replace function public.acc_save_transaction(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.acc_money_accounts := public._own_account((p->>'account_id')::uuid);
  b public.acc_money_accounts;
  v_amount numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  v_date date := coalesce(nullif(p->>'tx_date', '')::date, public._local_date());
  v_cat text := coalesce(nullif(p->>'category', ''), 'other');
  v_group uuid;
  v_id uuid;
  v_partner uuid := nullif(p->>'partner_id', '')::uuid;
  v_loan uuid := nullif(p->>'loan_id', '')::uuid;
begin
  if v_amount = 0 then
    raise exception 'Shkruaj shumën' using errcode = '22023';
  end if;
  if v_cat not in ('income', 'owner', 'loan', 'interest', 'wages', 'taxes', 'vat', 'contributions', 'bank_fee', 'transfer', 'other') then
    raise exception 'Kategoria nuk njihet' using errcode = '22023';
  end if;
  if v_partner is not null and not exists (select 1 from public.acc_partners where id = v_partner and client_id = a.client_id) then
    raise exception 'Partneri nuk u gjet' using errcode = 'P0002';
  end if;
  if v_loan is not null and not exists (select 1 from public.acc_loans where id = v_loan and client_id = a.client_id) then
    raise exception 'Kredia nuk u gjet' using errcode = 'P0002';
  end if;
  -- Transfer: out of A, into B (two rows, one group); amount given positive.
  if v_cat = 'transfer' then
    b := public._own_account((p->>'to_account_id')::uuid);
    if b.client_id <> a.client_id or b.id = a.id then
      raise exception 'Zgjidh një llogari tjetër të së njëjtës kompani' using errcode = '22023';
    end if;
    v_group := gen_random_uuid();
    insert into public.acc_transactions (client_id, account_id, tx_date, amount, category, description, reference, transfer_group, created_by)
    values (a.client_id, a.id, v_date, -abs(v_amount), 'transfer', coalesce(nullif(trim(p->>'description'), ''), 'Transfer në ' || b.name), nullif(trim(p->>'reference'), ''), v_group, auth.uid())
    returning id into v_id;
    insert into public.acc_transactions (client_id, account_id, tx_date, amount, category, description, reference, transfer_group, created_by)
    values (a.client_id, b.id, v_date, abs(v_amount), 'transfer', coalesce(nullif(trim(p->>'description'), ''), 'Transfer nga ' || a.name), nullif(trim(p->>'reference'), ''), v_group, auth.uid());
    return v_id;
  end if;
  insert into public.acc_transactions (client_id, account_id, tx_date, amount, category, description, reference, partner_id, loan_id, created_by)
  values (a.client_id, a.id, v_date, v_amount, v_cat, nullif(trim(left(coalesce(p->>'description', ''), 300)), ''),
          nullif(trim(left(coalesce(p->>'reference', ''), 100)), ''), v_partner, v_loan, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.acc_delete_transaction(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.acc_transactions;
begin
  select tx.* into t from public.acc_transactions tx join public.acc_clients c on c.id = tx.client_id
   where tx.id = p_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Lëvizja nuk u gjet' using errcode = 'P0002';
  end if;
  update public.acc_bank_lines set status = 'new', tx_id = null where tx_id = t.id or tx_id in (select id from public.acc_transactions where transfer_group = t.transfer_group);
  if t.transfer_group is not null then
    delete from public.acc_transactions where transfer_group = t.transfer_group;
  else
    delete from public.acc_transactions where id = t.id;
  end if;
end $$;

create or replace function public.acc_save_loan(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_account uuid := nullif(p->>'account_id', '')::uuid;
begin
  if trim(coalesce(p->>'lender', '')) = '' then
    raise exception 'Shkruaj bankën ose huadhënësin' using errcode = '22023';
  end if;
  if v_account is not null and not exists (select 1 from public.acc_money_accounts where id = v_account and client_id = c.id) then
    raise exception 'Llogaria nuk u gjet' using errcode = 'P0002';
  end if;
  if v_id is null then
    insert into public.acc_loans (client_id, lender, principal, rate_pct, start_date, months, account_id, note)
    values (c.id, left(trim(p->>'lender'), 120), round((p->>'principal')::numeric, 2), round(coalesce((p->>'rate_pct')::numeric, 0), 3),
            (p->>'start_date')::date, (p->>'months')::int, v_account, nullif(trim(left(coalesce(p->>'note', ''), 300)), ''))
    returning id into v_id;
    -- The money received goes into the account.
    if v_account is not null and coalesce((p->>'book_receipt')::boolean, true) then
      insert into public.acc_transactions (client_id, account_id, tx_date, amount, category, description, loan_id, created_by)
      values (c.id, v_account, (p->>'start_date')::date, round((p->>'principal')::numeric, 2), 'loan', 'Kredi e marrë – ' || left(trim(p->>'lender'), 120), v_id, auth.uid());
    end if;
  else
    update public.acc_loans set lender = left(trim(p->>'lender'), 120), principal = round((p->>'principal')::numeric, 2),
           rate_pct = round(coalesce((p->>'rate_pct')::numeric, 0), 3), start_date = (p->>'start_date')::date, months = (p->>'months')::int,
           account_id = v_account, note = nullif(trim(left(coalesce(p->>'note', ''), 300)), '')
     where id = v_id and client_id = c.id;
    if not found then
      raise exception 'Kredia nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.acc_loans_list(p_client uuid)
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
    select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
             'repaid', coalesce((select -sum(t.amount) from public.acc_transactions t where t.loan_id = l.id and t.amount < 0 and t.category = 'loan'), 0),
             'interest_paid', coalesce((select -sum(t.amount) from public.acc_transactions t where t.loan_id = l.id and t.amount < 0 and t.category = 'interest'), 0))
           order by l.start_date desc), '[]'::jsonb)
    from public.acc_loans l where l.client_id = c.id
  );
end $$;

create or replace function public.acc_delete_loan(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.acc_loans l using public.acc_clients c
   where l.id = p_id and c.id = l.client_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Kredia nuk u gjet' using errcode = 'P0002';
  end if;
end $$;

-- Invoice payments may name the account (cash box / bank account); the method follows the account.
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
  v_account uuid := nullif(p->>'account_id', '')::uuid;
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
  if v_account is not null then
    select kind into v_method from public.acc_money_accounts where id = v_account and client_id = d.client_id;
    if not found then
      raise exception 'Llogaria nuk u gjet' using errcode = 'P0002';
    end if;
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
  if d.payment <> 'due' then
    update public.acc_documents set payment = 'due' where id = d.id;
  end if;
  select * into b from public.acc_doc_balances where id = d.id;
  v_open := abs(b.open) + v_old;
  if v_amount > v_open + 0.01 then
    raise exception 'Pagesa (%) është më e madhe se shuma e mbetur (%)', v_amount, v_open using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.acc_payments (client_id, doc_id, pay_date, amount, method, account_id, reference, note, created_by)
    values (d.client_id, d.id, v_date, v_amount, v_method, v_account, nullif(trim(left(coalesce(p->>'reference', ''), 100)), ''),
            nullif(trim(left(coalesce(p->>'note', ''), 300)), ''), auth.uid())
    returning id into v_id;
  else
    update public.acc_payments set pay_date = v_date, amount = v_amount, method = v_method, account_id = v_account,
           reference = nullif(trim(left(coalesce(p->>'reference', ''), 100)), ''), note = nullif(trim(left(coalesce(p->>'note', ''), 300)), '')
     where id = v_id;
  end if;
  insert into public.acc_doc_history (doc_id, user_id, action, details)
  values (d.id, auth.uid(), 'payment', jsonb_build_object('amount', v_amount, 'method', v_method, 'date', v_date));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Bank statement: import, suggestions, matching
-- ---------------------------------------------------------------------
create or replace function public.acc_import_bank_lines(p_account uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.acc_money_accounts := public._own_account(p_account);
  v_added int;
  v_total int := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
begin
  if v_total = 0 or v_total > 5000 then
    raise exception 'Ekstrakti duhet të ketë 1–5000 rreshta' using errcode = '22023';
  end if;
  with src as (
    select (r->>'date')::date as d, round((r->>'amount')::numeric, 2) as amt,
           nullif(trim(left(coalesce(r->>'description', ''), 400)), '') as descr,
           nullif(trim(left(coalesce(r->>'counterparty', ''), 200)), '') as cp,
           nullif(trim(left(coalesce(r->>'reference', ''), 100)), '') as ref
    from jsonb_array_elements(p_rows) r
  ), keyed as (
    select *, md5(concat_ws('|', d, amt, coalesce(descr, ''), coalesce(cp, ''), coalesce(ref, ''))) as base from src
    where d is not null and amt is not null and amt <> 0
  ), numbered as (
    select *, base || ':' || row_number() over (partition by base order by d) as h from keyed
  ), ins as (
    insert into public.acc_bank_lines (client_id, account_id, line_date, amount, description, counterparty, reference, hash)
    select a.client_id, a.id, d, amt, descr, cp, ref, h from numbered
    on conflict (account_id, hash) do nothing
    returning 1
  )
  select count(*) into v_added from ins;
  return jsonb_build_object('added', v_added, 'skipped', v_total - v_added);
end $$;

-- Lines of an account with up to 3 suggested open invoices each (amount and number / partner in the text).
create or replace function public.acc_bank_lines_list(p_account uuid, p_status text default 'new')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.acc_money_accounts := public._own_account(p_account);
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(l) - 'hash' || jsonb_build_object(
             'doc_no', (select d.doc_no from public.acc_documents d where d.id = l.doc_id),
             'suggestions', case when l.status <> 'new' then '[]'::jsonb else coalesce((
               select jsonb_agg(jsonb_build_object('doc_id', x.id, 'doc_no', x.doc_no, 'partner', x.partner_name, 'doc_date', x.doc_date,
                                                   'open', x.open, 'score', x.score) order by x.score desc, x.doc_date)
               from (
                 select d.id, d.doc_no, d.partner_name, d.doc_date, bl.open,
                        (case when abs(abs(bl.open) - abs(l.amount)) < 0.01 then 2 else 0 end)
                        + (case when d.doc_no is not null and length(d.doc_no) >= 3
                                     and concat_ws(' ', l.description, l.reference) ilike '%' || d.doc_no || '%' then 3 else 0 end)
                        + (case when d.partner_name is not null and length(d.partner_name) >= 4
                                     and concat_ws(' ', l.counterparty, l.description) ilike '%' || split_part(d.partner_name, ' ', 1) || '%' then 1 else 0 end) as score
                 from public.acc_documents d join public.acc_doc_balances bl on bl.id = d.id
                 where d.client_id = l.client_id and abs(bl.open) >= 0.01
                   and d.kind = case when l.amount > 0 then 'sale' else 'purchase' end
                   and d.doc_type <> 'credit_note'
                 order by 6 desc, d.doc_date
                 limit 3
               ) x where x.score >= 2), '[]'::jsonb) end)
           order by l.line_date, l.imported_at), '[]'::jsonb)
    from public.acc_bank_lines l
    where l.account_id = a.id and (p_status = 'all' or l.status = p_status)
  );
end $$;

-- Match a line to an invoice: a payment from this account for the line's amount.
create or replace function public.acc_match_bank_line(p_line uuid, p_doc uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.acc_bank_lines;
  d public.acc_documents;
  v_pay uuid;
begin
  select bl.* into l from public.acc_bank_lines bl join public.acc_clients c on c.id = bl.client_id
   where bl.id = p_line and c.accountant_id = public._require_accountant() and bl.status = 'new';
  if not found then
    raise exception 'Rreshti nuk u gjet ose është rakorduar tashmë' using errcode = 'P0002';
  end if;
  select * into d from public.acc_documents where id = p_doc and client_id = l.client_id;
  if not found then
    raise exception 'Fatura nuk u gjet' using errcode = 'P0002';
  end if;
  if (l.amount > 0) <> (public._acc_pay_sign(d.kind, d.doc_type) > 0) then
    raise exception 'Hyrja në bankë lidhet me faturë shitjeje, dalja me faturë blerjeje' using errcode = '22023';
  end if;
  v_pay := public.acc_save_payment(jsonb_build_object('doc_id', d.id, 'amount', abs(l.amount), 'pay_date', l.line_date,
                                                      'account_id', l.account_id, 'reference', coalesce(l.reference, left(l.description, 100))));
  update public.acc_bank_lines set status = 'matched', payment_id = v_pay, doc_id = d.id where id = l.id;
end $$;

-- Book a line without an invoice: a movement (owner, loan, taxes…) or – for costs such as bank fees –
-- a purchase document (exempt, paid from this account) so that it reaches the expenses.
create or replace function public.acc_book_bank_line(p_line uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.acc_bank_lines;
  v_cat text := coalesce(nullif(p->>'category', ''), 'other');
  v_expense text := nullif(p->>'expense_category', '');
  v_tx uuid;
  r jsonb;
begin
  select bl.* into l from public.acc_bank_lines bl join public.acc_clients c on c.id = bl.client_id
   where bl.id = p_line and c.accountant_id = public._require_accountant() and bl.status = 'new';
  if not found then
    raise exception 'Rreshti nuk u gjet ose është rakorduar tashmë' using errcode = 'P0002';
  end if;
  if v_expense is not null then
    if l.amount > 0 then
      raise exception 'Shpenzimi është dalje parash' using errcode = '22023';
    end if;
    r := public.acc_save_invoice(jsonb_build_object(
      'client_id', l.client_id, 'kind', 'purchase', 'category', v_expense, 'doc_date', l.line_date,
      'doc_no', coalesce(l.reference, 'BANKA-' || to_char(l.line_date, 'YYYYMMDD') || '-' || left(l.id::text, 4)),
      'partner_name', coalesce(l.counterparty, nullif(p->>'partner_name', '')),
      'description', coalesce(nullif(p->>'description', ''), l.description), 'amt_a', abs(l.amount), 'force', true));
    perform public.acc_match_bank_line(l.id, (r->>'id')::uuid);
    return;
  end if;
  v_tx := public.acc_save_transaction(jsonb_build_object(
    'account_id', l.account_id, 'tx_date', l.line_date, 'amount', l.amount, 'category', v_cat,
    'description', coalesce(nullif(p->>'description', ''), l.description, l.counterparty), 'reference', l.reference,
    'partner_id', nullif(p->>'partner_id', ''), 'loan_id', nullif(p->>'loan_id', '')));
  update public.acc_bank_lines set status = 'matched', tx_id = v_tx where id = l.id;
end $$;

create or replace function public.acc_set_bank_line(p_line uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.acc_bank_lines;
begin
  select bl.* into l from public.acc_bank_lines bl join public.acc_clients c on c.id = bl.client_id
   where bl.id = p_line and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Rreshti nuk u gjet' using errcode = 'P0002';
  end if;
  if p_status = 'ignored' then
    if l.status <> 'new' then
      raise exception 'Vetëm rreshtat e parakorduar injorohen' using errcode = '22023';
    end if;
    update public.acc_bank_lines set status = 'ignored' where id = l.id;
  elsif p_status = 'new' then
    -- Undo: remove what the matching created.
    if l.payment_id is not null then
      delete from public.acc_payments where id = l.payment_id;
    end if;
    if l.tx_id is not null then
      delete from public.acc_transactions where id = l.tx_id;
    end if;
    update public.acc_bank_lines set status = 'new', payment_id = null, tx_id = null, doc_id = null where id = l.id;
  elsif p_status = 'delete' then
    if l.status = 'matched' then
      raise exception 'Zhbëje rakordimin para se ta fshish rreshtin' using errcode = '22023';
    end if;
    delete from public.acc_bank_lines where id = l.id;
  else
    raise exception 'Statusi nuk njihet' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Cash flow and dashboard
-- ---------------------------------------------------------------------
create or replace function public.acc_cash_flow(p_client uuid, p_from date, p_to date)
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
    with mv as (
      select date_trunc('month', x.pay_date)::date as m,
             case when d.kind = 'sale' then 'customers' else 'suppliers' end as grp,
             public._acc_pay_sign(d.kind, d.doc_type) * x.amount as amt
      from public.acc_payments x join public.acc_documents d on d.id = x.doc_id
      where x.client_id = c.id and x.account_id is not null and x.pay_date between p_from and p_to
      union all
      select date_trunc('month', t.tx_date)::date, t.category, t.amount
      from public.acc_transactions t where t.client_id = c.id and t.tx_date between p_from and p_to and t.category <> 'transfer'
    )
    select jsonb_build_object(
      'opening', (select coalesce(sum(public._acc_balance(a.id, p_from - 1)), 0) from public.acc_money_accounts a where a.client_id = c.id),
      'closing', (select coalesce(sum(public._acc_balance(a.id, p_to)), 0) from public.acc_money_accounts a where a.client_id = c.id),
      'months', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'in', s_in, 'out', s_out, 'groups', g) order by m)
                          from (select m, sum(amt) filter (where amt > 0) as s_in, -sum(amt) filter (where amt < 0) as s_out,
                                       jsonb_object_agg(grp, s) as g
                                from (select m, grp, sum(amt) as s, sum(amt) as amt from mv group by m, grp) q group by m) t), '[]'::jsonb),
      'groups', coalesce((select jsonb_object_agg(grp, s) from (select grp, sum(amt) as s from mv group by grp) g), '{}'::jsonb)
    )
  );
end $$;

-- One company at a glance: 12 months of sales / purchases / expenses, debts, money, VAT, activity.
create or replace function public.acc_client_dashboard(p_client uuid, p_year int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_today date := public._local_date();
  v_year int := coalesce(p_year, extract(year from v_today)::int);
  v_from date := make_date(v_year, 1, 1);
  v_to date := make_date(v_year, 12, 31);
  v_prev date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_kasa boolean := c.kasa_business_id is not null and c.link_status = 'approved'
                    and exists (select 1 from public.business_members m join public.businesses b on b.id = m.business_id
                                where m.user_id = c.accountant_id and m.business_id = c.kasa_business_id and m.status = 'active' and b.active);
begin
  return jsonb_build_object(
    'year', v_year,
    'months', (
      select jsonb_agg(jsonb_build_object(
               'month', m,
               'sales', coalesce((select sum(net_e + net_d + amt_c + amt_a) from public.acc_documents d
                                  where d.client_id = c.id and d.kind = 'sale' and date_trunc('month', d.doc_date) = m), 0)
                        + case when v_kasa then coalesce((select sum(s.total - s.vat_total) from public.sales s
                                                          where s.business_id = c.kasa_business_id and date_trunc('month', s.sale_date) = m), 0) else 0 end,
               'purchases', coalesce((select sum(net_e + net_d + amt_c + amt_a + vat_nd) from public.acc_documents d
                                      where d.client_id = c.id and d.kind = 'purchase' and d.category in ('goods', 'assets') and date_trunc('month', d.doc_date) = m), 0),
               'expenses', coalesce((select sum(net_e + net_d + amt_c + amt_a + vat_nd) from public.acc_documents d
                                     where d.client_id = c.id and d.kind = 'purchase' and d.category not in ('goods', 'assets') and date_trunc('month', d.doc_date) = m), 0),
               'cash_in', coalesce((select sum(public._acc_pay_sign(d.kind, d.doc_type) * x.amount) from public.acc_payments x join public.acc_documents d on d.id = x.doc_id
                                    where x.client_id = c.id and date_trunc('month', x.pay_date) = m and public._acc_pay_sign(d.kind, d.doc_type) * x.amount > 0), 0),
               'cash_out', coalesce((select -sum(public._acc_pay_sign(d.kind, d.doc_type) * x.amount) from public.acc_payments x join public.acc_documents d on d.id = x.doc_id
                                     where x.client_id = c.id and date_trunc('month', x.pay_date) = m and public._acc_pay_sign(d.kind, d.doc_type) * x.amount < 0), 0)
             ) order by m)
      from generate_series(v_from, v_to, interval '1 month') as g(m)
    ),
    'receivable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = c.id and b.kind = 'sale'),
    'payable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = c.id and b.kind = 'purchase'),
    'overdue_receivable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = c.id and b.kind = 'sale' and b.open > 0 and b.due_date < v_today),
    'overdue_payable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = c.id and b.kind = 'purchase' and b.open > 0 and b.due_date < v_today),
    'overdue_docs', (select count(*) from public.acc_doc_balances b where b.client_id = c.id and b.kind in ('sale', 'purchase') and b.open > 0 and b.due_date < v_today),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'balance', public._acc_balance(a.id, v_today),
                                                              'to_match', (select count(*) from public.acc_bank_lines l where l.account_id = a.id and l.status = 'new')) order by a.kind, a.name), '[]'::jsonb)
                 from public.acc_money_accounts a where a.client_id = c.id and a.active),
    'vat_prev', jsonb_build_object(
      'month', v_prev,
      'out', coalesce((select sum(vat_e + vat_d) from public.acc_documents where client_id = c.id and kind = 'sale' and date_trunc('month', doc_date) = v_prev), 0)
             + case when v_kasa then coalesce((select sum(s.vat_total) from public.sales s where s.business_id = c.kasa_business_id and date_trunc('month', s.sale_date) = v_prev), 0) else 0 end,
      'in', coalesce((select sum(vat_e + vat_d) from public.acc_documents where client_id = c.id and kind = 'purchase' and date_trunc('month', doc_date) = v_prev), 0),
      'status', coalesce((select p.vat_status from public.acc_periods p where p.client_id = c.id and p.month = v_prev), 'open'),
      'due', (v_prev + interval '1 month')::date + 19),
    'recent', (
      select coalesce(jsonb_agg(r order by r->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('at', h.created_at, 'action', h.action, 'doc_id', d.id, 'doc_no', d.doc_no, 'kind', d.kind,
                                  'partner', d.partner_name, 'details', h.details) as r
        from public.acc_doc_history h join public.acc_documents d on d.id = h.doc_id
        where d.client_id = c.id
        order by h.id desc limit 12
      ) q(r)
    )
  );
end $$;

revoke execute on function public._acc_pay_sign(text, text), public._own_account(uuid), public._acc_balance(uuid, date) from public, anon, authenticated;
revoke execute on function public.acc_save_account(jsonb), public.acc_delete_account(uuid), public.acc_accounts_list(uuid, date),
  public.acc_account_ledger(uuid, date, date), public.acc_save_transaction(jsonb), public.acc_delete_transaction(uuid),
  public.acc_save_loan(jsonb), public.acc_loans_list(uuid), public.acc_delete_loan(uuid), public.acc_import_bank_lines(uuid, jsonb),
  public.acc_bank_lines_list(uuid, text), public.acc_match_bank_line(uuid, uuid), public.acc_book_bank_line(uuid, jsonb),
  public.acc_set_bank_line(uuid, text), public.acc_cash_flow(uuid, date, date), public.acc_client_dashboard(uuid, int) from public, anon;
grant execute on function public.acc_save_account(jsonb), public.acc_delete_account(uuid), public.acc_accounts_list(uuid, date),
  public.acc_account_ledger(uuid, date, date), public.acc_save_transaction(jsonb), public.acc_delete_transaction(uuid),
  public.acc_save_loan(jsonb), public.acc_loans_list(uuid), public.acc_delete_loan(uuid), public.acc_import_bank_lines(uuid, jsonb),
  public.acc_bank_lines_list(uuid, text), public.acc_match_bank_line(uuid, uuid), public.acc_book_bank_line(uuid, jsonb),
  public.acc_set_bank_line(uuid, text), public.acc_cash_flow(uuid, date, date), public.acc_client_dashboard(uuid, int) to authenticated;
