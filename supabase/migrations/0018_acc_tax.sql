-- =====================================================================
-- 0018 – Kasa Kontabilist, phase K3: VAT return (ATK form TV-A7), sales / purchase books,
--        tax regime, other taxes, filings and the deadline calendar.
--
-- * acc_documents.vat_flag: how a document enters the VAT form beyond its rates –
--   service_abroad [10a], reverse_charge [10b] / [28]+[65], exempt_credit [10c],
--   import [35]–[42], farmer [51].
-- * acc_clients.tax_regime: corporate (10% of profit), individual_real (progressive),
--   individual_small_3 / individual_small_9 (3% / 9% of turnover).
-- * acc_vat_form(client, month): the boxes [9]–[67] computed from the documents of the month
--   (and the Kasa till for linked clients) plus the carry-over [68] of the month before.
-- * acc_vat_returns: the saved return of a month – computed + manual boxes, final boxes,
--   status (draft / filed), filing and payment data. [71] carries into the next month.
-- * acc_vat_book(client, month, kind): one row per document with the box columns, in the order
--   of the ATK sales / purchase book (EDI), with the NUI/NF column codes of the ATK guide.
-- * acc_tax_filings: other declarations and payments (rent tax, payroll, income tax…).
-- * acc_tax_calendar(from, to): deadlines of every client of the accountant with their status.
-- Older clients keep working: nothing the live app uses changes shape.
-- =====================================================================

alter table public.acc_documents add column if not exists vat_flag text not null default 'none'
  check (vat_flag in ('none', 'service_abroad', 'reverse_charge', 'exempt_credit', 'import', 'farmer'));

alter table public.acc_clients add column if not exists tax_regime text not null default 'corporate'
  check (tax_regime in ('corporate', 'individual_real', 'individual_small_3', 'individual_small_9'));

create table if not exists public.acc_vat_returns (
  client_id  uuid not null references public.acc_clients (id) on delete cascade,
  month      date not null check (extract(day from month) = 1),
  computed   jsonb not null default '{}'::jsonb,
  manual     jsonb not null default '{}'::jsonb,
  boxes      jsonb not null default '{}'::jsonb,   -- final values [9]..[72]
  status     text not null default 'draft' check (status in ('draft', 'filed')),
  filed_at   date,
  reference  text,
  paid_at    date,
  paid_amount numeric(14, 2),
  note       text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (client_id, month)
);

create table if not exists public.acc_tax_filings (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.acc_clients (id) on delete cascade,
  kind       text not null check (kind in ('rent', 'payroll', 'income_q', 'income_annual', 'withholding', 'other')),
  period     date not null,             -- first day of the month / quarter / year it is for
  amount     numeric(14, 2) not null default 0,
  status     text not null default 'filed' check (status in ('draft', 'filed', 'paid')),
  filed_at   date,
  paid_at    date,
  reference  text,
  note       text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (client_id, kind, period)
);

alter table public.acc_vat_returns enable row level security;
alter table public.acc_tax_filings enable row level security;
drop policy if exists acc_vat_returns_own on public.acc_vat_returns;
create policy acc_vat_returns_own on public.acc_vat_returns for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_tax_filings_own on public.acc_tax_filings;
create policy acc_tax_filings_own on public.acc_tax_filings for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
revoke all on public.acc_vat_returns, public.acc_tax_filings from anon, authenticated;
grant select on public.acc_vat_returns, public.acc_tax_filings to authenticated;

-- Documents may carry the VAT flag and the client its tax regime (small additions to the saves).
create or replace function public.acc_set_vat_flag(p_doc uuid, p_flag text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_flag not in ('none', 'service_abroad', 'reverse_charge', 'exempt_credit', 'import', 'farmer') then
    raise exception 'Lloji për TVSH nuk njihet' using errcode = '22023';
  end if;
  update public.acc_documents set vat_flag = p_flag, updated_at = now()
   where id = p_doc and accountant_id = public._require_accountant();
  if not found then
    raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.acc_set_tax_regime(p_client uuid, p_regime text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if p_regime not in ('corporate', 'individual_real', 'individual_small_3', 'individual_small_9') then
    raise exception 'Regjimi tatimor nuk njihet' using errcode = '22023';
  end if;
  update public.acc_clients set tax_regime = p_regime, updated_at = now() where id = c.id;
end $$;

-- ---------------------------------------------------------------------
-- The VAT form of a month, computed
-- ---------------------------------------------------------------------
create or replace function public.acc_vat_form(p_client uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  b jsonb;
  k jsonb;
  r record;
  v_kasa boolean := c.kasa_business_id is not null and c.link_status = 'approved'
                    and exists (select 1 from public.business_members m join public.businesses bb on bb.id = m.business_id
                                where m.user_id = c.accountant_id and m.business_id = c.kasa_business_id and m.status = 'active' and bb.active);
  prev public.acc_vat_returns;
  sv public.acc_vat_returns;
begin
  with d as (
    select x.*, (x.category = 'assets') as asset
    from public.acc_documents x
    where x.client_id = c.id and x.kind in ('sale', 'purchase') and x.doc_date between v_from and v_to
  )
  select jsonb_build_object(
    -- outputs
    '9',   coalesce(sum(abs(amt_a)) filter (where kind = 'sale' and doc_type = 'invoice'), 0),
    '10a', coalesce(sum(abs(amt_c)) filter (where kind = 'sale' and doc_type = 'invoice' and not export and vat_flag = 'service_abroad'), 0),
    '10b', coalesce(sum(abs(amt_c)) filter (where kind = 'sale' and doc_type = 'invoice' and not export and vat_flag = 'reverse_charge'), 0),
    '10c', coalesce(sum(abs(amt_c)) filter (where kind = 'sale' and doc_type = 'invoice' and not export and vat_flag not in ('service_abroad', 'reverse_charge')), 0),
    '11',  coalesce(sum(abs(amt_c)) filter (where kind = 'sale' and doc_type = 'invoice' and export), 0),
    '12',  coalesce(sum(net_e) filter (where kind = 'sale' and doc_type = 'invoice'), 0),
    '13',  coalesce(sum(vat_e) filter (where kind = 'sale' and doc_type = 'invoice'), 0),
    '14',  coalesce(sum(net_d) filter (where kind = 'sale' and doc_type = 'invoice'), 0),
    '15',  coalesce(sum(vat_d) filter (where kind = 'sale' and doc_type = 'invoice'), 0),
    '16',  coalesce(sum(abs(net_e)) filter (where (kind = 'sale' and doc_type = 'debit_note') or (kind = 'purchase' and doc_type = 'credit_note')), 0),
    '17',  coalesce(sum(abs(vat_e)) filter (where (kind = 'sale' and doc_type = 'debit_note') or (kind = 'purchase' and doc_type = 'credit_note')), 0),
    '18',  coalesce(sum(abs(net_d)) filter (where (kind = 'sale' and doc_type = 'debit_note') or (kind = 'purchase' and doc_type = 'credit_note')), 0),
    '19',  coalesce(sum(abs(vat_d)) filter (where (kind = 'sale' and doc_type = 'debit_note') or (kind = 'purchase' and doc_type = 'credit_note')), 0),
    '28',  coalesce(sum(net_e + net_d + amt_c + amt_a) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'reverse_charge'), 0),
    -- inputs
    '31',  coalesce(sum(amt_c + amt_a) filter (where kind = 'purchase' and doc_type = 'invoice' and not asset and vat_flag not in ('reverse_charge', 'import')), 0),
    '32',  coalesce(sum(amt_c + amt_a) filter (where kind = 'purchase' and doc_type = 'invoice' and asset and vat_flag not in ('reverse_charge', 'import')), 0),
    '33',  coalesce(sum(net_e + net_d) filter (where kind = 'purchase' and doc_type = 'invoice' and not asset and vat_nd <> 0 and vat_flag <> 'reverse_charge'), 0),
    '34',  coalesce(sum(net_e + net_d) filter (where kind = 'purchase' and doc_type = 'invoice' and asset and vat_nd <> 0 and vat_flag <> 'reverse_charge'), 0),
    '35',  coalesce(sum(net_e) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'import' and not asset and vat_nd = 0), 0),
    '36',  coalesce(sum(vat_e) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'import' and not asset and vat_nd = 0), 0),
    '37',  coalesce(sum(net_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'import' and not asset and vat_nd = 0), 0),
    '38',  coalesce(sum(vat_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'import' and not asset and vat_nd = 0), 0),
    '39',  coalesce(sum(net_e) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'import' and asset and vat_nd = 0), 0),
    '40',  coalesce(sum(vat_e) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'import' and asset and vat_nd = 0), 0),
    '41',  coalesce(sum(net_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'import' and asset and vat_nd = 0), 0),
    '42',  coalesce(sum(vat_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'import' and asset and vat_nd = 0), 0),
    '43',  coalesce(sum(net_e) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag in ('none', 'exempt_credit', 'service_abroad') and not asset and vat_nd = 0), 0),
    '44',  coalesce(sum(vat_e) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag in ('none', 'exempt_credit', 'service_abroad') and not asset and vat_nd = 0), 0),
    '45',  coalesce(sum(net_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag in ('none', 'exempt_credit', 'service_abroad') and not asset and vat_nd = 0), 0),
    '46',  coalesce(sum(vat_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag in ('none', 'exempt_credit', 'service_abroad') and not asset and vat_nd = 0), 0),
    '47',  coalesce(sum(net_e) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag in ('none', 'exempt_credit', 'service_abroad') and asset and vat_nd = 0), 0),
    '48',  coalesce(sum(vat_e) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag in ('none', 'exempt_credit', 'service_abroad') and asset and vat_nd = 0), 0),
    '49',  coalesce(sum(net_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag in ('none', 'exempt_credit', 'service_abroad') and asset and vat_nd = 0), 0),
    '50',  coalesce(sum(vat_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag in ('none', 'exempt_credit', 'service_abroad') and asset and vat_nd = 0), 0),
    '51',  coalesce(sum(net_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'farmer' and vat_nd = 0), 0),
    '52',  coalesce(sum(vat_d) filter (where kind = 'purchase' and doc_type = 'invoice' and vat_flag = 'farmer' and vat_nd = 0), 0),
    '53',  coalesce(sum(abs(net_e)) filter (where (kind = 'purchase' and doc_type = 'debit_note') or (kind = 'sale' and doc_type = 'credit_note')), 0),
    '54',  coalesce(sum(abs(vat_e)) filter (where (kind = 'purchase' and doc_type = 'debit_note') or (kind = 'sale' and doc_type = 'credit_note')), 0),
    '55',  coalesce(sum(abs(net_d)) filter (where (kind = 'purchase' and doc_type = 'debit_note') or (kind = 'sale' and doc_type = 'credit_note')), 0),
    '56',  coalesce(sum(abs(vat_d)) filter (where (kind = 'purchase' and doc_type = 'debit_note') or (kind = 'sale' and doc_type = 'credit_note')), 0)
  ) into b
  from d;

  -- reverse charge: output VAT [29] and the same as input credit [65]/[66]
  b := b || jsonb_build_object('29', round((b->>'28')::numeric * 0.18, 2), '65', (b->>'28')::numeric, '66', round((b->>'28')::numeric * 0.18, 2));

  -- the Kasa till of a linked client: its sales and its purchases / expenses by rate
  if v_kasa then
    k := public._accounting_summary_core(c.kasa_business_id, v_from, v_to, false);
    for r in select x->>'code' as code, coalesce((x->>'net')::numeric, 0) as net, coalesce((x->>'vat')::numeric, 0) as vat from jsonb_array_elements(coalesce(k->'vat_out', '[]'::jsonb)) x loop
      case r.code
        when 'E' then b := b || jsonb_build_object('12', (b->>'12')::numeric + r.net, '13', (b->>'13')::numeric + r.vat);
        when 'D' then b := b || jsonb_build_object('14', (b->>'14')::numeric + r.net, '15', (b->>'15')::numeric + r.vat);
        when 'C' then b := b || jsonb_build_object('10c', (b->>'10c')::numeric + r.net);
        else b := b || jsonb_build_object('9', (b->>'9')::numeric + r.net);
      end case;
    end loop;
    for r in select x->>'code' as code, coalesce((x->>'net')::numeric, 0) as net, coalesce((x->>'vat')::numeric, 0) as vat
             from jsonb_array_elements(coalesce(k->'vat_in', '[]'::jsonb) || coalesce(k->'expense_vat', '[]'::jsonb)) x loop
      case r.code
        when 'E' then b := b || jsonb_build_object('43', (b->>'43')::numeric + r.net, '44', (b->>'44')::numeric + r.vat);
        when 'D' then b := b || jsonb_build_object('45', (b->>'45')::numeric + r.net, '46', (b->>'46')::numeric + r.vat);
        else b := b || jsonb_build_object('31', (b->>'31')::numeric + r.net);
      end case;
    end loop;
  end if;

  select * into prev from public.acc_vat_returns where client_id = c.id and month = (v_from - interval '1 month')::date;
  select * into sv from public.acc_vat_returns where client_id = c.id and month = v_from;
  return jsonb_build_object(
    'month', v_from, 'kasa', v_kasa,
    'client', jsonb_build_object('name', c.name, 'nui', c.nui, 'fiscal_number', c.fiscal_number, 'vat_number', c.vat_number,
                                 'address', concat_ws(', ', c.address, c.city), 'phone', c.phone, 'vat_registered', c.vat_registered),
    'computed', b,
    'carry_prev', coalesce((prev.boxes->>'71')::numeric, 0),
    'prev_status', prev.status,
    'saved', case when sv.client_id is null then null else jsonb_build_object(
               'manual', sv.manual, 'boxes', sv.boxes, 'status', sv.status, 'filed_at', sv.filed_at, 'reference', sv.reference,
               'paid_at', sv.paid_at, 'paid_amount', sv.paid_amount, 'note', sv.note, 'updated_at', sv.updated_at) end
  );
end $$;

-- Save (or file) the return of a month. The program computes the final boxes from the computed
-- ones and the accountant's manual additions; the period status follows the return.
create or replace function public.acc_save_vat_return(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_month date := date_trunc('month', (p->>'month')::date)::date;
  v_status text := coalesce(nullif(p->>'status', ''), 'draft');
begin
  if v_status not in ('draft', 'filed') then
    raise exception 'Statusi nuk njihet' using errcode = '22023';
  end if;
  insert into public.acc_vat_returns (client_id, month, computed, manual, boxes, status, filed_at, reference, paid_at, paid_amount, note, updated_by, updated_at)
  values (c.id, v_month, coalesce(p->'computed', '{}'::jsonb), coalesce(p->'manual', '{}'::jsonb), coalesce(p->'boxes', '{}'::jsonb), v_status,
          case when v_status = 'filed' then coalesce(nullif(p->>'filed_at', '')::date, public._local_date()) end,
          nullif(trim(coalesce(p->>'reference', '')), ''), nullif(p->>'paid_at', '')::date, nullif(p->>'paid_amount', '')::numeric,
          nullif(trim(coalesce(p->>'note', '')), ''), auth.uid(), now())
  on conflict (client_id, month) do update set
    computed = excluded.computed, manual = excluded.manual, boxes = excluded.boxes, status = excluded.status,
    filed_at = excluded.filed_at, reference = excluded.reference, paid_at = excluded.paid_at, paid_amount = excluded.paid_amount,
    note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  -- keep the month status of the books in step (0013 acc_periods)
  insert into public.acc_periods (client_id, month, vat_status, closed_at)
  values (c.id, v_month, case when v_status = 'filed' then 'filed' else 'open' end, case when v_status = 'filed' then now() end)
  on conflict (client_id, month) do update set vat_status = excluded.vat_status, closed_at = excluded.closed_at;
end $$;

-- ---------------------------------------------------------------------
-- Sales / purchase book for ATK (one row per document, box columns)
-- ---------------------------------------------------------------------
create or replace function public.acc_vat_book(p_client uuid, p_month date, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  if p_kind not in ('sale', 'purchase') then
    raise exception 'Zgjidh librin e shitjeve ose të blerjeve' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', d.doc_date, 'doc_no', d.doc_no, 'partner', coalesce(d.partner_name, ''),
      -- NUI / NF column: the number, or the ATK code (3 export, 2 service abroad, 6 reverse charge)
      'nui', case
               when d.kind = 'sale' and d.export then '3'
               when d.kind = 'sale' and d.vat_flag = 'service_abroad' then '2'
               when d.kind = 'purchase' and d.vat_flag = 'reverse_charge' then '6'
               else coalesce(d.partner_nui, (select p.fiscal_number from public.acc_partners p where p.id = d.partner_id), '')
             end,
      'vat_no', coalesce(d.partner_vat, ''),
      'doc_type', d.doc_type, 'vat_flag', d.vat_flag, 'asset', d.category = 'assets', 'export', d.export,
      'net_e', d.net_e, 'vat_e', d.vat_e, 'net_d', d.net_d, 'vat_d', d.vat_d, 'amt_c', d.amt_c, 'amt_a', d.amt_a, 'vat_nd', d.vat_nd, 'total', d.total
    ) order by d.doc_date, d.doc_no), '[]'::jsonb)
    from public.acc_documents d
    where d.client_id = c.id and d.kind = p_kind and d.doc_date between v_from and v_to
  );
end $$;

-- ---------------------------------------------------------------------
-- Other taxes: filings and payments
-- ---------------------------------------------------------------------
create or replace function public.acc_save_tax_filing(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid;
begin
  insert into public.acc_tax_filings (client_id, kind, period, amount, status, filed_at, paid_at, reference, note, created_by)
  values (c.id, p->>'kind', (p->>'period')::date, round(coalesce((p->>'amount')::numeric, 0), 2), coalesce(nullif(p->>'status', ''), 'filed'),
          nullif(p->>'filed_at', '')::date, nullif(p->>'paid_at', '')::date, nullif(trim(coalesce(p->>'reference', '')), ''),
          nullif(trim(coalesce(p->>'note', '')), ''), auth.uid())
  on conflict (client_id, kind, period) do update set
    amount = excluded.amount, status = excluded.status, filed_at = excluded.filed_at, paid_at = excluded.paid_at,
    reference = excluded.reference, note = excluded.note
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.acc_delete_tax_filing(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.acc_tax_filings f using public.acc_clients c
   where f.id = p_id and c.id = f.client_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Deklarata nuk u gjet' using errcode = 'P0002';
  end if;
end $$;

-- What the other taxes of a year are based on: rent paid (9% withholding), turnover and result
-- by quarter (income tax), the filings made.
create or replace function public.acc_tax_overview(p_client uuid, p_year int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_from date := make_date(p_year, 1, 1);
  v_to date := make_date(p_year, 12, 31);
begin
  return jsonb_build_object(
    'regime', c.tax_regime, 'vat_registered', c.vat_registered,
    'rent', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'gross', g, 'docs', n) order by m), '[]'::jsonb)
             from (select date_trunc('month', doc_date)::date as m, sum(abs(total)) as g, count(*) as n
                   from public.acc_documents where client_id = c.id and kind = 'purchase' and category = 'rent' and doc_date between v_from and v_to
                   group by 1) t),
    'quarters', (select jsonb_agg(jsonb_build_object(
                   'q', q,
                   'turnover', coalesce((select sum(net_e + net_d + amt_c + amt_a) from public.acc_documents
                                         where client_id = c.id and kind = 'sale' and extract(quarter from doc_date) = q and doc_date between v_from and v_to), 0),
                   'costs', coalesce((select sum(net_e + net_d + amt_c + amt_a + vat_nd) from public.acc_documents
                                      where client_id = c.id and kind = 'purchase' and category not in ('assets') and extract(quarter from doc_date) = q and doc_date between v_from and v_to), 0)
                 ) order by q) from generate_series(1, 4) q),
    'sales_12m', coalesce((select sum(net_e + net_d + amt_c + amt_a) from public.acc_documents
                           where client_id = c.id and kind = 'sale' and doc_date > public._local_date() - 365), 0),
    'filings', (select coalesce(jsonb_agg(to_jsonb(f) - 'client_id' order by f.period desc, f.kind), '[]'::jsonb)
                from public.acc_tax_filings f where f.client_id = c.id and f.period between v_from - 31 and v_to)
  );
end $$;

-- ---------------------------------------------------------------------
-- Deadline calendar of every client of the accountant
--   VAT (VAT-registered): 20th of the next month            – status from acc_vat_returns
--   Rent tax 9% (rent bought that month): 15th of the next month
--   Payroll / pension (WPK): 15th of the next month          – only once K4 adds payroll
--   Income tax, quarterly: 15th of the month after the quarter
--   Annual income tax return: 31 March of the next year
-- ---------------------------------------------------------------------
create or replace function public.acc_tax_calendar(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public._require_accountant();
begin
  if p_to - p_from > 400 then
    raise exception 'Periudha deri në 400 ditë' using errcode = '22023';
  end if;
  return (
    with months as (
      select generate_series(date_trunc('month', p_from - 45)::date, date_trunc('month', p_to)::date, interval '1 month')::date as m
    ), items as (
      -- VAT
      select c.id as client_id, c.name, 'vat' as kind, mo.m as period, (mo.m + interval '1 month')::date + 19 as due,
             coalesce(r.status, case when ap.vat_status = 'filed' then 'filed' end, 'open') as status, (r.boxes->>'72')::numeric as amount
      from public.acc_clients c cross join months mo
      left join public.acc_vat_returns r on r.client_id = c.id and r.month = mo.m
      left join public.acc_periods ap on ap.client_id = c.id and ap.month = mo.m
      where c.accountant_id = v_me and c.active and c.vat_registered
      union all
      -- rent tax: only months with rent invoices
      select c.id, c.name, 'rent', mo.m, (mo.m + interval '1 month')::date + 14,
             coalesce(f.status, 'open'), coalesce(f.amount, round(sum(abs(d.total)) * 0.09, 2))
      from public.acc_clients c cross join months mo
      join public.acc_documents d on d.client_id = c.id and d.kind = 'purchase' and d.category = 'rent' and date_trunc('month', d.doc_date) = mo.m
      left join public.acc_tax_filings f on f.client_id = c.id and f.kind = 'rent' and f.period = mo.m
      where c.accountant_id = v_me and c.active
      group by c.id, c.name, mo.m, f.status, f.amount
      union all
      -- quarterly income tax
      select c.id, c.name, 'income_q', mo.m, (mo.m + interval '3 month')::date + 14, coalesce(f.status, 'open'), f.amount
      from public.acc_clients c cross join months mo
      left join public.acc_tax_filings f on f.client_id = c.id and f.kind = 'income_q' and f.period = mo.m
      where c.accountant_id = v_me and c.active and extract(month from mo.m) in (1, 4, 7, 10)
      union all
      -- annual return
      select c.id, c.name, 'income_annual', make_date(y, 1, 1), make_date(y + 1, 3, 31), coalesce(f.status, 'open'), f.amount
      from public.acc_clients c cross join generate_series(extract(year from p_from)::int - 1, extract(year from p_to)::int) y
      left join public.acc_tax_filings f on f.client_id = c.id and f.kind = 'income_annual' and f.period = make_date(y, 1, 1)
      where c.accountant_id = v_me and c.active
    )
    select coalesce(jsonb_agg(jsonb_build_object('client_id', client_id, 'client', name, 'kind', kind, 'period', period, 'due', due,
                                                 'status', status, 'amount', amount) order by due, name, kind), '[]'::jsonb)
    from items where due between p_from and p_to
  );
end $$;

revoke execute on function public.acc_set_vat_flag(uuid, text), public.acc_set_tax_regime(uuid, text), public.acc_vat_form(uuid, date),
  public.acc_save_vat_return(jsonb), public.acc_vat_book(uuid, date, text), public.acc_save_tax_filing(jsonb), public.acc_delete_tax_filing(uuid),
  public.acc_tax_overview(uuid, int), public.acc_tax_calendar(date, date) from public, anon;
grant execute on function public.acc_set_vat_flag(uuid, text), public.acc_set_tax_regime(uuid, text), public.acc_vat_form(uuid, date),
  public.acc_save_vat_return(jsonb), public.acc_vat_book(uuid, date, text), public.acc_save_tax_filing(jsonb), public.acc_delete_tax_filing(uuid),
  public.acc_tax_overview(uuid, int), public.acc_tax_calendar(date, date) to authenticated;
