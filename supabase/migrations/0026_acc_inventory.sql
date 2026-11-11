-- =====================================================================
-- 0026 – Kasa Kontabilist, phase K8 (part 2): inventory for clients that do not use the Kasa till.
--
-- * acc_items: products of a client – SKU, barcode, unit, VAT letter, purchase price (without VAT),
--   sale price (with VAT), minimum stock, category.
-- * acc_warehouses: warehouses / shops of the client ("Depoja kryesore" is created by itself).
-- * acc_stock_moves: every change of stock (signed quantity): opening, in, out, transfer, adjustment.
--   In and opening carry the unit cost; the value of the stock is the weighted average cost of what came in.
-- * Stock from invoices: the lines of a purchase invoice go in, of a sale go out – each line once
--   (matched to an existing item by SKU / name, or a new item is made from the line).
-- * acc_stocktakes: counting a warehouse; posting writes the differences as adjustments.
-- * Low stock: stock <= min_stock (only when min_stock > 0); critical: stock <= min_stock / 2.
-- The books (ledger) do not change: goods purchases stay as before; this is the quantity side.
-- =====================================================================

create table if not exists public.acc_items (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.acc_clients (id) on delete cascade,
  sku            text,
  barcode        text,
  name           text not null check (length(trim(name)) > 0),
  unit           text not null default 'copë',
  vat_code       char(1) not null default 'E' check (vat_code in ('E', 'D', 'C', 'A')),
  purchase_price numeric(14, 4) not null default 0 check (purchase_price >= 0),   -- without VAT
  sale_price     numeric(14, 2) not null default 0 check (sale_price >= 0),       -- with VAT
  min_stock      numeric(14, 3) not null default 0 check (min_stock >= 0),
  category       text,
  note           text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create unique index if not exists acc_items_sku_idx on public.acc_items (client_id, lower(sku)) where sku is not null;
create index if not exists acc_items_client_idx on public.acc_items (client_id, name);

create table if not exists public.acc_warehouses (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.acc_clients (id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  is_default boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists acc_warehouses_client_idx on public.acc_warehouses (client_id);

create table if not exists public.acc_stock_moves (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.acc_clients (id) on delete cascade,
  item_id      uuid not null references public.acc_items (id) on delete cascade,
  warehouse_id uuid not null references public.acc_warehouses (id) on delete cascade,
  move_date    date not null,
  kind         text not null check (kind in ('opening', 'in', 'out', 'transfer_in', 'transfer_out', 'adjust')),
  qty          numeric(14, 3) not null check (qty <> 0),      -- + in, − out
  unit_cost    numeric(14, 4),                                  -- without VAT, for opening / in
  doc_id       uuid references public.acc_documents (id) on delete set null,
  doc_line_id  uuid references public.acc_document_lines (id) on delete set null,
  transfer_id  uuid,
  stocktake_id uuid,
  note         text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists acc_stock_moves_item_idx on public.acc_stock_moves (item_id, move_date);
create index if not exists acc_stock_moves_client_idx on public.acc_stock_moves (client_id, move_date desc);
create unique index if not exists acc_stock_moves_line_idx on public.acc_stock_moves (doc_line_id) where doc_line_id is not null;

create table if not exists public.acc_stocktakes (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.acc_clients (id) on delete cascade,
  warehouse_id uuid not null references public.acc_warehouses (id) on delete cascade,
  take_date    date not null,
  status       text not null default 'draft' check (status in ('draft', 'posted')),
  note         text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  posted_at    timestamptz
);
create table if not exists public.acc_stocktake_lines (
  stocktake_id uuid not null references public.acc_stocktakes (id) on delete cascade,
  item_id      uuid not null references public.acc_items (id) on delete cascade,
  expected     numeric(14, 3) not null,
  counted      numeric(14, 3),
  primary key (stocktake_id, item_id)
);

alter table public.acc_items           enable row level security;
alter table public.acc_warehouses      enable row level security;
alter table public.acc_stock_moves     enable row level security;
alter table public.acc_stocktakes      enable row level security;
alter table public.acc_stocktake_lines enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array['acc_items', 'acc_warehouses', 'acc_stock_moves', 'acc_stocktakes']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (public._acc_client_visible(client_id))', t || '_own', t);
  end loop;
end $$;
drop policy if exists acc_stocktake_lines_own on public.acc_stocktake_lines;
create policy acc_stocktake_lines_own on public.acc_stocktake_lines for select to authenticated
  using (exists (select 1 from public.acc_stocktakes s where s.id = stocktake_id and public._acc_client_visible(s.client_id)));
revoke all on public.acc_items, public.acc_warehouses, public.acc_stock_moves, public.acc_stocktakes, public.acc_stocktake_lines from anon, authenticated;
grant select on public.acc_items, public.acc_warehouses, public.acc_stock_moves, public.acc_stocktakes, public.acc_stocktake_lines to authenticated;

-- History (0022) of items and stocktakes.
do $$
declare
  t text;
begin
  foreach t in array array['acc_items', 'acc_stocktakes']
  loop
    execute format('drop trigger if exists acc_log on public.%I', t);
    execute format('create trigger acc_log after insert or update or delete on public.%I for each row execute function public._acc_log()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- The default warehouse of a client (made on first use).
create or replace function public._acc_default_warehouse(p_client uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.acc_warehouses where client_id = p_client and is_default and active limit 1;
  if v_id is null then
    select id into v_id from public.acc_warehouses where client_id = p_client and active order by created_at limit 1;
  end if;
  if v_id is null then
    insert into public.acc_warehouses (client_id, name, is_default) values (p_client, 'Depoja kryesore', true) returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public._acc_warehouse_of(p_client uuid, p_wh uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_wh is null then return public._acc_default_warehouse(p_client); end if;
  if not exists (select 1 from public.acc_warehouses where id = p_wh and client_id = p_client) then
    raise exception 'Depoja nuk u gjet' using errcode = 'P0002';
  end if;
  return p_wh;
end $$;

-- Weighted average cost (without VAT) of what came in up to a date; falls back to the item's purchase price.
create or replace function public._acc_item_avg_cost(p_item uuid, p_as_of date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select round(sum(m.qty * m.unit_cost) / nullif(sum(m.qty), 0), 4)
     from public.acc_stock_moves m
     where m.item_id = p_item and m.kind in ('opening', 'in') and m.unit_cost is not null and m.move_date <= p_as_of),
    (select purchase_price from public.acc_items where id = p_item), 0)
$$;

-- ---------------------------------------------------------------------
-- Items and warehouses
-- ---------------------------------------------------------------------
create or replace function public.acc_warehouses_list(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  perform public._acc_default_warehouse(c.id);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'is_default', w.is_default, 'active', w.active,
                                                       'items', (select count(distinct m.item_id) from public.acc_stock_moves m where m.warehouse_id = w.id))
                                    order by w.is_default desc, w.name), '[]'::jsonb)
          from public.acc_warehouses w where w.client_id = c.id);
end $$;

create or replace function public.acc_warehouse_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Shkruaj emrin e depos' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.acc_warehouses (client_id, name) values (c.id, left(trim(p->>'name'), 100)) returning id into v_id;
  else
    update public.acc_warehouses set name = left(trim(p->>'name'), 100), active = coalesce((p->>'active')::boolean, active)
    where id = v_id and client_id = c.id;
    if not found then raise exception 'Depoja nuk u gjet' using errcode = 'P0002'; end if;
  end if;
  if coalesce((p->>'is_default')::boolean, false) then
    update public.acc_warehouses set is_default = (id = v_id) where client_id = c.id;
  end if;
  return v_id;
end $$;

-- Items with stock per warehouse, average cost, value and status at a date.
create or replace function public.acc_items_list(p_client uuid, p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_as_of date := coalesce(p_as_of, public._local_date());
begin
  return coalesce((
    select jsonb_agg(x order by x.active desc, x.name)
    from (
      select i.id, i.sku, i.barcode, i.name, i.unit, i.vat_code, i.purchase_price, i.sale_price, i.min_stock, i.category, i.note, i.active,
             s.stock, s.by_wh, public._acc_item_avg_cost(i.id, v_as_of) as avg_cost,
             round(s.stock * public._acc_item_avg_cost(i.id, v_as_of), 2) as value,
             s.last_move,
             case when s.stock < 0 then 'negative'
                  when i.min_stock > 0 and s.stock <= i.min_stock / 2 then 'critical'
                  when i.min_stock > 0 and s.stock <= i.min_stock then 'low' else 'ok' end as status
      from public.acc_items i
      cross join lateral (
        select coalesce(sum(m.qty), 0) as stock,
               max(m.move_date) as last_move,
               coalesce((select jsonb_object_agg(w.warehouse_id, w.q) from (
                          select m2.warehouse_id, sum(m2.qty) as q from public.acc_stock_moves m2
                          where m2.item_id = i.id and m2.move_date <= v_as_of group by m2.warehouse_id having sum(m2.qty) <> 0) w), '{}'::jsonb) as by_wh
        from public.acc_stock_moves m where m.item_id = i.id and m.move_date <= v_as_of
      ) s
      where i.client_id = c.id
    ) x
  ), '[]'::jsonb);
end $$;

-- p = {id?, client_id, sku?, barcode?, name, unit?, vat_code?, purchase_price?, sale_price?, min_stock?, category?, note?, active?}
create or replace function public.acc_item_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Shkruaj emrin e artikullit' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.acc_items (client_id, sku, barcode, name, unit, vat_code, purchase_price, sale_price, min_stock, category, note)
    values (c.id, nullif(trim(p->>'sku'), ''), nullif(trim(p->>'barcode'), ''), left(trim(p->>'name'), 200), coalesce(nullif(trim(p->>'unit'), ''), 'copë'),
            coalesce(nullif(p->>'vat_code', ''), 'E'), coalesce(nullif(p->>'purchase_price', '')::numeric, 0), coalesce(nullif(p->>'sale_price', '')::numeric, 0),
            coalesce(nullif(p->>'min_stock', '')::numeric, 0), nullif(trim(p->>'category'), ''), nullif(trim(p->>'note'), ''))
    returning id into v_id;
  else
    update public.acc_items
       set sku = nullif(trim(p->>'sku'), ''), barcode = nullif(trim(p->>'barcode'), ''), name = left(trim(p->>'name'), 200),
           unit = coalesce(nullif(trim(p->>'unit'), ''), unit), vat_code = coalesce(nullif(p->>'vat_code', ''), vat_code),
           purchase_price = coalesce(nullif(p->>'purchase_price', '')::numeric, purchase_price), sale_price = coalesce(nullif(p->>'sale_price', '')::numeric, sale_price),
           min_stock = coalesce(nullif(p->>'min_stock', '')::numeric, min_stock), category = nullif(trim(p->>'category'), ''), note = nullif(trim(p->>'note'), ''),
           active = coalesce((p->>'active')::boolean, active)
     where id = v_id and client_id = c.id;
    if not found then raise exception 'Artikulli nuk u gjet' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Delete when it never moved; otherwise it is only deactivated.
create or replace function public.acc_item_delete(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.acc_items;
begin
  select * into i from public.acc_items where id = p_id;
  if not found then raise exception 'Artikulli nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(i.client_id);
  if exists (select 1 from public.acc_stock_moves where item_id = i.id) then
    update public.acc_items set active = false where id = i.id;
    return 'archived';
  end if;
  delete from public.acc_items where id = i.id;
  return 'deleted';
end $$;

-- Many items at once (Excel): matched by SKU, then by name; p_rows = [{sku, barcode, name, unit, vat_code, purchase_price, sale_price, min_stock, category, opening_qty?}]
create or replace function public.acc_items_import(p_client uuid, p_rows jsonb, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  r jsonb;
  v_id uuid;
  v_new int := 0;
  v_upd int := 0;
  v_wh uuid := public._acc_default_warehouse(c.id);
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    continue when coalesce(trim(r->>'name'), '') = '';
    v_id := null;
    if nullif(trim(r->>'sku'), '') is not null then
      select id into v_id from public.acc_items where client_id = c.id and lower(sku) = lower(trim(r->>'sku'));
    end if;
    if v_id is null then
      select id into v_id from public.acc_items where client_id = c.id and lower(name) = lower(trim(r->>'name')) limit 1;
    end if;
    if v_id is not null then
      perform public.acc_item_save(r || jsonb_build_object('client_id', c.id, 'id', v_id));
      v_upd := v_upd + 1;
    else
      v_id := public.acc_item_save(r || jsonb_build_object('client_id', c.id));
      v_new := v_new + 1;
      if coalesce(nullif(r->>'opening_qty', '')::numeric, 0) <> 0 then
        insert into public.acc_stock_moves (client_id, item_id, warehouse_id, move_date, kind, qty, unit_cost, note, created_by)
        values (c.id, v_id, v_wh, coalesce(p_date, public._local_date()), 'opening', (r->>'opening_qty')::numeric,
                coalesce(nullif(r->>'purchase_price', '')::numeric, 0), 'Gjendja fillestare (import)', auth.uid());
      end if;
    end if;
  end loop;
  return jsonb_build_object('new', v_new, 'updated', v_upd);
end $$;

-- ---------------------------------------------------------------------
-- Movements
-- ---------------------------------------------------------------------
-- One manual move: p = {client_id, item_id, warehouse_id?, kind: opening|in|out|adjust, qty, unit_cost?, move_date?, note?}
-- qty is positive for opening / in / out; for adjust it is the signed difference.
create or replace function public.acc_stock_move(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_kind text := p->>'kind';
  v_qty numeric := coalesce((p->>'qty')::numeric, 0);
  v_item public.acc_items;
  v_id uuid;
begin
  select * into v_item from public.acc_items where id = (p->>'item_id')::uuid and client_id = c.id;
  if not found then raise exception 'Artikulli nuk u gjet' using errcode = 'P0002'; end if;
  if v_kind not in ('opening', 'in', 'out', 'adjust') then raise exception 'Lloji i lëvizjes nuk vlen' using errcode = '22023'; end if;
  if v_qty = 0 or (v_kind <> 'adjust' and v_qty < 0) then raise exception 'Shkruaj sasinë' using errcode = '22023'; end if;
  insert into public.acc_stock_moves (client_id, item_id, warehouse_id, move_date, kind, qty, unit_cost, note, created_by)
  values (c.id, v_item.id, public._acc_warehouse_of(c.id, nullif(p->>'warehouse_id', '')::uuid),
          coalesce(nullif(p->>'move_date', '')::date, public._local_date()), v_kind,
          case when v_kind = 'out' then -v_qty else v_qty end,
          case when v_kind in ('opening', 'in') then coalesce(nullif(p->>'unit_cost', '')::numeric, v_item.purchase_price) end,
          nullif(trim(p->>'note'), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.acc_stock_move_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.acc_stock_moves;
begin
  select * into m from public.acc_stock_moves where id = p_id;
  if not found then raise exception 'Lëvizja nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(m.client_id);
  if m.stocktake_id is not null then raise exception 'Lëvizja vjen nga një inventarizim i postuar' using errcode = '22023'; end if;
  if m.transfer_id is not null then
    delete from public.acc_stock_moves where transfer_id = m.transfer_id;      -- both sides of a transfer
  else
    delete from public.acc_stock_moves where id = m.id;
  end if;
end $$;

-- Transfer between warehouses: p = {client_id, from_warehouse, to_warehouse, move_date?, note?, lines: [{item_id, qty}]}
create or replace function public.acc_stock_transfer(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_from uuid := public._acc_warehouse_of(c.id, (p->>'from_warehouse')::uuid);
  v_to uuid := public._acc_warehouse_of(c.id, (p->>'to_warehouse')::uuid);
  v_tr uuid := gen_random_uuid();
  v_date date := coalesce(nullif(p->>'move_date', '')::date, public._local_date());
  l jsonb;
  v_n int := 0;
begin
  if v_from = v_to then raise exception 'Zgjidh dy depo të ndryshme' using errcode = '22023'; end if;
  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb))
  loop
    continue when coalesce((l->>'qty')::numeric, 0) <= 0;
    if not exists (select 1 from public.acc_items where id = (l->>'item_id')::uuid and client_id = c.id) then
      raise exception 'Artikulli nuk u gjet' using errcode = 'P0002';
    end if;
    insert into public.acc_stock_moves (client_id, item_id, warehouse_id, move_date, kind, qty, transfer_id, note, created_by)
    values (c.id, (l->>'item_id')::uuid, v_from, v_date, 'transfer_out', -(l->>'qty')::numeric, v_tr, nullif(trim(p->>'note'), ''), auth.uid()),
           (c.id, (l->>'item_id')::uuid, v_to, v_date, 'transfer_in', (l->>'qty')::numeric, v_tr, nullif(trim(p->>'note'), ''), auth.uid());
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Shto të paktën një artikull me sasi' using errcode = '22023'; end if;
  return v_tr;
end $$;

create or replace function public.acc_stock_moves_list(p_client uuid, p_item uuid default null, p_from date default null, p_to date default null)
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
    select jsonb_agg(x order by x.move_date desc, x.created_at desc)
    from (
      select m.id, m.move_date, m.kind, m.qty, m.unit_cost, m.note, m.created_at, m.transfer_id, m.stocktake_id,
             i.id as item_id, i.name as item_name, i.unit, w.name as warehouse_name, d.id as doc_id, d.doc_no, d.kind as doc_kind,
             coalesce(a.full_name, u.email) as created_by_name
      from public.acc_stock_moves m
      join public.acc_items i on i.id = m.item_id
      join public.acc_warehouses w on w.id = m.warehouse_id
      left join public.acc_documents d on d.id = m.doc_id
      left join public.accountants a on a.user_id = m.created_by
      left join auth.users u on u.id = m.created_by
      where m.client_id = c.id and (p_item is null or m.item_id = p_item)
        and (p_from is null or m.move_date >= p_from) and (p_to is null or m.move_date <= p_to)
      order by m.move_date desc, m.created_at desc
      limit 1000
    ) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Stock from invoices
-- ---------------------------------------------------------------------
-- Goods invoices of a period with how many of their lines are already in the stock.
create or replace function public.acc_stock_docs(p_client uuid, p_from date, p_to date)
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
    select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'doc_type', d.doc_type, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
                                        'partner_name', coalesce(pt.name, d.partner_name), 'total', d.total,
                                        'lines', (select count(*) from public.acc_document_lines l where l.doc_id = d.id),
                                        'posted', (select count(*) from public.acc_stock_moves m where m.doc_id = d.id and m.doc_line_id is not null))
                     order by d.doc_date desc, d.created_at desc)
    from public.acc_documents d
    left join public.acc_partners pt on pt.id = d.partner_id
    where d.client_id = c.id and d.kind in ('sale', 'purchase') and d.doc_date between p_from and p_to
      and (d.category = 'goods' or d.kind = 'sale')
      and exists (select 1 from public.acc_document_lines l where l.doc_id = d.id)
  ), '[]'::jsonb);
end $$;

-- Lines of one invoice with the item they match (SKU in the text, or the same name) and whether they are in.
create or replace function public.acc_stock_doc_lines(p_doc uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
begin
  select * into d from public.acc_documents where id = p_doc;
  if not found then raise exception 'Fatura nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(d.client_id);
  return jsonb_build_object(
    'doc', jsonb_build_object('id', d.id, 'kind', d.kind, 'doc_type', d.doc_type, 'doc_no', d.doc_no, 'doc_date', d.doc_date, 'partner_name', d.partner_name),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'description', l.description, 'unit', l.unit, 'quantity', l.quantity, 'unit_price', l.unit_price, 'net', l.net, 'vat_code', l.vat_code,
        'posted', exists (select 1 from public.acc_stock_moves m where m.doc_line_id = l.id),
        'item_id', coalesce(
           (select m.item_id from public.acc_stock_moves m where m.doc_line_id = l.id),
           (select i.id from public.acc_items i where i.client_id = d.client_id and i.active and i.sku is not null
              and position(lower(i.sku) in lower(l.description)) > 0 order by length(i.sku) desc limit 1),
           (select i.id from public.acc_items i where i.client_id = d.client_id and i.active and lower(i.name) = lower(trim(l.description)) limit 1))
      ) order by l.position)
      from public.acc_document_lines l where l.doc_id = d.id
    ), '[]'::jsonb));
end $$;

-- Puts the lines of an invoice into the stock: p = {doc_id, warehouse_id?, lines: [{line_id, item_id? | new_item: {name, sku?, unit?}, qty?}]}
-- purchase → in (cost = line net / quantity), sale → out; credit notes turn the direction around.
create or replace function public.acc_stock_post_doc(p jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
  v_wh uuid;
  l jsonb;
  dl public.acc_document_lines;
  v_item uuid;
  v_qty numeric;
  v_sign int;
  v_n int := 0;
begin
  select * into d from public.acc_documents where id = (p->>'doc_id')::uuid;
  if not found then raise exception 'Fatura nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(d.client_id);
  if d.kind not in ('sale', 'purchase') then raise exception 'Vetëm faturat e shitjes dhe të blerjes' using errcode = '22023'; end if;
  v_wh := public._acc_warehouse_of(d.client_id, nullif(p->>'warehouse_id', '')::uuid);
  v_sign := (case when d.kind = 'purchase' then 1 else -1 end) * (case when d.doc_type = 'credit_note' then -1 else 1 end);
  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb))
  loop
    select * into dl from public.acc_document_lines where id = (l->>'line_id')::uuid and doc_id = d.id;
    if not found then raise exception 'Rreshti nuk u gjet' using errcode = 'P0002'; end if;
    continue when exists (select 1 from public.acc_stock_moves where doc_line_id = dl.id);
    v_item := nullif(l->>'item_id', '')::uuid;
    if v_item is null and l ? 'new_item' then
      v_item := public.acc_item_save(jsonb_build_object(
        'client_id', d.client_id, 'name', coalesce(nullif(trim(l->'new_item'->>'name'), ''), dl.description),
        'sku', l->'new_item'->>'sku', 'unit', coalesce(nullif(l->'new_item'->>'unit', ''), dl.unit), 'vat_code', dl.vat_code,
        'purchase_price', case when d.kind = 'purchase' and dl.quantity <> 0 then round(dl.net / dl.quantity, 4) else 0 end,
        'sale_price', case when d.kind = 'sale' and dl.quantity <> 0
                           then round(dl.net / dl.quantity * (1 + case dl.vat_code when 'E' then 0.18 when 'D' then 0.08 else 0 end), 2) else 0 end));
    end if;
    continue when v_item is null;
    if not exists (select 1 from public.acc_items where id = v_item and client_id = d.client_id) then
      raise exception 'Artikulli nuk u gjet' using errcode = 'P0002';
    end if;
    v_qty := coalesce(nullif(l->>'qty', '')::numeric, dl.quantity);
    continue when v_qty = 0;
    insert into public.acc_stock_moves (client_id, item_id, warehouse_id, move_date, kind, qty, unit_cost, doc_id, doc_line_id, note, created_by)
    values (d.client_id, v_item, v_wh, d.doc_date, case when v_sign > 0 then 'in' else 'out' end, v_sign * abs(v_qty),
            case when v_sign > 0 and dl.quantity <> 0 then round(abs(dl.net / dl.quantity), 4) end,
            d.id, dl.id, left(coalesce(d.doc_no, '') || ' ' || dl.description, 200), auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Takes the invoice out of the stock again (all its lines).
create or replace function public.acc_stock_unpost_doc(p_doc uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
  v_n int;
begin
  select * into d from public.acc_documents where id = p_doc;
  if not found then raise exception 'Fatura nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(d.client_id);
  delete from public.acc_stock_moves where doc_id = d.id and doc_line_id is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Stocktaking
-- ---------------------------------------------------------------------
create or replace function public.acc_stocktake_create(p_client uuid, p_warehouse uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_wh uuid := public._acc_warehouse_of(c.id, p_warehouse);
  v_id uuid;
begin
  insert into public.acc_stocktakes (client_id, warehouse_id, take_date, created_by)
  values (c.id, v_wh, coalesce(p_date, public._local_date()), auth.uid())
  returning id into v_id;
  insert into public.acc_stocktake_lines (stocktake_id, item_id, expected)
  select v_id, i.id, coalesce((select sum(m.qty) from public.acc_stock_moves m
                               where m.item_id = i.id and m.warehouse_id = v_wh and m.move_date <= coalesce(p_date, public._local_date())), 0)
  from public.acc_items i where i.client_id = c.id and i.active;
  return v_id;
end $$;

create or replace function public.acc_stocktakes_list(p_client uuid)
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
    select jsonb_agg(jsonb_build_object('id', s.id, 'take_date', s.take_date, 'status', s.status, 'warehouse_name', w.name, 'note', s.note,
                                        'lines', (select count(*) from public.acc_stocktake_lines l where l.stocktake_id = s.id),
                                        'counted', (select count(*) from public.acc_stocktake_lines l where l.stocktake_id = s.id and l.counted is not null),
                                        'diffs', (select count(*) from public.acc_stocktake_lines l where l.stocktake_id = s.id and l.counted is not null and l.counted <> l.expected),
                                        'posted_at', s.posted_at) order by s.take_date desc, s.created_at desc)
    from public.acc_stocktakes s join public.acc_warehouses w on w.id = s.warehouse_id where s.client_id = c.id
  ), '[]'::jsonb);
end $$;

create or replace function public.acc_stocktake(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.acc_stocktakes;
begin
  select * into s from public.acc_stocktakes where id = p_id;
  if not found then raise exception 'Inventarizimi nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(s.client_id);
  return jsonb_build_object(
    'id', s.id, 'take_date', s.take_date, 'status', s.status, 'warehouse_id', s.warehouse_id,
    'warehouse_name', (select name from public.acc_warehouses where id = s.warehouse_id), 'note', s.note,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name, 'sku', i.sku, 'barcode', i.barcode, 'unit', i.unit,
                                                           'expected', l.expected, 'counted', l.counted,
                                                           'avg_cost', public._acc_item_avg_cost(i.id, s.take_date)) order by i.name)
                       from public.acc_stocktake_lines l join public.acc_items i on i.id = l.item_id where l.stocktake_id = s.id), '[]'::jsonb));
end $$;

create or replace function public.acc_stocktake_count(p_id uuid, p_item uuid, p_counted numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.acc_stocktakes;
begin
  select * into s from public.acc_stocktakes where id = p_id;
  if not found then raise exception 'Inventarizimi nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(s.client_id);
  if s.status <> 'draft' then raise exception 'Inventarizimi është postuar' using errcode = '22023'; end if;
  update public.acc_stocktake_lines set counted = p_counted where stocktake_id = s.id and item_id = p_item;
  if not found then raise exception 'Artikulli nuk është në këtë inventarizim' using errcode = 'P0002'; end if;
end $$;

-- Posting writes the differences (counted − expected) as adjustments on the stocktake date.
create or replace function public.acc_stocktake_post(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.acc_stocktakes;
  v_n int;
begin
  select * into s from public.acc_stocktakes where id = p_id for update;
  if not found then raise exception 'Inventarizimi nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(s.client_id);
  if s.status <> 'draft' then raise exception 'Inventarizimi është postuar' using errcode = '22023'; end if;
  insert into public.acc_stock_moves (client_id, item_id, warehouse_id, move_date, kind, qty, stocktake_id, note, created_by)
  select s.client_id, l.item_id, s.warehouse_id, s.take_date, 'adjust', l.counted - l.expected, s.id, 'Inventarizimi ' || to_char(s.take_date, 'DD.MM.YYYY'), auth.uid()
  from public.acc_stocktake_lines l where l.stocktake_id = s.id and l.counted is not null and l.counted <> l.expected;
  get diagnostics v_n = row_count;
  update public.acc_stocktakes set status = 'posted', posted_at = now() where id = s.id;
  return v_n;
end $$;

create or replace function public.acc_stocktake_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.acc_stocktakes;
begin
  select * into s from public.acc_stocktakes where id = p_id;
  if not found then raise exception 'Inventarizimi nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(s.client_id);
  delete from public.acc_stock_moves where stocktake_id = s.id;     -- a posted one takes its adjustments back
  delete from public.acc_stocktakes where id = s.id;
end $$;

revoke execute on function public._acc_default_warehouse(uuid), public._acc_warehouse_of(uuid, uuid), public._acc_item_avg_cost(uuid, date)
  from public, anon, authenticated;
revoke execute on function public.acc_warehouses_list(uuid), public.acc_warehouse_save(jsonb), public.acc_items_list(uuid, date),
  public.acc_item_save(jsonb), public.acc_item_delete(uuid), public.acc_items_import(uuid, jsonb, date), public.acc_stock_move(jsonb),
  public.acc_stock_move_delete(uuid), public.acc_stock_transfer(jsonb), public.acc_stock_moves_list(uuid, uuid, date, date),
  public.acc_stock_docs(uuid, date, date), public.acc_stock_doc_lines(uuid), public.acc_stock_post_doc(jsonb), public.acc_stock_unpost_doc(uuid),
  public.acc_stocktake_create(uuid, uuid, date), public.acc_stocktakes_list(uuid), public.acc_stocktake(uuid),
  public.acc_stocktake_count(uuid, uuid, numeric), public.acc_stocktake_post(uuid), public.acc_stocktake_delete(uuid) from public, anon;
grant execute on function public.acc_warehouses_list(uuid), public.acc_warehouse_save(jsonb), public.acc_items_list(uuid, date),
  public.acc_item_save(jsonb), public.acc_item_delete(uuid), public.acc_items_import(uuid, jsonb, date), public.acc_stock_move(jsonb),
  public.acc_stock_move_delete(uuid), public.acc_stock_transfer(jsonb), public.acc_stock_moves_list(uuid, uuid, date, date),
  public.acc_stock_docs(uuid, date, date), public.acc_stock_doc_lines(uuid), public.acc_stock_post_doc(jsonb), public.acc_stock_unpost_doc(uuid),
  public.acc_stocktake_create(uuid, uuid, date), public.acc_stocktakes_list(uuid), public.acc_stocktake(uuid),
  public.acc_stocktake_count(uuid, uuid, numeric), public.acc_stocktake_post(uuid), public.acc_stocktake_delete(uuid) to authenticated;
