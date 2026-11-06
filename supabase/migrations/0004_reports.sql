-- =====================================================================
-- 0004 – Panel & reports (phase 5): sales summary for a period, daily/monthly series,
-- work per worker (with shifts = clock in/out), workers comparison. Run after 0001–0003.
--
-- Security:
--   * report_summary / sales_series / workers_comparison: admin/manager only
--   * work_summary: managers for any worker; a worker only for themself and only for today
--   * no purchase prices or profit ever reach a worker
--   * shifts change only through RPCs; closed shifts are immutable
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shifts (clock in / out)
-- ---------------------------------------------------------------------
create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null default public.current_business_id()
                references public.businesses (id) on delete cascade,
  worker_id     uuid not null references auth.users (id),
  register_id   uuid references public.registers (id) on delete set null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  opening_cash  numeric(12, 2) not null default 0,
  closing_cash  numeric(12, 2),
  note          text,
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists shifts_business_idx on public.shifts (business_id, started_at desc);
create index if not exists shifts_worker_idx on public.shifts (worker_id, started_at desc);
create unique index if not exists shifts_one_open_uq on public.shifts (worker_id) where ended_at is null;

create or replace function public.shifts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.ended_at is not null then
    raise exception 'Ndërrimi i mbyllur nuk ndryshohet' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists shifts_guard on public.shifts;
create trigger shifts_guard before update or delete on public.shifts
  for each row execute function public.shifts_guard();

alter table public.shifts enable row level security;
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts for select to authenticated
  using (business_id = public.current_business_id() and (public.is_manager() or worker_id = auth.uid()));
revoke insert, update, delete on public.shifts from anon, authenticated;
revoke all on public.shifts from anon;

-- p: { opening_cash?, register_id? } → the open shift
create or replace function public.start_shift(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_shift public.shifts%rowtype;
  v_register uuid := nullif(p->>'register_id', '')::uuid;
begin
  if v_business is null or auth.uid() is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  select * into v_shift from public.shifts where worker_id = auth.uid() and ended_at is null;
  if found then
    return to_jsonb(v_shift);
  end if;
  if v_register is not null and not exists (select 1 from public.registers where id = v_register and business_id = v_business) then
    v_register := null;
  end if;
  insert into public.shifts (business_id, worker_id, register_id, opening_cash)
  values (v_business, auth.uid(), v_register, greatest(round(coalesce((p->>'opening_cash')::numeric, 0), 2), 0))
  returning * into v_shift;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'shift_start', 'shift', v_shift.id::text, jsonb_build_object('opening_cash', v_shift.opening_cash));
  return to_jsonb(v_shift);
end $$;

-- p: { closing_cash?, note? } → the closed shift (null if none was open)
create or replace function public.end_shift(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_shift public.shifts%rowtype;
begin
  if v_business is null or auth.uid() is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  update public.shifts set
    ended_at = now(),
    closing_cash = case when p ? 'closing_cash' then round((p->>'closing_cash')::numeric, 2) end,
    note = nullif(trim(coalesce(p->>'note', '')), '')
  where worker_id = auth.uid() and ended_at is null and business_id = v_business
  returning * into v_shift;
  if not found then
    return null;
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'shift_end', 'shift', v_shift.id::text, jsonb_build_object(
    'minutes', round(extract(epoch from v_shift.ended_at - v_shift.started_at) / 60),
    'closing_cash', v_shift.closing_cash));
  return to_jsonb(v_shift);
end $$;

create or replace function public.my_open_shift()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(s) from public.shifts s
  where s.worker_id = auth.uid() and s.ended_at is null and s.business_id = public.current_business_id()
$$;

-- Minutes worked by a worker between two instants (open shift counts until now).
create or replace function public._shift_minutes(p_business uuid, p_worker uuid, p_from timestamptz, p_to timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(round(sum(extract(epoch from least(coalesce(s.ended_at, now()), p_to) - greatest(s.started_at, p_from)) / 60)), 0)
  from public.shifts s
  where s.business_id = p_business and s.worker_id = p_worker
    and s.started_at < p_to and coalesce(s.ended_at, now()) > p_from
$$;
revoke execute on function public._shift_minutes(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Local day boundaries (Kosovo) as instants.
create or replace function public._day_start(p_date date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (p_date::timestamp at time zone 'Europe/Belgrade')
$$;

-- ---------------------------------------------------------------------
-- report_summary(from, to): everything the Reports page and the Panel need.
-- Dates are local (Kosovo) and inclusive.
-- ---------------------------------------------------------------------
create or replace function public.report_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_days int;
  v_prev_from date;
  v_prev_to date;
  v_totals jsonb;
  v_prev jsonb;
  v_vat jsonb;
  v_top jsonb;
  v_workers jsonb;
  v_daily jsonb;
  v_hours jsonb;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Periudha nuk është e saktë (deri në 400 ditë)' using errcode = '22023';
  end if;
  v_days := p_to - p_from + 1;
  v_prev_to := p_from - 1;
  v_prev_from := p_from - v_days;

  -- Totals (sales minus voids/refunds) + profit from the costs stored at sale time.
  with s as (
    select * from public.sales where business_id = v_business and sale_date between p_from and p_to
  ), cost as (
    select coalesce(sum(i.quantity * coalesce(c.purchase_price, 0)), 0) as cost
    from public.sale_items i
    join s on s.id = i.sale_id
    left join public.sale_item_costs c on c.sale_item_id = i.id
  )
  select jsonb_build_object(
    'total', coalesce(sum(s.total), 0),
    'net_total', coalesce(sum(s.net_total), 0),
    'vat_total', coalesce(sum(s.vat_total), 0),
    'invoices', count(*) filter (where s.kind = 'sale'),
    'voids', count(*) filter (where s.kind = 'void'),
    'void_total', coalesce(sum(s.total) filter (where s.kind = 'void'), 0),
    'refunds', count(*) filter (where s.kind = 'refund'),
    'refund_total', coalesce(sum(s.total) filter (where s.kind = 'refund'), 0),
    'cash', coalesce(sum(s.cash_amount), 0),
    'card', coalesce(sum(s.card_amount), 0),
    'discounts', coalesce(sum(s.discount_total), 0),
    'cost', round((select cost from cost), 2),
    'profit', round(coalesce(sum(s.total), 0) - (select cost from cost), 2),
    'offline', count(*) filter (where s.offline)
  ) into v_totals from s;

  select jsonb_build_object(
    'total', coalesce(sum(total), 0),
    'invoices', count(*) filter (where kind = 'sale')
  ) into v_prev
  from public.sales where business_id = v_business and sale_date between v_prev_from and v_prev_to;

  -- VAT per rate, as on the invoices (VAT once per rate per document).
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'gross', gross, 'net', net, 'vat', vat) order by code), '[]'::jsonb)
  into v_vat
  from (
    select l->>'code' as code, sum((l->>'gross')::numeric) as gross, sum((l->>'net')::numeric) as net, sum((l->>'vat')::numeric) as vat
    from public.sales s, jsonb_array_elements(s.vat_lines) l
    where s.business_id = v_business and s.sale_date between p_from and p_to
    group by l->>'code'
  ) t;

  -- Best sellers (net of refunds/voids).
  select coalesce(jsonb_agg(t order by t.quantity desc), '[]'::jsonb) into v_top
  from (
    select coalesce(i.product_id::text, i.name) as key, max(i.name) as name, max(i.unit) as unit,
           sum(i.quantity) as quantity, sum(i.total) as total,
           round(sum(i.total) - sum(i.quantity * coalesce(c.purchase_price, 0)), 2) as profit
    from public.sale_items i
    join public.sales s on s.id = i.sale_id
    left join public.sale_item_costs c on c.sale_item_id = i.id
    where s.business_id = v_business and s.sale_date between p_from and p_to
    group by coalesce(i.product_id::text, i.name)
    having sum(i.quantity) > 0
    order by sum(i.quantity) desc
    limit 10
  ) t;

  -- Per worker.
  select coalesce(jsonb_agg(t order by t.total desc), '[]'::jsonb) into v_workers
  from (
    select s.worker_id, coalesce(nullif(p.full_name, ''), p.email, '—') as name, p.role,
           count(*) filter (where s.kind = 'sale') as invoices,
           coalesce(sum(s.total), 0) as total,
           coalesce(sum(s.cash_amount), 0) as cash,
           coalesce(sum(s.card_amount), 0) as card,
           count(*) filter (where s.kind = 'void') as voids,
           count(*) filter (where s.kind = 'refund') as refunds
    from public.sales s
    left join public.profiles p on p.id = s.worker_id
    where s.business_id = v_business and s.sale_date between p_from and p_to
    group by s.worker_id, p.full_name, p.email, p.role
  ) t;

  -- Daily series inside the period.
  select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'total', coalesce(x.total, 0), 'invoices', coalesce(x.invoices, 0)) order by d), '[]'::jsonb)
  into v_daily
  from generate_series(p_from, p_to, interval '1 day') d
  left join (
    select sale_date, sum(total) as total, count(*) filter (where kind = 'sale') as invoices
    from public.sales where business_id = v_business and sale_date between p_from and p_to
    group by sale_date
  ) x on x.sale_date = d::date;

  -- Sales by hour (local) – busiest hours.
  select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'total', total, 'invoices', invoices) order by h), '[]'::jsonb)
  into v_hours
  from (
    select extract(hour from (created_at at time zone 'Europe/Belgrade'))::int as h,
           sum(total) as total, count(*) filter (where kind = 'sale') as invoices
    from public.sales where business_id = v_business and sale_date between p_from and p_to
    group by 1
  ) t;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to,
    'totals', v_totals, 'prev', v_prev, 'vat', v_vat, 'top', v_top,
    'workers', v_workers, 'daily', v_daily, 'hours', v_hours
  );
end $$;

-- ---------------------------------------------------------------------
-- sales_series(from, to, bucket 'day' | 'month') – chart on the Panel.
-- ---------------------------------------------------------------------
create or replace function public.sales_series(p_from date, p_to date, p_bucket text default 'day')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_out jsonb;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 800 then
    raise exception 'Periudha nuk është e saktë' using errcode = '22023';
  end if;
  if p_bucket = 'month' then
    select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'total', coalesce(x.total, 0), 'invoices', coalesce(x.invoices, 0)) order by d), '[]'::jsonb)
    into v_out
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') d
    left join (
      select date_trunc('month', sale_date) as m, sum(total) as total, count(*) filter (where kind = 'sale') as invoices
      from public.sales where business_id = v_business and sale_date between p_from and p_to
      group by 1
    ) x on x.m = d;
  else
    select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'total', coalesce(x.total, 0), 'invoices', coalesce(x.invoices, 0)) order by d), '[]'::jsonb)
    into v_out
    from generate_series(p_from, p_to, interval '1 day') d
    left join (
      select sale_date, sum(total) as total, count(*) filter (where kind = 'sale') as invoices
      from public.sales where business_id = v_business and sale_date between p_from and p_to
      group by sale_date
    ) x on x.sale_date = d::date;
  end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- work_summary(worker, from, to): the work of one worker.
--   managers: any worker of the business, any period
--   workers:  only themself, only today (p_from/p_to are ignored)
-- ---------------------------------------------------------------------
create or replace function public.work_summary(p_worker uuid default null, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_manager boolean := public.is_manager();
  v_worker uuid := coalesce(p_worker, auth.uid());
  v_from date := coalesce(p_from, public._local_date());
  v_to date := coalesce(p_to, public._local_date());
  v_profile public.profiles%rowtype;
  v_totals jsonb;
  v_events jsonb;
  v_minutes numeric;
  v_shifts int;
  v_first timestamptz;
begin
  if v_business is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  if not v_manager then
    if v_worker <> auth.uid() then
      raise exception 'Mund të shohësh vetëm punën tënde' using errcode = '42501';
    end if;
    v_from := public._local_date();
    v_to := v_from;
  end if;
  if v_to < v_from or v_to - v_from > 400 then
    raise exception 'Periudha nuk është e saktë' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles where id = v_worker and business_id = v_business;
  if not found then
    raise exception 'Punëtori nuk u gjet' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'invoices', count(*) filter (where kind = 'sale'),
    'total', coalesce(sum(total), 0),
    'cash', coalesce(sum(cash_amount), 0),
    'card', coalesce(sum(card_amount), 0),
    'voids', count(*) filter (where kind = 'void'),
    'void_total', coalesce(sum(total) filter (where kind = 'void'), 0),
    'refunds', count(*) filter (where kind = 'refund'),
    'refund_total', coalesce(sum(total) filter (where kind = 'refund'), 0),
    'offline', count(*) filter (where offline),
    'items', coalesce(sum(items_count) filter (where kind = 'sale'), 0)
  ) into v_totals
  from public.sales where business_id = v_business and worker_id = v_worker and sale_date between v_from and v_to;

  v_minutes := public._shift_minutes(v_business, v_worker, public._day_start(v_from), public._day_start(v_to + 1));
  select count(*), min(started_at) into v_shifts, v_first from public.shifts
    where business_id = v_business and worker_id = v_worker
      and started_at < public._day_start(v_to + 1) and coalesce(ended_at, now()) > public._day_start(v_from);

  -- Timeline: documents + shift start/end (most recent first, last 200).
  select coalesce(jsonb_agg(e order by e.at desc), '[]'::jsonb) into v_events
  from (
    select * from (
      select s.created_at as at, s.kind as type, s.invoice_no, s.total, s.payment_method, s.items_count,
             s.offline, s.reason, o.invoice_no as ref_invoice_no,
             coalesce(nullif(a.full_name, ''), a.email) as approved_by, s.id::text as sale_id
      from public.sales s
      left join public.sales o on o.id = s.ref_sale_id
      left join public.profiles a on a.id = s.approved_by
      where s.business_id = v_business and s.worker_id = v_worker and s.sale_date between v_from and v_to
      union all
      select sh.started_at, 'shift_start', null, sh.opening_cash, null, null, false, null, null, null, sh.id::text
      from public.shifts sh
      where sh.business_id = v_business and sh.worker_id = v_worker
        and sh.started_at >= public._day_start(v_from) and sh.started_at < public._day_start(v_to + 1)
      union all
      select sh.ended_at, 'shift_end', null, sh.closing_cash, null, null, false, null, null, null, sh.id::text
      from public.shifts sh
      where sh.business_id = v_business and sh.worker_id = v_worker and sh.ended_at is not null
        and sh.ended_at >= public._day_start(v_from) and sh.ended_at < public._day_start(v_to + 1)
    ) u order by at desc limit 200
  ) e;

  return jsonb_build_object(
    'worker', jsonb_build_object('id', v_profile.id, 'name', coalesce(nullif(v_profile.full_name, ''), v_profile.email), 'role', v_profile.role,
                                 'commission_pct', v_profile.commission_pct),
    'from', v_from, 'to', v_to,
    'totals', v_totals,
    'commission', round(coalesce((v_totals->>'total')::numeric, 0) * v_profile.commission_pct / 100, 2),
    'minutes', v_minutes, 'shifts', v_shifts, 'first_start', v_first,
    'open_shift', (select to_jsonb(s) from public.shifts s where s.worker_id = v_worker and s.ended_at is null and s.business_id = v_business),
    'events', v_events
  );
end $$;

-- ---------------------------------------------------------------------
-- workers_comparison(from, to): one row per person of the business (managers only).
-- ---------------------------------------------------------------------
create or replace function public.workers_comparison(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_out jsonb;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Periudha nuk është e saktë' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(t order by t.total desc, t.name), '[]'::jsonb) into v_out
  from (
    select p.id as worker_id, coalesce(nullif(p.full_name, ''), p.email, '—') as name, p.role, p.active, p.commission_pct,
           coalesce(x.invoices, 0) as invoices, coalesce(x.total, 0) as total,
           coalesce(x.voids, 0) as voids, coalesce(x.refunds, 0) as refunds,
           round(coalesce(x.total, 0) * p.commission_pct / 100, 2) as commission,
           public._shift_minutes(v_business, p.id, public._day_start(p_from), public._day_start(p_to + 1)) as minutes
    from public.profiles p
    left join (
      select worker_id, count(*) filter (where kind = 'sale') as invoices, sum(total) as total,
             count(*) filter (where kind = 'void') as voids, count(*) filter (where kind = 'refund') as refunds
      from public.sales where business_id = v_business and sale_date between p_from and p_to
      group by worker_id
    ) x on x.worker_id = p.id
    where p.business_id = v_business and (p.active or x.worker_id is not null)
  ) t;
  return v_out;
end $$;

revoke execute on function public.start_shift(jsonb) from public, anon;
revoke execute on function public.end_shift(jsonb) from public, anon;
revoke execute on function public.my_open_shift() from public, anon;
revoke execute on function public.report_summary(date, date) from public, anon;
revoke execute on function public.sales_series(date, date, text) from public, anon;
revoke execute on function public.work_summary(uuid, date, date) from public, anon;
revoke execute on function public.workers_comparison(date, date) from public, anon;
grant execute on function public.start_shift(jsonb) to authenticated;
grant execute on function public.end_shift(jsonb) to authenticated;
grant execute on function public.my_open_shift() to authenticated;
grant execute on function public.report_summary(date, date) to authenticated;
grant execute on function public.sales_series(date, date, text) to authenticated;
grant execute on function public.work_summary(uuid, date, date) to authenticated;
grant execute on function public.workers_comparison(date, date) to authenticated;
