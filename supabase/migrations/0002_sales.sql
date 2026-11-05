-- =====================================================================
-- 0002 – Sales (phase 3): immutable sales, invoice + daily numbers, void and refund
-- documents that reference the original, manager PIN approval, idempotent client_id
-- for offline queues, stock movements for every sale/void/refund.
--
-- Document kinds map to ATK CouponType: sale → Sale, void → Cancel, refund → Return.
-- Prices include VAT. VAT is computed once per rate over the gross total of that rate.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.sales (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null default public.current_business_id()
                    references public.businesses (id) on delete cascade,
  register_id       uuid references public.registers (id) on delete set null,
  worker_id         uuid not null references auth.users (id),
  client_id         uuid not null,                 -- idempotency key from the device
  kind              text not null default 'sale' check (kind in ('sale', 'void', 'refund')),
  ref_sale_id       uuid references public.sales (id),
  invoice_no        bigint not null,               -- per business, #00487
  daily_no          int not null,
  sale_date         date not null,                 -- local date (Kosovo)
  items_count       numeric(14, 3) not null default 0,
  subtotal          numeric(12, 2) not null default 0,   -- after line discounts, before invoice discount
  invoice_discount  numeric(12, 2) not null default 0,
  discount_total    numeric(12, 2) not null default 0,   -- line + invoice discounts
  total             numeric(12, 2) not null default 0,   -- gross, VAT included (negative for void/refund)
  net_total         numeric(12, 2) not null default 0,
  vat_total         numeric(12, 2) not null default 0,
  vat_lines         jsonb not null default '[]'::jsonb,  -- [{code, rate, gross, net, vat}]
  payment_method    text not null check (payment_method in ('cash', 'card', 'mixed')),
  cash_amount       numeric(12, 2) not null default 0,
  card_amount       numeric(12, 2) not null default 0,
  tendered          numeric(12, 2),                -- cash given by the customer
  change_amount     numeric(12, 2) not null default 0,
  reason            text,
  note              text,
  approved_by       uuid references auth.users (id),
  restock           boolean,
  offline           boolean not null default false,
  offline_no        text,                          -- OFF-… shown on the offline receipt
  client_created_at timestamptz,
  fiscal_status     text not null default 'non_fiscal',
  created_at        timestamptz not null default now(),
  unique (business_id, client_id),
  unique (business_id, invoice_no)
);
create index if not exists sales_business_date_idx on public.sales (business_id, sale_date desc, invoice_no desc);
create index if not exists sales_worker_idx on public.sales (worker_id, sale_date desc);
create index if not exists sales_ref_idx on public.sales (ref_sale_id) where ref_sale_id is not null;

create table if not exists public.sale_items (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references public.sales (id) on delete cascade,
  business_id      uuid not null references public.businesses (id) on delete cascade,
  worker_id        uuid not null references auth.users (id),
  position         int not null,
  product_id       uuid references public.products (id) on delete set null,
  kind             text not null default 'product',
  name             text not null,
  unit             text not null,
  quantity         numeric(14, 3) not null,        -- negative for void/refund
  unit_price       numeric(12, 2) not null,        -- gross, VAT included
  line_discount    numeric(12, 2) not null default 0,
  invoice_discount numeric(12, 2) not null default 0,  -- share of the invoice discount
  total            numeric(12, 2) not null,        -- final gross of the line
  vat_code         char(1) not null,
  vat_rate         numeric(5, 4) not null,
  atk_type         text not null default 'TT',
  ref_item_id      uuid references public.sale_items (id)
);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id, position);
create index if not exists sale_items_ref_idx on public.sale_items (ref_item_id) where ref_item_id is not null;
create index if not exists sale_items_business_idx on public.sale_items (business_id);

-- Purchase price at the moment of sale (profit) – managers only.
create table if not exists public.sale_item_costs (
  sale_item_id   uuid primary key references public.sale_items (id) on delete cascade,
  business_id    uuid not null references public.businesses (id) on delete cascade,
  purchase_price numeric(12, 4) not null default 0
);

-- Immutable: clients have no UPDATE/DELETE grant at all. The trigger also stops everyone else,
-- except the sale RPCs below while they are still building a new document (transaction flag).
create or replace function public.sales_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and current_setting('kasa.building_sale', true) = 'on' then
    return new;
  end if;
  raise exception 'Shitjet nuk ndryshohen; përdor anulimin ose kthimin' using errcode = '42501';
end $$;

drop trigger if exists sales_immutable on public.sales;
create trigger sales_immutable before update or delete on public.sales
  for each row execute function public.sales_immutable();
drop trigger if exists sale_items_immutable on public.sale_items;
create trigger sale_items_immutable before update or delete on public.sale_items
  for each row execute function public.sales_immutable();
drop trigger if exists sale_item_costs_immutable on public.sale_item_costs;
create trigger sale_item_costs_immutable before update or delete on public.sale_item_costs
  for each row execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------
-- RLS: managers see the whole business, workers only their own documents.
-- ---------------------------------------------------------------------
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.sale_item_costs enable row level security;

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select to authenticated
  using (business_id = public.current_business_id() and (public.is_manager() or worker_id = auth.uid()));

drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items for select to authenticated
  using (business_id = public.current_business_id() and (public.is_manager() or worker_id = auth.uid()));

drop policy if exists sale_item_costs_select on public.sale_item_costs;
create policy sale_item_costs_select on public.sale_item_costs for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager());

revoke insert, update, delete on public.sales, public.sale_items, public.sale_item_costs from anon, authenticated;
revoke all on public.sales, public.sale_items, public.sale_item_costs from anon;

-- ---------------------------------------------------------------------
-- Helpers (internal – not callable by clients)
-- ---------------------------------------------------------------------
create or replace function public._vat_rate(p_code text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_code when 'E' then 0.18 when 'D' then 0.08 else 0 end::numeric
$$;

create or replace function public._local_date()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Belgrade')::date
$$;

-- Locks the business row and returns the next invoice number + daily number.
create or replace function public._next_numbers(p_business uuid, out invoice_no bigint, out daily_no int, out sale_date date)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.businesses set invoice_counter = invoice_counter + 1
    where id = p_business returning invoice_counter into invoice_no;
  sale_date := public._local_date();
  select coalesce(max(s.daily_no), 0) + 1 into daily_no
    from public.sales s where s.business_id = p_business and s.sale_date = _next_numbers.sale_date;
end $$;

-- Recomputes totals and VAT lines from the items (single source of truth).
create or replace function public._finalize_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_total numeric;
  v_net numeric;
begin
  with by_rate as (
    select vat_code, max(vat_rate) as rate, sum(total) as gross
    from public.sale_items where sale_id = p_sale_id group by vat_code
  ), calc as (
    select vat_code, rate, gross, round(gross / (1 + rate), 2) as net from by_rate
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('code', vat_code, 'rate', rate, 'gross', gross, 'net', net, 'vat', gross - net) order by vat_code desc), '[]'::jsonb),
    coalesce(sum(gross), 0),
    coalesce(sum(net), 0)
  into v_lines, v_total, v_net
  from calc;

  -- the document is still being built inside this transaction
  perform set_config('kasa.building_sale', 'on', true);
  update public.sales set
    vat_lines = v_lines,
    total = v_total,
    net_total = v_net,
    vat_total = v_total - v_net,
    items_count = (select coalesce(sum(abs(quantity)), 0) from public.sale_items where sale_id = p_sale_id)
  where id = p_sale_id;
  perform set_config('kasa.building_sale', 'off', true);
end $$;

-- Manager approval for void/refund. Returns the approver id, or null + error text.
-- Failed attempts are counted (5 → locked 15 minutes). Never raises, so the counter is kept.
create or replace function public._approve(p_approver uuid, p_pin text, out approver uuid, out error text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  p public.profiles%rowtype;
begin
  if public.is_manager() then
    approver := auth.uid();
    return;
  end if;
  if p_approver is null or coalesce(p_pin, '') = '' then
    error := 'pin_required';
    return;
  end if;
  select * into p from public.profiles
    where id = p_approver and business_id = v_business and active and role in ('admin', 'manager');
  if not found then
    error := 'approver_not_found';
    return;
  end if;
  if p.pin_hash is null then
    error := 'approver_has_no_pin';
    return;
  end if;
  if p.pin_locked_until is not null and p.pin_locked_until > now() then
    error := 'approver_locked';
    return;
  end if;
  if extensions.crypt(p_pin, p.pin_hash) = p.pin_hash then
    update public.profiles set pin_failed = 0, pin_locked_until = null where id = p.id;
    approver := p.id;
  else
    update public.profiles set
      pin_failed = pin_failed + 1,
      pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '15 minutes' else null end
    where id = p.id;
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (v_business, auth.uid(), 'approval_failed', 'profile', p.id::text, jsonb_build_object('attempt', p.pin_failed + 1));
    error := case when p.pin_failed + 1 >= 5 then 'approver_locked' else 'wrong_pin' end;
  end if;
end $$;

-- Applies a stock change for a sale line (products only, businesses with stock).
create or replace function public._move_stock(p_business uuid, p_product uuid, p_qty numeric, p_kind text, p_sale uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after numeric;
begin
  update public.products set stock = stock + p_qty, updated_at = now()
    where id = p_product and business_id = p_business and kind = 'product'
    returning stock into v_after;
  if found then
    insert into public.stock_movements (business_id, product_id, kind, quantity, stock_after, ref_type, ref_id, worker_id)
    values (p_business, p_product, p_kind, p_qty, v_after, 'sale', p_sale::text, auth.uid());
  end if;
end $$;

revoke execute on function public._next_numbers(uuid) from public, anon, authenticated;
revoke execute on function public._finalize_sale(uuid) from public, anon, authenticated;
revoke execute on function public._approve(uuid, text) from public, anon, authenticated;
revoke execute on function public._move_stock(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- create_sale
-- p: { client_id, register_id?, items: [{product_id, quantity, unit_price?, discount?}],
--      invoice_discount?, payment: {method, card_amount?, tendered?},
--      offline?, offline_no?, client_created_at?, note? }
-- Returns the stored sale (json). Same client_id → the existing sale is returned.
-- ---------------------------------------------------------------------
create or replace function public.create_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_client uuid := (p->>'client_id')::uuid;
  v_existing uuid;
  v_sale uuid;
  v_nums record;
  v_register uuid := nullif(p->>'register_id', '')::uuid;
  v_offline boolean := coalesce((p->>'offline')::boolean, false);
  v_type public.business_type;
  v_track_stock boolean;
  it jsonb;
  prod public.products%rowtype;
  v_pos int := 0;
  v_qty numeric;
  v_price numeric;
  v_line_disc numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_line_disc_total numeric := 0;
  v_inv_disc numeric := round(coalesce((p->>'invoice_discount')::numeric, 0), 2);
  v_total numeric;
  v_method text := coalesce(p->'payment'->>'method', 'cash');
  v_card numeric;
  v_cash numeric;
  v_tendered numeric;
  v_item uuid;
  v_mismatch jsonb := '[]'::jsonb;
  r record;
  v_left numeric;
  v_share numeric;
  v_biggest uuid;
begin
  if v_business is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  if v_client is null then
    raise exception 'Mungon client_id' using errcode = '22023';
  end if;

  select id into v_existing from public.sales where business_id = v_business and client_id = v_client;
  if v_existing is not null then
    return public.sale_json(v_existing);
  end if;

  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Fatura është bosh' using errcode = '22023';
  end if;
  if jsonb_array_length(p->'items') > 500 then
    raise exception 'Shumë artikuj në një faturë' using errcode = '22023';
  end if;
  if v_register is not null and not exists (select 1 from public.registers where id = v_register and business_id = v_business) then
    raise exception 'Arka nuk u gjet' using errcode = '22023';
  end if;
  if v_method not in ('cash', 'card', 'mixed') then
    raise exception 'Mënyra e pagesës nuk njihet' using errcode = '22023';
  end if;

  select type into v_type from public.businesses where id = v_business;
  v_track_stock := v_type <> 'salon';

  select * into v_nums from public._next_numbers(v_business);

  insert into public.sales (business_id, register_id, worker_id, client_id, kind, invoice_no, daily_no, sale_date,
                            payment_method, offline, offline_no, client_created_at, note)
  values (v_business, v_register, auth.uid(), v_client, 'sale', v_nums.invoice_no, v_nums.daily_no, v_nums.sale_date,
          v_method, v_offline, nullif(p->>'offline_no', ''), nullif(p->>'client_created_at', '')::timestamptz,
          nullif(trim(coalesce(p->>'note', '')), ''))
  returning id into v_sale;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_pos := v_pos + 1;
    select * into prod from public.products where id = (it->>'product_id')::uuid and business_id = v_business;
    if not found then
      raise exception 'Artikulli % nuk u gjet', v_pos using errcode = '22023';
    end if;
    v_qty := (it->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then
      raise exception 'Sasia nuk është e saktë: %', prod.name using errcode = '22023';
    end if;
    if prod.unit = 'kg' then v_qty := round(v_qty, 3); else v_qty := round(v_qty, 0); end if;
    if v_qty <= 0 then
      raise exception 'Sasia nuk është e saktë: %', prod.name using errcode = '22023';
    end if;

    -- Price: always the catalog price, except offline sales that were rung up with an older price.
    v_price := prod.sale_price;
    if it ? 'unit_price' and round((it->>'unit_price')::numeric, 2) <> prod.sale_price then
      if v_offline then
        v_price := round((it->>'unit_price')::numeric, 2);
      end if;
      v_mismatch := v_mismatch || jsonb_build_object('product', prod.id, 'name', prod.name,
                      'client', round((it->>'unit_price')::numeric, 2), 'catalog', prod.sale_price);
    end if;

    v_line_disc := round(coalesce((it->>'discount')::numeric, 0), 2);
    v_line_total := round(v_qty * v_price, 2);
    if v_line_disc < 0 or v_line_disc > v_line_total then
      raise exception 'Zbritja nuk është e saktë: %', prod.name using errcode = '22023';
    end if;
    v_line_total := v_line_total - v_line_disc;
    v_subtotal := v_subtotal + v_line_total;
    v_line_disc_total := v_line_disc_total + v_line_disc;

    insert into public.sale_items (sale_id, business_id, worker_id, position, product_id, kind, name, unit, quantity,
                                   unit_price, line_discount, total, vat_code, vat_rate, atk_type)
    values (v_sale, v_business, auth.uid(), v_pos, prod.id, prod.kind, prod.name, prod.unit, v_qty,
            v_price, v_line_disc, v_line_total, prod.vat_code, public._vat_rate(prod.vat_code), prod.atk_type)
    returning id into v_item;

    insert into public.sale_item_costs (sale_item_id, business_id, purchase_price)
    values (v_item, v_business, coalesce((select purchase_price from public.product_costs where product_id = prod.id), 0));

    if v_track_stock then
      perform public._move_stock(v_business, prod.id, -v_qty, 'sale', v_sale);
    end if;
  end loop;

  -- Invoice discount: spread over the lines in proportion to their totals (needed for VAT per rate).
  if v_inv_disc < 0 or v_inv_disc > v_subtotal then
    raise exception 'Zbritja e faturës nuk është e saktë' using errcode = '22023';
  end if;
  if v_inv_disc > 0 then
    perform set_config('kasa.building_sale', 'on', true);
    v_left := v_inv_disc;
    for r in select id, total from public.sale_items where sale_id = v_sale order by total desc loop
      v_biggest := coalesce(v_biggest, r.id);
      v_share := round(v_inv_disc * r.total / v_subtotal, 2);
      v_share := least(v_share, v_left, r.total);
      update public.sale_items set invoice_discount = v_share, total = total - v_share where id = r.id;
      v_left := v_left - v_share;
    end loop;
    if v_left <> 0 then
      update public.sale_items set invoice_discount = invoice_discount + v_left, total = total - v_left where id = v_biggest;
    end if;
  end if;

  v_total := v_subtotal - v_inv_disc;

  -- Payment
  if v_method = 'cash' then
    v_card := 0;
  elsif v_method = 'card' then
    v_card := v_total;
  else
    v_card := round(coalesce((p->'payment'->>'card_amount')::numeric, 0), 2);
    if v_card <= 0 or v_card >= v_total then
      raise exception 'Shuma me kartelë duhet të jetë mes 0 dhe totalit' using errcode = '22023';
    end if;
  end if;
  v_cash := v_total - v_card;
  v_tendered := round(coalesce((p->'payment'->>'tendered')::numeric, v_cash), 2);
  if v_cash > 0 and v_tendered < v_cash then
    raise exception 'Shuma e paguar është më e vogël se totali' using errcode = '22023';
  end if;
  if v_cash = 0 then v_tendered := null; end if;

  perform set_config('kasa.building_sale', 'on', true);
  update public.sales set
    subtotal = v_subtotal,
    invoice_discount = v_inv_disc,
    discount_total = v_line_disc_total + v_inv_disc,
    cash_amount = v_cash,
    card_amount = v_card,
    tendered = v_tendered,
    change_amount = coalesce(v_tendered - v_cash, 0)
  where id = v_sale;

  perform public._finalize_sale(v_sale);

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'sale', 'sale', v_sale::text, jsonb_build_object(
    'invoice_no', v_nums.invoice_no, 'total', v_total, 'offline', v_offline,
    'discount', v_line_disc_total + v_inv_disc));
  if jsonb_array_length(v_mismatch) > 0 then
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (v_business, auth.uid(), 'sale_price_mismatch', 'sale', v_sale::text,
            jsonb_build_object('offline', v_offline, 'lines', v_mismatch));
  end if;

  return public.sale_json(v_sale);
end $$;

-- ---------------------------------------------------------------------
-- void_sale: cancels a whole sale with a "void" document (negative copy).
-- Returns { ok: true, sale } or { ok: false, error } (wrong PIN etc.).
-- ---------------------------------------------------------------------
create or replace function public.void_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_client uuid := (p->>'client_id')::uuid;
  v_existing uuid;
  orig public.sales%rowtype;
  v_appr record;
  v_nums record;
  v_doc uuid;
  v_restock boolean := coalesce((p->>'restock')::boolean, true);
  v_item uuid;
  i public.sale_items%rowtype;
begin
  if v_business is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  if v_client is null then
    raise exception 'Mungon client_id' using errcode = '22023';
  end if;
  select id into v_existing from public.sales where business_id = v_business and client_id = v_client;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'sale', public.sale_json(v_existing));
  end if;
  if length(trim(coalesce(p->>'reason', ''))) = 0 then
    raise exception 'Zgjidh arsyen' using errcode = '22023';
  end if;

  select * into orig from public.sales where id = (p->>'sale_id')::uuid and business_id = v_business for update;
  if not found or orig.kind <> 'sale' then
    raise exception 'Fatura nuk u gjet' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.sales where ref_sale_id = orig.id) then
    raise exception 'Kjo faturë është anuluar ose ka kthime; anulimi i plotë nuk lejohet' using errcode = '22023';
  end if;

  select * into v_appr from public._approve(nullif(p->>'approver_id', '')::uuid, p->>'pin');
  if v_appr.error is not null then
    return jsonb_build_object('ok', false, 'error', v_appr.error);
  end if;

  select * into v_nums from public._next_numbers(v_business);
  insert into public.sales (business_id, register_id, worker_id, client_id, kind, ref_sale_id, invoice_no, daily_no, sale_date,
                            subtotal, invoice_discount, discount_total, payment_method, cash_amount, card_amount, change_amount,
                            reason, note, approved_by, restock)
  values (v_business, coalesce(nullif(p->>'register_id', '')::uuid, orig.register_id), auth.uid(), v_client, 'void', orig.id,
          v_nums.invoice_no, v_nums.daily_no, v_nums.sale_date,
          -orig.subtotal, -orig.invoice_discount, -orig.discount_total, orig.payment_method, -orig.cash_amount, -orig.card_amount, 0,
          trim(p->>'reason'), nullif(trim(coalesce(p->>'note', '')), ''), v_appr.approver, v_restock)
  returning id into v_doc;

  for i in select * from public.sale_items where sale_id = orig.id order by position loop
    insert into public.sale_items (sale_id, business_id, worker_id, position, product_id, kind, name, unit, quantity, unit_price,
                                   line_discount, invoice_discount, total, vat_code, vat_rate, atk_type, ref_item_id)
    values (v_doc, v_business, auth.uid(), i.position, i.product_id, i.kind, i.name, i.unit, -i.quantity, i.unit_price,
            -i.line_discount, -i.invoice_discount, -i.total, i.vat_code, i.vat_rate, i.atk_type, i.id)
    returning id into v_item;
    insert into public.sale_item_costs (sale_item_id, business_id, purchase_price)
    select v_item, v_business, c.purchase_price from public.sale_item_costs c where c.sale_item_id = i.id;
    if v_restock and i.product_id is not null and exists (
      select 1 from public.stock_movements m where m.ref_id = orig.id::text and m.product_id = i.product_id and m.kind = 'sale'
    ) then
      perform public._move_stock(v_business, i.product_id, i.quantity, 'void', v_doc);
    end if;
  end loop;

  perform public._finalize_sale(v_doc);

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'void', 'sale', v_doc::text, jsonb_build_object(
    'original', orig.id, 'invoice_no', orig.invoice_no, 'total', orig.total, 'reason', trim(p->>'reason'),
    'approved_by', v_appr.approver));

  return jsonb_build_object('ok', true, 'sale', public.sale_json(v_doc));
end $$;

-- ---------------------------------------------------------------------
-- refund_sale: returns some items of a sale with a "refund" document.
-- p: { client_id, sale_id, items: [{sale_item_id, quantity}], reason, note?, restock?, method: cash|card,
--      approver_id?, pin?, register_id? }
-- ---------------------------------------------------------------------
create or replace function public.refund_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_client uuid := (p->>'client_id')::uuid;
  v_existing uuid;
  orig public.sales%rowtype;
  v_appr record;
  v_nums record;
  v_doc uuid;
  v_restock boolean := coalesce((p->>'restock')::boolean, true);
  v_method text := coalesce(p->>'method', 'cash');
  it jsonb;
  i public.sale_items%rowtype;
  v_qty numeric;
  v_done numeric;
  v_total numeric;
  v_line_disc numeric;
  v_inv_disc numeric;
  v_item uuid;
  v_pos int := 0;
  v_sum numeric;
begin
  if v_business is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  if v_client is null then
    raise exception 'Mungon client_id' using errcode = '22023';
  end if;
  select id into v_existing from public.sales where business_id = v_business and client_id = v_client;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'sale', public.sale_json(v_existing));
  end if;
  if length(trim(coalesce(p->>'reason', ''))) = 0 then
    raise exception 'Zgjidh arsyen' using errcode = '22023';
  end if;
  if v_method not in ('cash', 'card') then
    raise exception 'Mënyra e kthimit nuk njihet' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Zgjidh të paktën një artikull' using errcode = '22023';
  end if;

  select * into orig from public.sales where id = (p->>'sale_id')::uuid and business_id = v_business for update;
  if not found or orig.kind <> 'sale' then
    raise exception 'Fatura nuk u gjet' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.sales where ref_sale_id = orig.id and kind = 'void') then
    raise exception 'Kjo faturë është anuluar' using errcode = '22023';
  end if;

  select * into v_appr from public._approve(nullif(p->>'approver_id', '')::uuid, p->>'pin');
  if v_appr.error is not null then
    return jsonb_build_object('ok', false, 'error', v_appr.error);
  end if;

  select * into v_nums from public._next_numbers(v_business);
  insert into public.sales (business_id, register_id, worker_id, client_id, kind, ref_sale_id, invoice_no, daily_no, sale_date,
                            payment_method, reason, note, approved_by, restock)
  values (v_business, coalesce(nullif(p->>'register_id', '')::uuid, orig.register_id), auth.uid(), v_client, 'refund', orig.id,
          v_nums.invoice_no, v_nums.daily_no, v_nums.sale_date, v_method,
          trim(p->>'reason'), nullif(trim(coalesce(p->>'note', '')), ''), v_appr.approver, v_restock)
  returning id into v_doc;

  for it in select * from jsonb_array_elements(p->'items') loop
    select * into i from public.sale_items where id = (it->>'sale_item_id')::uuid and sale_id = orig.id;
    if not found then
      raise exception 'Artikulli nuk është në këtë faturë' using errcode = '22023';
    end if;
    v_qty := (it->>'quantity')::numeric;
    if i.unit = 'kg' then v_qty := round(v_qty, 3); else v_qty := round(v_qty, 0); end if;
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;
    select coalesce(-sum(r.quantity), 0) into v_done from public.sale_items r where r.ref_item_id = i.id;
    if v_qty > i.quantity - v_done then
      raise exception 'Nga "%" mund të kthehen edhe % (blerë %, kthyer %)', i.name, i.quantity - v_done, i.quantity, v_done
        using errcode = '22023';
    end if;
    -- Full remaining quantity → exactly what is left of the line; otherwise proportional.
    if v_qty = i.quantity - v_done then
      select i.total + coalesce(sum(r.total), 0), i.line_discount + coalesce(sum(r.line_discount), 0),
             i.invoice_discount + coalesce(sum(r.invoice_discount), 0)
        into v_total, v_line_disc, v_inv_disc
        from public.sale_items r where r.ref_item_id = i.id;
    else
      v_total := round(i.total * v_qty / i.quantity, 2);
      v_line_disc := round(i.line_discount * v_qty / i.quantity, 2);
      v_inv_disc := round(i.invoice_discount * v_qty / i.quantity, 2);
    end if;
    v_pos := v_pos + 1;
    insert into public.sale_items (sale_id, business_id, worker_id, position, product_id, kind, name, unit, quantity, unit_price,
                                   line_discount, invoice_discount, total, vat_code, vat_rate, atk_type, ref_item_id)
    values (v_doc, v_business, auth.uid(), v_pos, i.product_id, i.kind, i.name, i.unit, -v_qty, i.unit_price,
            -v_line_disc, -v_inv_disc, -v_total, i.vat_code, i.vat_rate, i.atk_type, i.id)
    returning id into v_item;
    insert into public.sale_item_costs (sale_item_id, business_id, purchase_price)
    select v_item, v_business, c.purchase_price from public.sale_item_costs c where c.sale_item_id = i.id;
    if v_restock and i.product_id is not null and exists (
      select 1 from public.stock_movements m where m.ref_id = orig.id::text and m.product_id = i.product_id and m.kind = 'sale'
    ) then
      perform public._move_stock(v_business, i.product_id, v_qty, 'refund', v_doc);
    end if;
  end loop;

  if v_pos = 0 then
    raise exception 'Zgjidh të paktën një artikull' using errcode = '22023';
  end if;

  select sum(total), sum(invoice_discount), sum(line_discount + invoice_discount)
    into v_sum, v_inv_disc, v_line_disc from public.sale_items where sale_id = v_doc;
  perform set_config('kasa.building_sale', 'on', true);
  update public.sales set
    subtotal = v_sum + v_inv_disc,          -- before invoice discount (all negative)
    invoice_discount = v_inv_disc,
    discount_total = v_line_disc,
    cash_amount = case when v_method = 'cash' then v_sum else 0 end,
    card_amount = case when v_method = 'card' then v_sum else 0 end
  where id = v_doc;

  perform public._finalize_sale(v_doc);

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'refund', 'sale', v_doc::text, jsonb_build_object(
    'original', orig.id, 'invoice_no', orig.invoice_no, 'total', v_sum, 'reason', trim(p->>'reason'),
    'approved_by', v_appr.approver, 'restock', v_restock));

  return jsonb_build_object('ok', true, 'sale', public.sale_json(v_doc));
end $$;

-- ---------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------

-- Full document as json (header + items + worker name + register name + business data for the receipt).
create or replace function public.sale_json(p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'ref_sale_id', s.ref_sale_id,
    'ref_invoice_no', (select o.invoice_no from public.sales o where o.id = s.ref_sale_id),
    'invoice_no', s.invoice_no, 'daily_no', s.daily_no, 'sale_date', s.sale_date,
    'created_at', s.created_at, 'client_created_at', s.client_created_at,
    'items_count', s.items_count, 'subtotal', s.subtotal, 'invoice_discount', s.invoice_discount,
    'discount_total', s.discount_total, 'total', s.total, 'net_total', s.net_total, 'vat_total', s.vat_total,
    'vat_lines', s.vat_lines, 'payment_method', s.payment_method, 'cash_amount', s.cash_amount,
    'card_amount', s.card_amount, 'tendered', s.tendered, 'change_amount', s.change_amount,
    'reason', s.reason, 'note', s.note, 'offline', s.offline, 'offline_no', s.offline_no,
    'fiscal_status', s.fiscal_status, 'worker_id', s.worker_id,
    'worker_name', (select pr.full_name from public.profiles pr where pr.id = s.worker_id),
    'register_name', (select r.name from public.registers r where r.id = s.register_id),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'position', i.position, 'product_id', i.product_id, 'name', i.name, 'unit', i.unit,
        'quantity', i.quantity, 'unit_price', i.unit_price, 'line_discount', i.line_discount,
        'invoice_discount', i.invoice_discount, 'total', i.total, 'vat_code', i.vat_code,
        'refunded', (select coalesce(-sum(r.quantity), 0) from public.sale_items r where r.ref_item_id = i.id)
      ) order by i.position), '[]'::jsonb)
      from public.sale_items i where i.sale_id = s.id
    ),
    'voided', exists (select 1 from public.sales v where v.ref_sale_id = s.id and v.kind = 'void'),
    'has_refunds', exists (select 1 from public.sales v where v.ref_sale_id = s.id and v.kind = 'refund')
  )
  from public.sales s
  where s.id = p_sale_id and s.business_id = public.current_business_id()
$$;

-- Find a sale by its number (for refunds) – any worker of the business may look it up.
create or replace function public.lookup_sale(p_invoice_no bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.sale_json(s.id)
  from public.sales s
  where s.business_id = public.current_business_id() and s.invoice_no = p_invoice_no
$$;

-- Managers who can approve (for the PIN dialog).
create or replace function public.business_approvers()
returns table (id uuid, full_name text, role public.user_role, has_pin boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role, p.pin_hash is not null
  from public.profiles p
  where p.business_id = public.current_business_id() and p.active and p.role in ('admin', 'manager')
  order by p.role, p.full_name
$$;

-- Managers set their own 4-digit PIN (used for approvals now, for PIN login in phase 6).
create or replace function public.set_own_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_business_id() is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  if p_pin !~ '^\d{4}$' then
    raise exception 'PIN-i duhet të ketë 4 shifra' using errcode = '22023';
  end if;
  if p_pin in ('0000', '1111', '1234', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '4321') then
    raise exception 'Ky PIN është shumë i thjeshtë' using errcode = '22023';
  end if;
  update public.profiles set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), pin_failed = 0, pin_locked_until = null
    where id = auth.uid();
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (public.current_business_id(), auth.uid(), 'pin_change', 'profile', auth.uid()::text, '{}'::jsonb);
end $$;

create or replace function public.my_pin_status()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pin_hash is not null from public.profiles where id = auth.uid()
$$;

-- Platform list: today's sales total per business (replaces the 0 from phase 1).
create or replace function public.platform_businesses()
returns table (
  id uuid, name text, type public.business_type, active boolean, city text, owner_name text, owner_email text,
  users_count bigint, registers_count bigint, has_logged_in boolean, sales_today numeric, created_at timestamptz
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
    exists (select 1 from public.profiles p join auth.users u on u.id = p.id
            where p.business_id = b.id and u.last_sign_in_at is not null),
    coalesce((select sum(s.total) from public.sales s where s.business_id = b.id and s.sale_date = public._local_date()), 0)::numeric,
    b.created_at
  from public.businesses b
  order by b.created_at desc;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.create_sale(jsonb) from public, anon;
revoke execute on function public.void_sale(jsonb) from public, anon;
revoke execute on function public.refund_sale(jsonb) from public, anon;
revoke execute on function public.sale_json(uuid) from public, anon;
revoke execute on function public.lookup_sale(bigint) from public, anon;
revoke execute on function public.business_approvers() from public, anon;
revoke execute on function public.set_own_pin(text) from public, anon;
revoke execute on function public.my_pin_status() from public, anon;
grant execute on function public.create_sale(jsonb) to authenticated;
grant execute on function public.void_sale(jsonb) to authenticated;
grant execute on function public.refund_sale(jsonb) to authenticated;
grant execute on function public.sale_json(uuid) to authenticated;
grant execute on function public.lookup_sale(bigint) to authenticated;
grant execute on function public.business_approvers() to authenticated;
grant execute on function public.set_own_pin(text) to authenticated;
grant execute on function public.my_pin_status() to authenticated;
