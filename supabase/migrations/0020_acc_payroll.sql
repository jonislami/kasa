-- =====================================================================
-- 0020 – Kasa Kontabilist, phase K4: employees, leaves, payroll, payslips, WPK, postings.
--
-- Kosovo rules (Law 08/L-142 on personal income tax, in force since 23.08.2024):
--   * pension contribution (Trusti): employee 5% and employer 5% of gross (more if agreed);
--   * monthly income tax on (gross − employee contribution), primary employer:
--       0% up to 250 €, 8% from 250 to 450 €, 10% above 450 €;
--   * secondary employer: 10% of (gross − employee contribution).
-- * acc_employees, acc_leaves (annual, sick, unpaid, other), acc_payroll_runs / acc_payroll_lines.
-- * Unpaid leave reduces the gross pro rata to the working days of the month.
-- * A confirmed payroll is posted: Dr 6200 gross, Dr 6210 employer contribution /
--   Cr 3400 net, Cr 3500 contributions, Cr 3700 tax withheld (and Cr 1400 advances given).
--   Once a client uses payroll, wage / contribution payments from the bank settle 3400 / 3500.
-- * The payroll declaration (WPK) is due on the 15th of the next month (calendar).
-- Older clients keep working: nothing the live app uses changes shape.
-- =====================================================================

create table if not exists public.acc_employees (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.acc_clients (id) on delete cascade,
  first_name      text not null,
  last_name       text not null,
  personal_no     text check (personal_no is null or personal_no ~ '^[0-9]{10}$'),
  position        text,
  start_date      date not null,
  end_date        date,
  contract        text not null default 'indefinite' check (contract in ('indefinite', 'fixed', 'part_time', 'service')),
  primary_job     boolean not null default true,
  gross_salary    numeric(14, 2) not null check (gross_salary >= 0),
  emp_pension_pct numeric(5, 2) not null default 5 check (emp_pension_pct between 0 and 15),
  er_pension_pct  numeric(5, 2) not null default 5 check (er_pension_pct between 0 and 15),
  iban            text,
  email           text,
  phone           text,
  note            text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists acc_employees_client_idx on public.acc_employees (client_id);

create table if not exists public.acc_leaves (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.acc_clients (id) on delete cascade,
  employee_id uuid not null references public.acc_employees (id) on delete cascade,
  kind        text not null check (kind in ('annual', 'sick', 'unpaid', 'maternity', 'other')),
  from_date   date not null,
  to_date     date not null check (to_date >= from_date),
  days        numeric(5, 1) not null check (days > 0),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists acc_leaves_employee_idx on public.acc_leaves (employee_id, from_date);

create table if not exists public.acc_payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.acc_clients (id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  working_days int not null default 22 check (working_days between 1 and 31),
  status       text not null default 'draft' check (status in ('draft', 'confirmed', 'filed')),
  filed_at     date,
  reference    text,
  paid_at      date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, month)
);

create table if not exists public.acc_payroll_lines (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.acc_payroll_runs (id) on delete cascade,
  employee_id   uuid not null references public.acc_employees (id) on delete restrict,
  name          text not null,
  personal_no   text,
  primary_job   boolean not null,
  base_salary   numeric(14, 2) not null,
  unpaid_days   numeric(5, 1) not null default 0,
  bonus         numeric(14, 2) not null default 0,
  advance       numeric(14, 2) not null default 0,
  gross         numeric(14, 2) not null,
  emp_pct       numeric(5, 2) not null,
  er_pct        numeric(5, 2) not null,
  emp_contrib   numeric(14, 2) not null,
  er_contrib    numeric(14, 2) not null,
  tax_base      numeric(14, 2) not null,
  tax           numeric(14, 2) not null,
  net           numeric(14, 2) not null,
  payable       numeric(14, 2) not null,
  unique (run_id, employee_id)
);

alter table public.acc_employees     enable row level security;
alter table public.acc_leaves        enable row level security;
alter table public.acc_payroll_runs  enable row level security;
alter table public.acc_payroll_lines enable row level security;
drop policy if exists acc_employees_own on public.acc_employees;
create policy acc_employees_own on public.acc_employees for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_leaves_own on public.acc_leaves;
create policy acc_leaves_own on public.acc_leaves for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_payroll_runs_own on public.acc_payroll_runs;
create policy acc_payroll_runs_own on public.acc_payroll_runs for select to authenticated
  using (exists (select 1 from public.acc_clients c where c.id = client_id and c.accountant_id = auth.uid()) and public.is_accountant());
drop policy if exists acc_payroll_lines_own on public.acc_payroll_lines;
create policy acc_payroll_lines_own on public.acc_payroll_lines for select to authenticated
  using (exists (select 1 from public.acc_payroll_runs r join public.acc_clients c on c.id = r.client_id where r.id = run_id and c.accountant_id = auth.uid()) and public.is_accountant());
revoke all on public.acc_employees, public.acc_leaves, public.acc_payroll_runs, public.acc_payroll_lines from anon, authenticated;
grant select on public.acc_employees, public.acc_leaves, public.acc_payroll_runs, public.acc_payroll_lines to authenticated;

-- ---------------------------------------------------------------------
-- The calculation of one salary
-- ---------------------------------------------------------------------
create or replace function public.acc_wage_tax(p_base numeric, p_primary boolean)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_primary
              then round(greatest(least(p_base, 450) - 250, 0) * 0.08 + greatest(p_base - 450, 0) * 0.10, 2)
              else round(greatest(p_base, 0) * 0.10, 2) end
$$;

-- Fills the calculated columns of a payroll line from its inputs.
create or replace function public._acc_payroll_line_calc()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_days int;
begin
  select working_days into v_days from public.acc_payroll_runs where id = new.run_id;
  new.gross := round(new.base_salary * greatest(0, 1 - new.unpaid_days / greatest(v_days, 1)), 2) + new.bonus;
  new.emp_contrib := round(new.gross * new.emp_pct / 100, 2);
  new.er_contrib := round(new.gross * new.er_pct / 100, 2);
  new.tax_base := new.gross - new.emp_contrib;
  new.tax := public.acc_wage_tax(new.tax_base, new.primary_job);
  new.net := new.gross - new.emp_contrib - new.tax;
  new.payable := new.net - new.advance;
  return new;
end $$;
drop trigger if exists acc_payroll_line_calc on public.acc_payroll_lines;
create trigger acc_payroll_line_calc before insert or update on public.acc_payroll_lines
  for each row execute function public._acc_payroll_line_calc();

-- A payroll that is confirmed / filed does not change.
create or replace function public._acc_payroll_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.acc_payroll_runs where id = coalesce(new.run_id, old.run_id) and status <> 'draft') then
    raise exception 'Lista e pagave është konfirmuar; hape për ta ndryshuar' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists acc_payroll_lines_guard on public.acc_payroll_lines;
create trigger acc_payroll_lines_guard before insert or update or delete on public.acc_payroll_lines
  for each row execute function public._acc_payroll_guard();

-- ---------------------------------------------------------------------
-- Employees and leaves
-- ---------------------------------------------------------------------
create or replace function public.acc_save_employee(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_pno text := nullif(regexp_replace(coalesce(p->>'personal_no', ''), '\s', '', 'g'), '');
begin
  if trim(coalesce(p->>'first_name', '')) = '' or trim(coalesce(p->>'last_name', '')) = '' then
    raise exception 'Shkruaj emrin dhe mbiemrin' using errcode = '22023';
  end if;
  if v_pno is not null and v_pno !~ '^[0-9]{10}$' then
    raise exception 'Numri personal ka 10 shifra' using errcode = '22023';
  end if;
  if v_pno is not null and exists (select 1 from public.acc_employees where client_id = c.id and personal_no = v_pno and id is distinct from v_id) then
    raise exception 'Një punëtor tjetër i kësaj kompanie e ka këtë numër personal' using errcode = '23505';
  end if;
  if v_id is null then
    insert into public.acc_employees (client_id, first_name, last_name, personal_no, position, start_date, end_date, contract, primary_job,
                                      gross_salary, emp_pension_pct, er_pension_pct, iban, email, phone, note)
    values (c.id, left(trim(p->>'first_name'), 60), left(trim(p->>'last_name'), 60), v_pno, nullif(trim(coalesce(p->>'position', '')), ''),
            (p->>'start_date')::date, nullif(p->>'end_date', '')::date, coalesce(nullif(p->>'contract', ''), 'indefinite'),
            coalesce((p->>'primary_job')::boolean, true), round(coalesce((p->>'gross_salary')::numeric, 0), 2),
            coalesce((p->>'emp_pension_pct')::numeric, 5), coalesce((p->>'er_pension_pct')::numeric, 5),
            nullif(upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g')), ''), nullif(trim(coalesce(p->>'email', '')), ''),
            nullif(trim(coalesce(p->>'phone', '')), ''), nullif(trim(coalesce(p->>'note', '')), ''))
    returning id into v_id;
  else
    update public.acc_employees set
      first_name = left(trim(p->>'first_name'), 60), last_name = left(trim(p->>'last_name'), 60), personal_no = v_pno,
      position = nullif(trim(coalesce(p->>'position', '')), ''), start_date = (p->>'start_date')::date, end_date = nullif(p->>'end_date', '')::date,
      contract = coalesce(nullif(p->>'contract', ''), contract), primary_job = coalesce((p->>'primary_job')::boolean, primary_job),
      gross_salary = round(coalesce((p->>'gross_salary')::numeric, gross_salary), 2),
      emp_pension_pct = coalesce((p->>'emp_pension_pct')::numeric, emp_pension_pct), er_pension_pct = coalesce((p->>'er_pension_pct')::numeric, er_pension_pct),
      iban = nullif(upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g')), ''), email = nullif(trim(coalesce(p->>'email', '')), ''),
      phone = nullif(trim(coalesce(p->>'phone', '')), ''), note = nullif(trim(coalesce(p->>'note', '')), ''),
      active = coalesce((p->>'active')::boolean, active)
    where id = v_id and client_id = c.id;
    if not found then
      raise exception 'Punëtori nuk u gjet' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.acc_employees_list(p_client uuid, p_year int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_year int := coalesce(p_year, extract(year from public._local_date())::int);
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(e) - 'client_id' || jsonb_build_object(
             'leave_days', (select coalesce(jsonb_object_agg(kind, d), '{}'::jsonb) from (
                              select kind, sum(days) as d from public.acc_leaves l
                              where l.employee_id = e.id and extract(year from l.from_date) = v_year group by kind) t),
             'leaves', (select coalesce(jsonb_agg(to_jsonb(l) - 'client_id' order by l.from_date desc), '[]'::jsonb)
                        from public.acc_leaves l where l.employee_id = e.id and extract(year from l.from_date) = v_year))
           order by e.active desc, e.last_name, e.first_name), '[]'::jsonb)
    from public.acc_employees e where e.client_id = c.id
  );
end $$;

create or replace function public.acc_save_leave(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.acc_employees;
  v_id uuid;
begin
  select em.* into e from public.acc_employees em join public.acc_clients c on c.id = em.client_id
   where em.id = (p->>'employee_id')::uuid and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Punëtori nuk u gjet' using errcode = 'P0002';
  end if;
  insert into public.acc_leaves (client_id, employee_id, kind, from_date, to_date, days, note)
  values (e.client_id, e.id, p->>'kind', (p->>'from_date')::date, (p->>'to_date')::date, (p->>'days')::numeric, nullif(trim(coalesce(p->>'note', '')), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.acc_delete_leave(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.acc_leaves l using public.acc_clients c
   where l.id = p_id and c.id = l.client_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Mungesa nuk u gjet' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------
-- Creates the month's payroll (or refreshes a draft): one line per employee working that month,
-- unpaid leave days of the month taken over, bonuses / advances already entered kept.
create or replace function public.acc_payroll_prepare(p_client uuid, p_month date, p_working_days int default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  r public.acc_payroll_runs;
begin
  select * into r from public.acc_payroll_runs where client_id = c.id and month = v_month;
  if found and r.status <> 'draft' then
    raise exception 'Lista e pagave e këtij muaji është konfirmuar' using errcode = '42501';
  end if;
  if not found then
    insert into public.acc_payroll_runs (client_id, month, working_days)
    values (c.id, v_month, coalesce(p_working_days, (select count(*) from generate_series(v_month, v_end, interval '1 day') d where extract(isodow from d) < 6)::int))
    returning * into r;
  elsif p_working_days is not null then
    update public.acc_payroll_runs set working_days = p_working_days, updated_at = now() where id = r.id returning * into r;
  end if;

  -- employees who left / are no longer active
  delete from public.acc_payroll_lines l using public.acc_employees e
   where l.run_id = r.id and e.id = l.employee_id and (not e.active or e.start_date > v_end or (e.end_date is not null and e.end_date < v_month));

  insert into public.acc_payroll_lines (run_id, employee_id, name, personal_no, primary_job, base_salary, unpaid_days, emp_pct, er_pct,
                                        gross, emp_contrib, er_contrib, tax_base, tax, net, payable)
  select r.id, e.id, e.first_name || ' ' || e.last_name, e.personal_no, e.primary_job, e.gross_salary,
         coalesce((select sum(l.days) from public.acc_leaves l where l.employee_id = e.id and l.kind = 'unpaid' and l.from_date between v_month and v_end), 0),
         e.emp_pension_pct, e.er_pension_pct, 0, 0, 0, 0, 0, 0, 0
  from public.acc_employees e
  where e.client_id = c.id and e.active and e.start_date <= v_end and (e.end_date is null or e.end_date >= v_month)
  on conflict (run_id, employee_id) do update set
    name = excluded.name, personal_no = excluded.personal_no, primary_job = excluded.primary_job, base_salary = excluded.base_salary,
    unpaid_days = excluded.unpaid_days, emp_pct = excluded.emp_pct, er_pct = excluded.er_pct;
  return r.id;
end $$;

create or replace function public.acc_payroll_update_line(p_line uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.acc_payroll_lines l set
    bonus = round(coalesce((p->>'bonus')::numeric, l.bonus), 2),
    advance = round(coalesce((p->>'advance')::numeric, l.advance), 2),
    unpaid_days = coalesce((p->>'unpaid_days')::numeric, l.unpaid_days),
    base_salary = round(coalesce((p->>'base_salary')::numeric, l.base_salary), 2)
  from public.acc_payroll_runs r join public.acc_clients c on c.id = r.client_id
  where l.id = p_line and r.id = l.run_id and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Rreshti nuk u gjet' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.acc_payroll_set_status(p_run uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.acc_payroll_runs;
  v_status text := p->>'status';
begin
  select pr.* into r from public.acc_payroll_runs pr join public.acc_clients c on c.id = pr.client_id
   where pr.id = p_run and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Lista e pagave nuk u gjet' using errcode = 'P0002';
  end if;
  if v_status not in ('draft', 'confirmed', 'filed') then
    raise exception 'Statusi nuk njihet' using errcode = '22023';
  end if;
  if v_status <> 'draft' and not exists (select 1 from public.acc_payroll_lines where run_id = r.id) then
    raise exception 'Lista e pagave nuk ka punëtorë' using errcode = '22023';
  end if;
  if public._acc_month_locked(r.client_id, r.month) then
    raise exception 'Muaji është i mbyllur' using errcode = '42501';
  end if;
  update public.acc_payroll_runs set status = v_status,
         filed_at = case when v_status = 'filed' then coalesce(nullif(p->>'filed_at', '')::date, public._local_date()) else null end,
         reference = case when v_status = 'filed' then nullif(trim(coalesce(p->>'reference', '')), '') else reference end,
         paid_at = coalesce(nullif(p->>'paid_at', '')::date, paid_at), updated_at = now()
   where id = r.id;
end $$;

create or replace function public.acc_payroll(p_client uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  r public.acc_payroll_runs;
begin
  select * into r from public.acc_payroll_runs where client_id = c.id and month = date_trunc('month', p_month)::date;
  if not found then
    return null;
  end if;
  return to_jsonb(r) - 'client_id' || jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(to_jsonb(l) - 'run_id' || jsonb_build_object('iban', e.iban, 'position', e.position) order by l.name), '[]'::jsonb)
              from public.acc_payroll_lines l join public.acc_employees e on e.id = l.employee_id where l.run_id = r.id));
end $$;

create or replace function public.acc_payroll_year(p_client uuid, p_year int)
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
    select coalesce(jsonb_agg(jsonb_build_object('month', r.month, 'status', r.status, 'filed_at', r.filed_at, 'employees', count(l.id),
                                                 'gross', sum(l.gross), 'tax', sum(l.tax), 'contrib', sum(l.emp_contrib + l.er_contrib), 'net', sum(l.net))
                              order by r.month), '[]'::jsonb)
    from public.acc_payroll_runs r left join public.acc_payroll_lines l on l.run_id = r.id
    where r.client_id = c.id and extract(year from r.month) = p_year
    group by r.id
  );
end $$;


-- ---------------------------------------------------------------------
-- Postings and calendar extended with payroll (replaces the 0019 / 0018 versions)
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
    select t.tx_date, 'tx', t.id, t.reference, coalesce(t.description, t.category),
           case when t.category = 'wages' and exists (select 1 from public.acc_payroll_runs pr where pr.client_id = p_client and pr.status <> 'draft') then '3400'
                when t.category = 'contributions' and exists (select 1 from public.acc_payroll_runs pr where pr.client_id = p_client and pr.status <> 'draft') then '3500'
                else public._acc_tx_account(t.category, t.amount) end,
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
    -- confirmed payroll: Dr 6200 gross, Dr 6210 employer contribution / Cr 3400 net, 3500 contributions, 3700 tax
    select (p.month + interval '1 month - 1 day')::date, 'payroll', p.id, to_char(p.month, 'MM.YYYY'), 'Pagat · ' || to_char(p.month, 'MM.YYYY'), x.account, x.dr, x.cr, null
    from public.acc_payroll_runs p
    cross join lateral (select sum(gross) as g, sum(er_contrib) as er, sum(emp_contrib) as emp, sum(tax) as tax, sum(net) as net from public.acc_payroll_lines where run_id = p.id) s
    cross join lateral (values ('6200', s.g, 0::numeric), ('6210', s.er, 0::numeric), ('3400', 0::numeric, s.net), ('3500', 0::numeric, s.emp + s.er), ('3700', 0::numeric, s.tax)) as x(account, dr, cr)
    where p.client_id = p_client and p.status <> 'draft' and (p.month + interval '1 month - 1 day')::date between p_from and p_to
    union all
    -- manual entries
    select e.entry_date, 'journal', e.id, 'R-' || e.entry_no, coalesce(l.memo, e.description), l.account, l.debit, l.credit,
           (select p.name from public.acc_partners p where p.id = l.partner_id)
    from public.acc_journal_entries e join public.acc_journal_lines l on l.entry_id = e.id
    where e.client_id = p_client and e.entry_date between p_from and p_to
  )
  select * from lines where debit <> 0 or credit <> 0
$$;


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
      -- payroll declaration (WPK): months with a payroll
      select c.id, c.name, 'payroll', p.month, (p.month + interval '1 month')::date + 14,
             case p.status when 'filed' then 'filed' else 'open' end,
             (select sum(l.tax + l.emp_contrib + l.er_contrib) from public.acc_payroll_lines l where l.run_id = p.id)
      from public.acc_clients c join public.acc_payroll_runs p on p.client_id = c.id
      where c.accountant_id = v_me and c.active
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


revoke execute on function public._acc_payroll_line_calc(), public._acc_payroll_guard() from public, anon, authenticated;
revoke execute on function public.acc_save_employee(jsonb), public.acc_employees_list(uuid, int), public.acc_save_leave(jsonb), public.acc_delete_leave(uuid),
  public.acc_payroll_prepare(uuid, date, int), public.acc_payroll_update_line(uuid, jsonb), public.acc_payroll_set_status(uuid, jsonb),
  public.acc_payroll(uuid, date), public.acc_payroll_year(uuid, int) from public, anon;
grant execute on function public.acc_wage_tax(numeric, boolean), public.acc_save_employee(jsonb), public.acc_employees_list(uuid, int), public.acc_save_leave(jsonb),
  public.acc_delete_leave(uuid), public.acc_payroll_prepare(uuid, date, int), public.acc_payroll_update_line(uuid, jsonb), public.acc_payroll_set_status(uuid, jsonb),
  public.acc_payroll(uuid, date), public.acc_payroll_year(uuid, int) to authenticated;
