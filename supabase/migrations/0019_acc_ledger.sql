-- =====================================================================
-- 0019 – Kasa Kontabilist, phase K5: chart of accounts, journal, automatic postings,
--        general ledger, trial balance, financial statements, fixed assets, month close.
--
-- * acc_coa: the chart of accounts of each client, seeded with a basic chart by class
--   (1 current assets, 2 fixed assets, 3 liabilities, 4 equity, 5 income, 6 expenses).
-- * Automatic postings are not stored: _acc_entries(client, from, to) derives the double entry
--   of every invoice, payment, money movement, opening balance of a money account, the monthly VAT
--   settlement and the depreciation of fixed assets – so the books always match the documents.
-- * acc_journal_entries / acc_journal_lines: manual entries (corrections, opening balances,
--   accruals…), balanced debit = credit.
-- * acc_assets: fixed asset register, straight-line depreciation by month.
-- * acc_periods.books_locked: a closed month – no document, payment, movement or entry dated in it
--   can be added, changed or deleted (trigger).
-- * Reports: acc_general_ledger, acc_trial_balance, acc_financial_statements.
-- Older clients keep working: nothing the live app uses changes shape.
-- =====================================================================

create table if not exists public.acc_coa (
  client_id uuid not null references public.acc_clients (id) on delete cascade,
  code      text not null check (code ~ '^[0-9]{3,8}$'),
  name      text not null check (length(trim(name)) > 0),
  type      text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  system    boolean not null default false,
  active    boolean not null default true,
  primary key (client_id, code)
);

create table if not exists public.acc_journal_entries (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.acc_clients (id) on delete cascade,
  entry_no    int not null,
  entry_date  date not null,
  kind        text not null default 'manual' check (kind in ('manual', 'opening', 'adjustment', 'closing')),
  description text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (client_id, entry_no)
);
create table if not exists public.acc_journal_lines (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.acc_journal_entries (id) on delete cascade,
  position    int not null,
  account     text not null,
  debit       numeric(14, 2) not null default 0 check (debit >= 0),
  credit      numeric(14, 2) not null default 0 check (credit >= 0),
  partner_id  uuid references public.acc_partners (id) on delete set null,
  memo        text,
  check (debit = 0 or credit = 0)
);
create index if not exists acc_journal_lines_entry_idx on public.acc_journal_lines (entry_id);

create table if not exists public.acc_assets (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.acc_clients (id) on delete cascade,
  name           text not null,
  category       text not null default 'equipment' check (category in ('buildings', 'vehicles', 'equipment', 'computers', 'furniture', 'machinery', 'other')),
  acquired_on    date not null,
  cost           numeric(14, 2) not null check (cost > 0),
  salvage        numeric(14, 2) not null default 0 check (salvage >= 0),
  rate_pct       numeric(6, 2) not null check (rate_pct > 0 and rate_pct <= 100),   -- yearly, straight line
  doc_id         uuid references public.acc_documents (id) on delete set null,
  disposed_on    date,
  disposal_value numeric(14, 2),
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists acc_assets_client_idx on public.acc_assets (client_id);

alter table public.acc_periods add column if not exists books_locked boolean not null default false;

alter table public.acc_coa             enable row level security;
alter table public.acc_journal_entries enable row level security;
alter table public.acc_journal_lines   enable row level security;
alter table public.acc_assets          enable row level security;
drop policy if exists acc_coa_own on public.acc_coa;
create policy acc_coa_own on public.acc_coa for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_journal_entries_own on public.acc_journal_entries;
create policy acc_journal_entries_own on public.acc_journal_entries for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_journal_lines_own on public.acc_journal_lines;
create policy acc_journal_lines_own on public.acc_journal_lines for select to authenticated
  using (exists (select 1 from public.acc_journal_entries e join public.acc_clients c on c.id = e.client_id where e.id = entry_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_assets_own on public.acc_assets;
create policy acc_assets_own on public.acc_assets for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
revoke all on public.acc_coa, public.acc_journal_entries, public.acc_journal_lines, public.acc_assets from anon, authenticated;
grant select on public.acc_coa, public.acc_journal_entries, public.acc_journal_lines, public.acc_assets to authenticated;

-- ---------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------
create or replace function public._acc_seed_coa(p_client uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.acc_coa (client_id, code, name, type, system)
  select p_client, x.code, x.name, x.type, true from (values
    ('1010', 'Arka (paraja e gatshme)', 'asset'),
    ('1020', 'Llogaritë bankare', 'asset'),
    ('1090', 'Transferet në kalim', 'asset'),
    ('1200', 'Llogaritë e arkëtueshme – klientët', 'asset'),
    ('1300', 'Stoqet e mallit', 'asset'),
    ('1400', 'Parapagimet', 'asset'),
    ('1600', 'TVSH e zbritshme', 'asset'),
    ('2200', 'Pajisjet dhe mjetet themelore', 'asset'),
    ('2290', 'Amortizimi i akumuluar', 'asset'),
    ('3100', 'Llogaritë e pagueshme – furnitorët', 'liability'),
    ('3200', 'Kreditë dhe huatë', 'liability'),
    ('3400', 'Pagat për pagesë', 'liability'),
    ('3500', 'Kontributet për pagesë', 'liability'),
    ('3600', 'TVSH e llogaritur', 'liability'),
    ('3700', 'Tatimet për pagesë', 'liability'),
    ('3790', 'TVSH për pagesë / kredi e TVSH-së', 'liability'),
    ('4000', 'Kapitali i pronarit', 'equity'),
    ('4100', 'Fitimi i mbajtur', 'equity'),
    ('4900', 'Saldot fillestare (hapja)', 'equity'),
    ('5000', 'Të hyrat nga shitja e mallrave', 'income'),
    ('5100', 'Të hyrat nga shërbimet', 'income'),
    ('5900', 'Të hyra të tjera', 'income'),
    ('5910', 'Të hyra nga interesi', 'income'),
    ('6000', 'Kostoja e mallrave të blera', 'expense'),
    ('6100', 'Qiraja', 'expense'),
    ('6110', 'Rryma, uji, mbeturinat', 'expense'),
    ('6120', 'Telefoni dhe interneti', 'expense'),
    ('6130', 'Karburanti', 'expense'),
    ('6140', 'Automjetet', 'expense'),
    ('6150', 'Transporti', 'expense'),
    ('6200', 'Pagat', 'expense'),
    ('6210', 'Kontributet pensionale', 'expense'),
    ('6300', 'Shërbimet profesionale', 'expense'),
    ('6310', 'Mirëmbajtja dhe riparimet', 'expense'),
    ('6320', 'Reklama dhe marketingu', 'expense'),
    ('6330', 'Shpenzimet administrative', 'expense'),
    ('6340', 'Shpenzimet operative', 'expense'),
    ('6350', 'Udhëtimet zyrtare', 'expense'),
    ('6360', 'Përfaqësimi', 'expense'),
    ('6400', 'Tatime dhe taksa', 'expense'),
    ('6500', 'Provizionet bankare', 'expense'),
    ('6600', 'Amortizimi', 'expense'),
    ('6700', 'Shpenzimet e interesit', 'expense'),
    ('6900', 'Shpenzime të tjera', 'expense')
  ) as x(code, name, type)
  on conflict (client_id, code) do nothing
$$;

-- Account of a purchase category / sale category / money movement
create or replace function public._acc_cat_account(p_kind text, p_category text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'sale' then case p_category when 'services' then '5100' else '5000' end
    else case p_category
      when 'goods' then '6000' when 'assets' then '2200' when 'services' then '6300' when 'rent' then '6100'
      when 'utilities' then '6110' when 'telecom' then '6120' when 'fuel' then '6130' when 'vehicles' then '6140'
      when 'transport' then '6150' when 'wages' then '6200' when 'contributions' then '6210' when 'taxes' then '6400'
      when 'admin' then '6330' when 'operating' then '6340' when 'travel' then '6350' when 'representation' then '6360'
      when 'maintenance' then '6310' when 'marketing' then '6320' when 'bank' then '6500' else '6900' end
  end
$$;

create or replace function public._acc_tx_account(p_category text, p_amount numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_category
    when 'income' then '5900' when 'owner' then '4000' when 'loan' then '3200'
    when 'interest' then case when p_amount > 0 then '5910' else '6700' end
    when 'wages' then '6200' when 'taxes' then '3700' when 'vat' then '3790' when 'contributions' then '6210'
    when 'bank_fee' then '6500' when 'transfer' then '1090'
    else case when p_amount > 0 then '5900' else '6900' end
  end
$$;

create or replace function public._acc_money_account(p_account uuid, p_method text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case coalesce((select kind from public.acc_money_accounts where id = p_account), p_method) when 'cash' then '1010' else '1020' end
$$;

create or replace function public.acc_coa_list(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if not exists (select 1 from public.acc_coa where client_id = c.id) then
    perform public._acc_seed_coa(c.id);
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(a) - 'client_id' order by a.code), '[]'::jsonb) from public.acc_coa a where a.client_id = c.id);
end $$;

create or replace function public.acc_save_coa(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_code text := trim(coalesce(p->>'code', ''));
  v_old text := nullif(trim(coalesce(p->>'old_code', '')), '');
begin
  if v_code !~ '^[0-9]{3,8}$' then
    raise exception 'Kodi i kontos ka 3–8 shifra' using errcode = '22023';
  end if;
  if trim(coalesce(p->>'name', '')) = '' then
    raise exception 'Shkruaj emrin e kontos' using errcode = '22023';
  end if;
  perform public._acc_seed_coa(c.id);
  if v_old is not null and v_old <> v_code then
    raise exception 'Kodi i një kontoje ekzistuese nuk ndryshohet; krijo një konto të re' using errcode = '22023';
  end if;
  insert into public.acc_coa (client_id, code, name, type, active)
  values (c.id, v_code, left(trim(p->>'name'), 120), p->>'type', coalesce((p->>'active')::boolean, true))
  on conflict (client_id, code) do update set name = excluded.name,
    type = case when public.acc_coa.system then public.acc_coa.type else excluded.type end, active = excluded.active;
end $$;

create or replace function public.acc_delete_coa(p_client uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if exists (select 1 from public.acc_coa where client_id = c.id and code = p_code and system) then
    raise exception 'Kontot bazë nuk fshihen (mund t''i çaktivizosh)' using errcode = '22023';
  end if;
  if exists (select 1 from public.acc_journal_lines l join public.acc_journal_entries e on e.id = l.entry_id where e.client_id = c.id and l.account = p_code) then
    raise exception 'Konto përdoret në ditar; çaktivizoje në vend që ta fshish' using errcode = '23503';
  end if;
  delete from public.acc_coa where client_id = c.id and code = p_code;
end $$;

-- ---------------------------------------------------------------------
-- Month close: nothing dated in a locked month changes
-- ---------------------------------------------------------------------
create or replace function public._acc_month_locked(p_client uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select books_locked from public.acc_periods where client_id = p_client and month = date_trunc('month', p_date)::date), false)
$$;

create or replace function public.acc_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_dates date[];
  d date;
begin
  case tg_table_name
    when 'acc_documents' then
      v_client := coalesce(new.client_id, old.client_id);
      v_dates := array_remove(array[case when tg_op <> 'INSERT' then old.doc_date end, case when tg_op <> 'DELETE' then new.doc_date end], null);
    when 'acc_payments' then
      v_client := coalesce(new.client_id, old.client_id);
      v_dates := array_remove(array[case when tg_op <> 'INSERT' then old.pay_date end, case when tg_op <> 'DELETE' then new.pay_date end], null);
    when 'acc_transactions' then
      v_client := coalesce(new.client_id, old.client_id);
      v_dates := array_remove(array[case when tg_op <> 'INSERT' then old.tx_date end, case when tg_op <> 'DELETE' then new.tx_date end], null);
    when 'acc_journal_entries' then
      v_client := coalesce(new.client_id, old.client_id);
      v_dates := array_remove(array[case when tg_op <> 'INSERT' then old.entry_date end, case when tg_op <> 'DELETE' then new.entry_date end], null);
  end case;
  -- the whole company is being deleted: nothing to protect
  if tg_op = 'DELETE' and not exists (select 1 from public.acc_clients where id = v_client) then
    return old;
  end if;
  foreach d in array v_dates loop
    if public._acc_month_locked(v_client, d) then
      raise exception 'Muaji % është i mbyllur; hape te "Mbyllja e muajit" për ta ndryshuar', to_char(d, 'MM.YYYY') using errcode = '42501';
    end if;
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists acc_documents_lock on public.acc_documents;
create trigger acc_documents_lock before insert or update or delete on public.acc_documents for each row execute function public.acc_lock_guard();
drop trigger if exists acc_payments_lock on public.acc_payments;
create trigger acc_payments_lock before insert or update or delete on public.acc_payments for each row execute function public.acc_lock_guard();
drop trigger if exists acc_transactions_lock on public.acc_transactions;
create trigger acc_transactions_lock before insert or update or delete on public.acc_transactions for each row execute function public.acc_lock_guard();
drop trigger if exists acc_journal_entries_lock on public.acc_journal_entries;
create trigger acc_journal_entries_lock before insert or update or delete on public.acc_journal_entries for each row execute function public.acc_lock_guard();

create or replace function public.acc_lock_month(p_client uuid, p_month date, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_month date := date_trunc('month', p_month)::date;
begin
  insert into public.acc_periods (client_id, month, books_locked) values (c.id, v_month, p_locked)
  on conflict (client_id, month) do update set books_locked = excluded.books_locked;
end $$;

-- ---------------------------------------------------------------------
-- Manual journal entries
-- ---------------------------------------------------------------------
create or replace function public.acc_save_journal(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_lines jsonb := coalesce(p->'lines', '[]'::jsonb);
  v_dr numeric := 0;
  v_cr numeric := 0;
  l jsonb;
  i int := 0;
  v_no int;
begin
  perform public._acc_seed_coa(c.id);
  if trim(coalesce(p->>'description', '')) = '' then
    raise exception 'Shkruaj përshkrimin e regjistrimit' using errcode = '22023';
  end if;
  if jsonb_array_length(v_lines) < 2 then
    raise exception 'Regjistrimi ka të paktën dy rreshta' using errcode = '22023';
  end if;
  for l in select * from jsonb_array_elements(v_lines) loop
    i := i + 1;
    if not exists (select 1 from public.acc_coa where client_id = c.id and code = l->>'account' and active) then
      raise exception 'Rreshti %: konto % nuk ekziston në planin kontabël', i, l->>'account' using errcode = '22023';
    end if;
    if round(coalesce((l->>'debit')::numeric, 0), 2) < 0 or round(coalesce((l->>'credit')::numeric, 0), 2) < 0
       or (round(coalesce((l->>'debit')::numeric, 0), 2) > 0) = (round(coalesce((l->>'credit')::numeric, 0), 2) > 0) then
      raise exception 'Rreshti %: shkruaj ose debi ose kredi', i using errcode = '22023';
    end if;
    v_dr := v_dr + round(coalesce((l->>'debit')::numeric, 0), 2);
    v_cr := v_cr + round(coalesce((l->>'credit')::numeric, 0), 2);
  end loop;
  if v_dr <> v_cr then
    raise exception 'Debia (%) dhe kredia (%) nuk barazohen', v_dr, v_cr using errcode = '22023';
  end if;

  if v_id is null then
    select coalesce(max(entry_no), 0) + 1 into v_no from public.acc_journal_entries where client_id = c.id;
    insert into public.acc_journal_entries (client_id, entry_no, entry_date, kind, description, created_by)
    values (c.id, v_no, (p->>'entry_date')::date, coalesce(nullif(p->>'kind', ''), 'manual'), left(trim(p->>'description'), 300), auth.uid())
    returning id into v_id;
  else
    update public.acc_journal_entries set entry_date = (p->>'entry_date')::date, kind = coalesce(nullif(p->>'kind', ''), kind),
           description = left(trim(p->>'description'), 300)
     where id = v_id and client_id = c.id;
    if not found then
      raise exception 'Regjistrimi nuk u gjet' using errcode = 'P0002';
    end if;
    delete from public.acc_journal_lines where entry_id = v_id;
  end if;
  i := 0;
  for l in select * from jsonb_array_elements(v_lines) loop
    i := i + 1;
    insert into public.acc_journal_lines (entry_id, position, account, debit, credit, partner_id, memo)
    values (v_id, i, l->>'account', round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
            nullif(l->>'partner_id', '')::uuid, nullif(trim(left(coalesce(l->>'memo', ''), 200)), ''));
  end loop;
  return v_id;
end $$;

create or replace function public.acc_delete_journal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.acc_journal_entries e using public.acc_clients c
   where e.id = p_id and c.id = e.client_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Regjistrimi nuk u gjet' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Fixed assets
-- ---------------------------------------------------------------------
create or replace function public.acc_save_asset(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if trim(coalesce(p->>'name', '')) = '' then
    raise exception 'Shkruaj emrin e asetit' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.acc_assets (client_id, name, category, acquired_on, cost, salvage, rate_pct, doc_id, disposed_on, disposal_value, note)
    values (c.id, left(trim(p->>'name'), 150), coalesce(nullif(p->>'category', ''), 'equipment'), (p->>'acquired_on')::date,
            round((p->>'cost')::numeric, 2), round(coalesce((p->>'salvage')::numeric, 0), 2), round((p->>'rate_pct')::numeric, 2),
            nullif(p->>'doc_id', '')::uuid, nullif(p->>'disposed_on', '')::date, nullif(p->>'disposal_value', '')::numeric, nullif(trim(coalesce(p->>'note', '')), ''))
    returning id into v_id;
  else
    update public.acc_assets set name = left(trim(p->>'name'), 150), category = coalesce(nullif(p->>'category', ''), category),
           acquired_on = (p->>'acquired_on')::date, cost = round((p->>'cost')::numeric, 2), salvage = round(coalesce((p->>'salvage')::numeric, 0), 2),
           rate_pct = round((p->>'rate_pct')::numeric, 2), disposed_on = nullif(p->>'disposed_on', '')::date,
           disposal_value = nullif(p->>'disposal_value', '')::numeric, note = nullif(trim(coalesce(p->>'note', '')), '')
     where id = v_id and client_id = c.id;
    if not found then
      raise exception 'Aseti nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.acc_delete_asset(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.acc_assets a using public.acc_clients c
   where a.id = p_id and c.id = a.client_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Aseti nuk u gjet' using errcode = 'P0002';
  end if;
end $$;

-- Monthly depreciation of an asset: (cost − salvage) × rate / 12, from the month after it was
-- acquired until it is fully depreciated or disposed of.
create or replace function public._acc_depreciation(p_client uuid, p_from date, p_to date)
returns table (asset_id uuid, month_end date, amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select a.id, a.cost, a.salvage, a.rate_pct, a.acquired_on, a.disposed_on,
           (date_trunc('month', g.m) + interval '1 month - 1 day')::date as month_end,
           row_number() over (partition by a.id order by g.m) as n
    from public.acc_assets a
    cross join lateral generate_series(date_trunc('month', a.acquired_on) + interval '1 month',
                                       date_trunc('month', least(coalesce(a.disposed_on, p_to), p_to)), interval '1 month') as g(m)
    where a.client_id = p_client
  )
  select id, month_end,
         greatest(0, least(round((cost - salvage) * rate_pct / 100 / 12, 2),
                           (cost - salvage) - round((cost - salvage) * rate_pct / 100 / 12, 2) * (n - 1)))
  from m
  where month_end between p_from and p_to
    and round((cost - salvage) * rate_pct / 100 / 12, 2) * (n - 1) < (cost - salvage)
$$;

create or replace function public.acc_assets_list(p_client uuid, p_as_of date default null)
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
    select coalesce(jsonb_agg(to_jsonb(a) - 'client_id' || jsonb_build_object(
             'depreciated', coalesce((select sum(d.amount) from public._acc_depreciation(c.id, date '1900-01-01', v_date) d where d.asset_id = a.id), 0),
             'monthly', round((a.cost - a.salvage) * a.rate_pct / 100 / 12, 2),
             'year_dep', coalesce((select sum(d.amount) from public._acc_depreciation(c.id, date_trunc('year', v_date)::date, v_date) d where d.asset_id = a.id), 0))
           order by a.acquired_on), '[]'::jsonb)
    from public.acc_assets a where a.client_id = c.id
  );
end $$;

-- ---------------------------------------------------------------------
-- All postings of a period (automatic + manual)
-- ---------------------------------------------------------------------
create or replace function public._acc_entries(p_client uuid, p_from date, p_to date)
returns table (entry_date date, source text, source_id uuid, ref text, description text, account text, debit numeric, credit numeric, partner text)
language sql
stable
security definer
set search_path = ''
as $$
  with docs as (
    select d.*, sign(d.total) as s,
           abs(d.net_e + d.net_d + d.amt_c + d.amt_a) as net, abs(d.vat_e + d.vat_d) as vat, abs(d.vat_nd) as nd, abs(d.total) as gross
    from public.acc_documents d
    where d.client_id = p_client and d.kind in ('sale', 'purchase') and d.doc_date between p_from and p_to and d.total <> 0
  ), lines as (
    -- sale: Dr 1200 gross / Cr income net / Cr 3600 VAT   (credit note: the other way round)
    select doc_date as entry_date, 'doc'::text as source, id as source_id, doc_no as ref, coalesce(partner_name, '') as description, '1200'::text as account,
           case when s > 0 then gross else 0 end as debit, case when s < 0 then gross else 0 end as credit, partner_name as partner
    from docs where kind = 'sale'
    union all
    select doc_date, 'doc', id, doc_no, coalesce(partner_name, ''), public._acc_cat_account('sale', category), case when s < 0 then net else 0 end, case when s > 0 then net else 0 end, partner_name from docs where kind = 'sale' and net <> 0
    union all
    select doc_date, 'doc', id, doc_no, coalesce(partner_name, ''), '3600', case when s < 0 then vat else 0 end, case when s > 0 then vat else 0 end, partner_name from docs where kind = 'sale' and vat <> 0
    union all
    -- purchase: Dr expense / asset (net + non-deductible VAT), Dr 1600 VAT, Cr 3100 gross
    select doc_date, 'doc', id, doc_no, coalesce(partner_name, ''), public._acc_cat_account('purchase', category), case when s > 0 then net + nd else 0 end, case when s < 0 then net + nd else 0 end, partner_name from docs where kind = 'purchase' and net + nd <> 0
    union all
    select doc_date, 'doc', id, doc_no, coalesce(partner_name, ''), '1600', case when s > 0 then vat else 0 end, case when s < 0 then vat else 0 end, partner_name from docs where kind = 'purchase' and vat <> 0
    union all
    select doc_date, 'doc', id, doc_no, coalesce(partner_name, ''), '3100', case when s < 0 then gross else 0 end, case when s > 0 then gross else 0 end, partner_name from docs where kind = 'purchase'
    union all
    -- invoice payments: money account against 1200 / 3100
    select x.pay_date, 'payment', x.id, d.doc_no, 'Pagesë · ' || coalesce(d.partner_name, ''),
           public._acc_money_account(x.account_id, x.method),
           case when public._acc_pay_sign(d.kind, d.doc_type) > 0 then x.amount else 0 end,
           case when public._acc_pay_sign(d.kind, d.doc_type) < 0 then x.amount else 0 end, d.partner_name
    from public.acc_payments x join public.acc_documents d on d.id = x.doc_id
    where x.client_id = p_client and x.pay_date between p_from and p_to
    union all
    select x.pay_date, 'payment', x.id, d.doc_no, 'Pagesë · ' || coalesce(d.partner_name, ''),
           case d.kind when 'sale' then '1200' else '3100' end,
           case when public._acc_pay_sign(d.kind, d.doc_type) < 0 then x.amount else 0 end,
           case when public._acc_pay_sign(d.kind, d.doc_type) > 0 then x.amount else 0 end, d.partner_name
    from public.acc_payments x join public.acc_documents d on d.id = x.doc_id
    where x.client_id = p_client and x.pay_date between p_from and p_to
    union all
    -- older entries paid at once (no payment rows): the money moved on the document date
    select d.doc_date, 'payment', d.id, d.doc_no, 'Pagesë · ' || coalesce(d.partner_name, ''), case d.payment when 'cash' then '1010' else '1020' end,
           case when d.kind = 'sale' and d.total > 0 or d.kind = 'purchase' and d.total < 0 then abs(d.total) else 0 end,
           case when d.kind = 'purchase' and d.total > 0 or d.kind = 'sale' and d.total < 0 then abs(d.total) else 0 end, d.partner_name
    from public.acc_documents d
    where d.client_id = p_client and d.kind in ('sale', 'purchase') and d.payment <> 'due' and d.doc_date between p_from and p_to
      and not exists (select 1 from public.acc_payments x where x.doc_id = d.id)
    union all
    select d.doc_date, 'payment', d.id, d.doc_no, 'Pagesë · ' || coalesce(d.partner_name, ''), case d.kind when 'sale' then '1200' else '3100' end,
           case when d.kind = 'purchase' and d.total > 0 or d.kind = 'sale' and d.total < 0 then abs(d.total) else 0 end,
           case when d.kind = 'sale' and d.total > 0 or d.kind = 'purchase' and d.total < 0 then abs(d.total) else 0 end, d.partner_name
    from public.acc_documents d
    where d.client_id = p_client and d.kind in ('sale', 'purchase') and d.payment <> 'due' and d.doc_date between p_from and p_to
      and not exists (select 1 from public.acc_payments x where x.doc_id = d.id)
    union all
    -- money movements without invoice
    select t.tx_date, 'tx', t.id, t.reference, coalesce(t.description, t.category), public._acc_money_account(t.account_id, null),
           greatest(t.amount, 0), greatest(-t.amount, 0), null
    from public.acc_transactions t where t.client_id = p_client and t.tx_date between p_from and p_to
    union all
    select t.tx_date, 'tx', t.id, t.reference, coalesce(t.description, t.category), public._acc_tx_account(t.category, t.amount),
           greatest(-t.amount, 0), greatest(t.amount, 0), null
    from public.acc_transactions t where t.client_id = p_client and t.tx_date between p_from and p_to
    union all
    -- opening balance of money accounts
    select a.opening_date, 'opening', a.id, null, 'Gjendja fillestare · ' || a.name, case a.kind when 'cash' then '1010' else '1020' end,
           greatest(a.opening_balance, 0), greatest(-a.opening_balance, 0), null
    from public.acc_money_accounts a where a.client_id = p_client and a.opening_balance <> 0 and a.opening_date between p_from and p_to
    union all
    select a.opening_date, 'opening', a.id, null, 'Gjendja fillestare · ' || a.name, '4900',
           greatest(-a.opening_balance, 0), greatest(a.opening_balance, 0), null
    from public.acc_money_accounts a where a.client_id = p_client and a.opening_balance <> 0 and a.opening_date between p_from and p_to
    union all
    -- monthly VAT settlement: 3600 and 1600 close into 3790 at month end
    select v.m_end, 'vat', null::uuid, to_char(v.m_end, 'MM.YYYY'), 'Mbyllja e TVSH-së', '3600', v.vout, 0::numeric, null
    from (select (date_trunc('month', doc_date) + interval '1 month - 1 day')::date as m_end,
                 sum(case when kind = 'sale' then vat_e + vat_d else 0 end) as vout,
                 sum(case when kind = 'purchase' then vat_e + vat_d else 0 end) as vin
          from public.acc_documents where client_id = p_client and kind in ('sale', 'purchase') group by 1) v
    where v.m_end between p_from and p_to and v.vout <> 0
    union all
    select v.m_end, 'vat', null::uuid, to_char(v.m_end, 'MM.YYYY'), 'Mbyllja e TVSH-së', '1600', 0::numeric, v.vin, null
    from (select (date_trunc('month', doc_date) + interval '1 month - 1 day')::date as m_end,
                 sum(case when kind = 'purchase' then vat_e + vat_d else 0 end) as vin
          from public.acc_documents where client_id = p_client and kind in ('sale', 'purchase') group by 1) v
    where v.m_end between p_from and p_to and v.vin <> 0
    union all
    select v.m_end, 'vat', null::uuid, to_char(v.m_end, 'MM.YYYY'), 'Mbyllja e TVSH-së', '3790',
           greatest(v.vin - v.vout, 0), greatest(v.vout - v.vin, 0), null
    from (select (date_trunc('month', doc_date) + interval '1 month - 1 day')::date as m_end,
                 sum(case when kind = 'sale' then vat_e + vat_d else 0 end) as vout,
                 sum(case when kind = 'purchase' then vat_e + vat_d else 0 end) as vin
          from public.acc_documents where client_id = p_client and kind in ('sale', 'purchase') group by 1) v
    where v.m_end between p_from and p_to and v.vout <> v.vin
    union all
    -- depreciation
    select dp.month_end, 'depreciation', dp.asset_id, null, 'Amortizimi · ' || a.name, '6600', dp.amount, 0::numeric, null
    from public._acc_depreciation(p_client, p_from, p_to) dp join public.acc_assets a on a.id = dp.asset_id where dp.amount > 0
    union all
    select dp.month_end, 'depreciation', dp.asset_id, null, 'Amortizimi · ' || a.name, '2290', 0::numeric, dp.amount, null
    from public._acc_depreciation(p_client, p_from, p_to) dp join public.acc_assets a on a.id = dp.asset_id where dp.amount > 0
    union all
    -- manual entries
    select e.entry_date, 'journal', e.id, 'R-' || e.entry_no, coalesce(l.memo, e.description), l.account, l.debit, l.credit,
           (select p.name from public.acc_partners p where p.id = l.partner_id)
    from public.acc_journal_entries e join public.acc_journal_lines l on l.entry_id = e.id
    where e.client_id = p_client and e.entry_date between p_from and p_to
  )
  select * from lines where debit <> 0 or credit <> 0
$$;

-- ---------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------
create or replace function public.acc_trial_balance(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  perform public._acc_seed_coa(c.id);
  return (
    with op as (select account, sum(debit - credit) as bal from public._acc_entries(c.id, date '1900-01-01', p_from - 1) group by account),
         pe as (select account, sum(debit) as dr, sum(credit) as cr from public._acc_entries(c.id, p_from, p_to) group by account),
         acc as (select coalesce(op.account, pe.account) as account, coalesce(op.bal, 0) as opening, coalesce(pe.dr, 0) as dr, coalesce(pe.cr, 0) as cr
                 from op full join pe on pe.account = op.account)
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', acc.account, 'name', coalesce(k.name, 'Konto e panjohur'), 'type', coalesce(k.type, case left(acc.account, 1) when '1' then 'asset' when '2' then 'asset' when '3' then 'liability' when '4' then 'equity' when '5' then 'income' else 'expense' end),
             'opening', acc.opening, 'debit', acc.dr, 'credit', acc.cr, 'closing', acc.opening + acc.dr - acc.cr) order by acc.account), '[]'::jsonb)
    from acc left join public.acc_coa k on k.client_id = c.id and k.code = acc.account
    where acc.opening <> 0 or acc.dr <> 0 or acc.cr <> 0
  );
end $$;

create or replace function public.acc_general_ledger(p_client uuid, p_account text, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  return jsonb_build_object(
    'opening', (select coalesce(sum(debit - credit), 0) from public._acc_entries(c.id, date '1900-01-01', p_from - 1) where account = p_account),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('date', e.entry_date, 'source', e.source, 'source_id', e.source_id, 'ref', e.ref,
                                                          'text', e.description, 'debit', e.debit, 'credit', e.credit, 'partner', e.partner)
                                       order by e.entry_date, e.source, e.ref), '[]'::jsonb)
             from public._acc_entries(c.id, p_from, p_to) e where e.account = p_account)
  );
end $$;

-- Journal: postings of the period grouped by their source (document, payment, movement, entry…)
create or replace function public.acc_journal(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object('date', g.entry_date, 'source', g.source, 'source_id', g.source_id, 'ref', g.ref, 'text', g.description, 'lines', g.lines)
                              order by g.entry_date, g.source, g.ref), '[]'::jsonb)
    from (
      select e.entry_date, e.source, e.source_id, max(e.ref) as ref, max(e.description) as description,
             jsonb_agg(jsonb_build_object('account', e.account, 'name', (select k.name from public.acc_coa k where k.client_id = c.id and k.code = e.account),
                                          'debit', e.debit, 'credit', e.credit) order by e.debit desc, e.account) as lines
      from public._acc_entries(c.id, p_from, p_to) e
      group by e.entry_date, e.source, e.source_id, case when e.source_id is null then e.ref end
    ) g
  );
end $$;

create or replace function public.acc_journal_entry(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.acc_journal_entries;
begin
  select je.* into e from public.acc_journal_entries je join public.acc_clients c on c.id = je.client_id
   where je.id = p_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Regjistrimi nuk u gjet' using errcode = 'P0002';
  end if;
  return to_jsonb(e) || jsonb_build_object('lines', (select coalesce(jsonb_agg(to_jsonb(l) - 'entry_id' order by l.position), '[]'::jsonb)
                                                     from public.acc_journal_lines l where l.entry_id = e.id));
end $$;

-- Balance sheet at p_to and income statement for p_from – p_to.
create or replace function public.acc_financial_statements(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  perform public._acc_seed_coa(c.id);
  return (
    with bal as (select account, sum(debit - credit) as b from public._acc_entries(c.id, date '1900-01-01', p_to) group by account),
         per as (select account, sum(debit - credit) as b from public._acc_entries(c.id, p_from, p_to) group by account),
         k as (select code, name, type from public.acc_coa where client_id = c.id),
         typed as (select bal.account, coalesce(k.name, bal.account) as name,
                          coalesce(k.type, case left(bal.account, 1) when '1' then 'asset' when '2' then 'asset' when '3' then 'liability' when '4' then 'equity' when '5' then 'income' else 'expense' end) as type,
                          bal.b from bal left join k on k.code = bal.account where bal.b <> 0),
         ptyped as (select per.account, coalesce(k.name, per.account) as name,
                           coalesce(k.type, case left(per.account, 1) when '5' then 'income' else 'expense' end) as type, per.b
                    from per left join k on k.code = per.account where per.b <> 0)
    select jsonb_build_object(
      'as_of', p_to, 'from', p_from,
      'assets', coalesce((select jsonb_agg(jsonb_build_object('code', account, 'name', name, 'amount', b) order by account) from typed where type = 'asset'), '[]'::jsonb),
      'liabilities', coalesce((select jsonb_agg(jsonb_build_object('code', account, 'name', name, 'amount', -b) order by account) from typed where type = 'liability'), '[]'::jsonb),
      'equity', coalesce((select jsonb_agg(jsonb_build_object('code', account, 'name', name, 'amount', -b) order by account) from typed where type = 'equity'), '[]'::jsonb),
      'result_to_date', coalesce((select -sum(b) from typed where type in ('income', 'expense')), 0),
      'income', coalesce((select jsonb_agg(jsonb_build_object('code', account, 'name', name, 'amount', -b) order by account) from ptyped where type = 'income'), '[]'::jsonb),
      'expenses', coalesce((select jsonb_agg(jsonb_build_object('code', account, 'name', name, 'amount', b) order by account) from ptyped where type = 'expense'), '[]'::jsonb)
    )
  );
end $$;

create or replace function public.acc_periods_list(p_client uuid, p_year int)
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
    select jsonb_agg(jsonb_build_object(
             'month', m, 'locked', coalesce(p.books_locked, false), 'vat_status', coalesce(r.status, p.vat_status, 'open'),
             'docs', (select count(*) from public.acc_documents d where d.client_id = c.id and d.kind in ('sale', 'purchase') and date_trunc('month', d.doc_date) = m),
             'unmatched', (select count(*) from public.acc_bank_lines l where l.client_id = c.id and l.status = 'new' and date_trunc('month', l.line_date) = m),
             'no_partner', (select count(*) from public.acc_documents d where d.client_id = c.id and d.kind in ('sale', 'purchase') and d.partner_id is null and d.partner_name is null and date_trunc('month', d.doc_date) = m))
           order by m)
    from generate_series(make_date(p_year, 1, 1), make_date(p_year, 12, 1), interval '1 month') g(m)
    left join public.acc_periods p on p.client_id = c.id and p.month = g.m
    left join public.acc_vat_returns r on r.client_id = c.id and r.month = g.m
  );
end $$;

revoke execute on function public._acc_seed_coa(uuid), public._acc_cat_account(text, text), public._acc_tx_account(text, numeric),
  public._acc_money_account(uuid, text), public._acc_month_locked(uuid, date), public.acc_lock_guard(), public._acc_depreciation(uuid, date, date),
  public._acc_entries(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.acc_coa_list(uuid), public.acc_save_coa(jsonb), public.acc_delete_coa(uuid, text), public.acc_lock_month(uuid, date, boolean),
  public.acc_save_journal(jsonb), public.acc_delete_journal(uuid), public.acc_save_asset(jsonb), public.acc_delete_asset(uuid), public.acc_assets_list(uuid, date),
  public.acc_trial_balance(uuid, date, date), public.acc_general_ledger(uuid, text, date, date), public.acc_journal(uuid, date, date), public.acc_journal_entry(uuid),
  public.acc_financial_statements(uuid, date, date), public.acc_periods_list(uuid, int) from public, anon;
grant execute on function public.acc_coa_list(uuid), public.acc_save_coa(jsonb), public.acc_delete_coa(uuid, text), public.acc_lock_month(uuid, date, boolean),
  public.acc_save_journal(jsonb), public.acc_delete_journal(uuid), public.acc_save_asset(jsonb), public.acc_delete_asset(uuid), public.acc_assets_list(uuid, date),
  public.acc_trial_balance(uuid, date, date), public.acc_general_ledger(uuid, text, date, date), public.acc_journal(uuid, date, date), public.acc_journal_entry(uuid),
  public.acc_financial_statements(uuid, date, date), public.acc_periods_list(uuid, int) to authenticated;
