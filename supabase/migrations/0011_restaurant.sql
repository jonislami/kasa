-- =====================================================================
-- 0011 – Restaurant / café: tables (floor plan), open orders, kitchen & bar
-- tickets, split bill, table transfer, recipes (ingredient stock), modifiers.
--
-- * dining_tables: floor plan (area, grid x/y, seats, shape). Managers edit via save_tables.
-- * orders + order_items: an open bill per table. Lines start as 'new', "send"
--   turns them into kitchen_tickets per station (categories.station: kitchen / bar);
--   the kitchen/bar device prints its own tickets on its own printer.
-- * Paying = a normal create_sale with p.order_id and items[].order_item_id
--   (split bill: pay some lines / quantities). order_payments makes it idempotent
--   (offline replays); the order closes when every line is paid.
-- * Modifiers live on the product (products.modifiers). Free options are notes;
--   priced options are hidden add-on products (addon_of) sold as their own lines,
--   so create_sale and the fiscal receipt stay unchanged.
-- * Recipes: a dish with a recipe moves its ingredients' stock, not its own
--   (_move_stock); the dish cost = sum of its ingredients' cost.
-- Older clients keep working: nothing they use changes shape.
-- =====================================================================

alter table public.categories add column if not exists station text check (station in ('kitchen', 'bar'));
alter table public.products add column if not exists modifiers jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists addon_of uuid references public.products (id) on delete cascade;
alter table public.products add column if not exists has_recipe boolean not null default false;
create index if not exists products_addon_idx on public.products (addon_of) where addon_of is not null;
alter table public.businesses add column if not exists order_counter bigint not null default 0;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.dining_tables (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
              references public.businesses (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 20),
  area        text not null default 'Salla',
  seats       int not null default 4 check (seats between 1 and 40),
  shape       text not null default 'square' check (shape in ('square', 'round', 'long')),
  x           int not null default 0 check (x between 0 and 30),
  y           int not null default 0 check (y between 0 and 30),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists dining_tables_business_idx on public.dining_tables (business_id, area, name);

create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
              references public.businesses (id) on delete cascade,
  order_no    bigint not null,
  table_id    uuid references public.dining_tables (id) on delete set null,
  status      text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  guests      int check (guests is null or guests between 1 and 99),
  waiter_id   uuid references auth.users (id),
  note        text,
  client_id   uuid,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);
create unique index if not exists orders_no_uq on public.orders (business_id, order_no);
create unique index if not exists orders_client_uq on public.orders (business_id, client_id) where client_id is not null;
create unique index if not exists orders_open_table_uq on public.orders (table_id) where status = 'open' and table_id is not null;
create index if not exists orders_business_idx on public.orders (business_id, status, opened_at desc);

create table if not exists public.kitchen_tickets (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_id    uuid not null references public.orders (id) on delete cascade,
  station     text not null check (station in ('kitchen', 'bar')),
  table_name  text,
  order_no    bigint not null,
  waiter_name text,
  items       jsonb not null,   -- [{name, quantity, modifiers:[names], note}]
  created_at  timestamptz not null default now(),
  printed_at  timestamptz,
  done_at     timestamptz
);
create index if not exists kitchen_tickets_open_idx on public.kitchen_tickets (business_id, station, created_at) where done_at is null;

create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id  uuid not null references public.products (id),
  name        text not null,
  unit_price  numeric(12, 2) not null,         -- with priced modifiers, VAT included
  quantity    numeric(14, 3) not null check (quantity >= 0),
  paid_qty    numeric(14, 3) not null default 0,
  modifiers   jsonb not null default '[]'::jsonb,   -- [{group, name, price, product_id?}]
  note        text,
  station     text check (station in ('kitchen', 'bar')),
  status      text not null default 'new' check (status in ('new', 'sent', 'ready', 'cancelled')),
  ticket_id   uuid references public.kitchen_tickets (id) on delete set null,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists order_items_order_idx on public.order_items (order_id, created_at);

create table if not exists public.order_payments (
  sale_id       uuid not null references public.sales (id),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  business_id   uuid not null references public.businesses (id) on delete cascade,
  quantity      numeric(14, 3) not null check (quantity > 0),
  created_at    timestamptz not null default now(),
  primary key (sale_id, order_item_id)
);

create table if not exists public.recipe_items (
  product_id    uuid not null references public.products (id) on delete cascade,
  ingredient_id uuid not null references public.products (id),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  quantity      numeric(14, 3) not null check (quantity > 0),
  primary key (product_id, ingredient_id)
);

alter table public.dining_tables   enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.kitchen_tickets enable row level security;
alter table public.order_payments  enable row level security;
alter table public.recipe_items    enable row level security;

drop policy if exists dining_tables_select on public.dining_tables;
create policy dining_tables_select on public.dining_tables for select to authenticated using (business_id = public.current_business_id());
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated using (business_id = public.current_business_id());
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select to authenticated using (business_id = public.current_business_id());
drop policy if exists kitchen_tickets_select on public.kitchen_tickets;
create policy kitchen_tickets_select on public.kitchen_tickets for select to authenticated using (business_id = public.current_business_id());
drop policy if exists order_payments_select on public.order_payments;
create policy order_payments_select on public.order_payments for select to authenticated using (business_id = public.current_business_id());
drop policy if exists recipe_items_select on public.recipe_items;
create policy recipe_items_select on public.recipe_items for select to authenticated using (business_id = public.current_business_id() and public.is_manager());

revoke insert, update, delete on public.dining_tables, public.orders, public.order_items, public.kitchen_tickets,
  public.order_payments, public.recipe_items from anon, authenticated;
revoke all on public.dining_tables, public.orders, public.order_items, public.kitchen_tickets,
  public.order_payments, public.recipe_items from anon;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._require_business()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid := public.current_business_id();
begin
  if v is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  return v;
end $$;
revoke execute on function public._require_business() from public, anon, authenticated;

create or replace function public.order_json(p_order uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'order_no', o.order_no, 'table_id', o.table_id, 'table_name', t.name, 'status', o.status,
    'guests', o.guests, 'waiter_id', o.waiter_id, 'waiter_name', w.full_name, 'note', o.note,
    'opened_at', o.opened_at, 'closed_at', o.closed_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'product_id', i.product_id, 'name', i.name, 'unit_price', i.unit_price, 'quantity', i.quantity,
        'paid_qty', i.paid_qty, 'modifiers', i.modifiers, 'note', i.note, 'station', i.station, 'status', i.status,
        'created_at', i.created_at, 'sent_at', i.sent_at, 'vat_code', pr.vat_code, 'unit', pr.unit
      ) order by i.created_at, i.id)
      from public.order_items i join public.products pr on pr.id = i.product_id
      where i.order_id = o.id and i.status <> 'cancelled' and i.quantity > 0), '[]'::jsonb)
  )
  from public.orders o
  left join public.dining_tables t on t.id = o.table_id
  left join public.profiles w on w.id = o.waiter_id
  where o.id = p_order and o.business_id = public.current_business_id()
$$;

-- ---------------------------------------------------------------------
-- save_tables: the whole floor plan. p: { tables: [{id?, name, area, seats, shape, x, y}] }
-- Tables left out are archived (not while they have an open order).
-- ---------------------------------------------------------------------
create or replace function public.save_tables(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
  t jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p->'tables', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p->'tables', '[]'::jsonb)) > 300 then
    raise exception 'Deri në 300 tavolina' using errcode = '22023';
  end if;
  for t in select * from jsonb_array_elements(coalesce(p->'tables', '[]'::jsonb)) loop
    v_id := nullif(t->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.dining_tables where id = v_id and business_id = v_business) then
      update public.dining_tables set
        name = trim(t->>'name'), area = coalesce(nullif(trim(t->>'area'), ''), 'Salla'),
        seats = coalesce((t->>'seats')::int, 4), shape = coalesce(nullif(t->>'shape', ''), 'square'),
        x = coalesce((t->>'x')::int, 0), y = coalesce((t->>'y')::int, 0), active = true
      where id = v_id;
    else
      insert into public.dining_tables (business_id, name, area, seats, shape, x, y)
      values (v_business, trim(t->>'name'), coalesce(nullif(trim(t->>'area'), ''), 'Salla'),
              coalesce((t->>'seats')::int, 4), coalesce(nullif(t->>'shape', ''), 'square'),
              coalesce((t->>'x')::int, 0), coalesce((t->>'y')::int, 0))
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  if exists (select 1 from public.dining_tables d join public.orders o on o.table_id = d.id and o.status = 'open'
             where d.business_id = v_business and d.active and not d.id = any (v_ids)) then
    raise exception 'Një tavolinë me porosi të hapur nuk mund të hiqet' using errcode = '22023';
  end if;
  update public.dining_tables set active = false where business_id = v_business and active and not id = any (v_ids);
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'settings_change', 'dining_tables', v_business::text, jsonb_build_object('tables', cardinality(v_ids)));
  return (select coalesce(jsonb_agg(to_jsonb(d) order by d.area, d.name), '[]'::jsonb) from public.dining_tables d where d.business_id = v_business and d.active);
end $$;

-- ---------------------------------------------------------------------
-- open_order: p { table_id?, guests?, client_id? } → order (the table's open one if it exists)
-- ---------------------------------------------------------------------
create or replace function public.open_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_business();
  v_table uuid := nullif(p->>'table_id', '')::uuid;
  v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_id uuid;
  v_no bigint;
begin
  if v_client is not null then
    select id into v_id from public.orders where business_id = v_business and client_id = v_client;
    if v_id is not null then return public.order_json(v_id); end if;
  end if;
  if v_table is not null then
    perform 1 from public.dining_tables where id = v_table and business_id = v_business and active for update;
    if not found then
      raise exception 'Tavolina nuk u gjet' using errcode = 'P0002';
    end if;
    select id into v_id from public.orders where table_id = v_table and status = 'open';
    if v_id is not null then return public.order_json(v_id); end if;
  end if;
  update public.businesses set order_counter = order_counter + 1 where id = v_business returning order_counter into v_no;
  insert into public.orders (business_id, order_no, table_id, guests, waiter_id, client_id)
  values (v_business, v_no, v_table, nullif(p->>'guests', '')::int, auth.uid(), v_client)
  returning id into v_id;
  return public.order_json(v_id);
end $$;

create or replace function public._open_order_row(p_order uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order and business_id = public.current_business_id() for update;
  if not found then
    raise exception 'Porosia nuk u gjet' using errcode = 'P0002';
  end if;
  if o.status <> 'open' then
    raise exception 'Porosia është mbyllur' using errcode = '22023';
  end if;
  return o;
end $$;
revoke execute on function public._open_order_row(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- add_order_items: p { order_id, items: [{product_id, quantity, modifiers:[{group, name}], note}] }
-- Prices and modifier prices come from the catalog. Same unsent line → quantity is added.
-- ---------------------------------------------------------------------
create or replace function public.add_order_items(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_business();
  o public.orders%rowtype := public._open_order_row(nullif(p->>'order_id', '')::uuid);
  it jsonb;
  m jsonb;
  prod public.products%rowtype;
  v_mods jsonb;
  v_opt jsonb;
  v_price numeric;
  v_qty numeric;
  v_note text;
  v_station text;
  v_existing uuid;
begin
  if jsonb_typeof(coalesce(p->'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) > 200 then
    raise exception 'Deri në 200 artikuj njëherësh' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    select * into prod from public.products
      where id = nullif(it->>'product_id', '')::uuid and business_id = v_business and active and addon_of is null;
    if not found then
      raise exception 'Artikulli nuk u gjet' using errcode = 'P0002';
    end if;
    if prod.has_variants then
      raise exception 'Zgjidh madhësinë dhe ngjyrën e "%"', prod.name using errcode = '22023';
    end if;
    v_qty := coalesce((it->>'quantity')::numeric, 1);
    if prod.unit = 'kg' then v_qty := round(v_qty, 3); else v_qty := round(v_qty, 0); end if;
    if v_qty <= 0 or v_qty > 999 then
      raise exception 'Sasia nuk është e saktë: %', prod.name using errcode = '22023';
    end if;
    -- modifiers: each chosen option must exist on the product
    v_mods := '[]'::jsonb;
    v_price := prod.sale_price;
    for m in select * from jsonb_array_elements(coalesce(it->'modifiers', '[]'::jsonb)) loop
      select o2.value into v_opt
      from jsonb_array_elements(prod.modifiers) g(value), jsonb_array_elements(g.value->'options') o2(value)
      where g.value->>'name' = m->>'group' and o2.value->>'name' = m->>'name'
      limit 1;
      if v_opt is null then
        raise exception 'Opsioni "%" nuk ekziston te "%"', m->>'name', prod.name using errcode = '22023';
      end if;
      v_mods := v_mods || jsonb_build_object('group', m->>'group', 'name', m->>'name',
                  'price', coalesce((v_opt->>'price')::numeric, 0), 'product_id', v_opt->>'product_id');
      v_price := v_price + coalesce((v_opt->>'price')::numeric, 0);
      v_opt := null;
    end loop;
    v_note := left(nullif(trim(coalesce(it->>'note', '')), ''), 200);
    select c.station into v_station from public.categories c where c.id = prod.category_id;

    select id into v_existing from public.order_items
      where order_id = o.id and product_id = prod.id and status = 'new' and modifiers = v_mods
        and coalesce(note, '') = coalesce(v_note, '')
      limit 1;
    if v_existing is not null then
      update public.order_items set quantity = quantity + v_qty where id = v_existing;
    else
      insert into public.order_items (order_id, business_id, product_id, name, unit_price, quantity, modifiers, note, station, created_by)
      values (o.id, v_business, prod.id, prod.name, round(v_price, 2), v_qty, v_mods, v_note, v_station, auth.uid());
    end if;
    v_existing := null;
  end loop;
  return public.order_json(o.id);
end $$;

-- set_order_item: p { item_id, quantity?, note? } – only lines not sent yet; quantity 0 removes it.
create or replace function public.set_order_item(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_business();
  i public.order_items%rowtype;
  o public.orders%rowtype;
  v_qty numeric;
begin
  select * into i from public.order_items where id = nullif(p->>'item_id', '')::uuid and business_id = v_business for update;
  if not found then
    raise exception 'Rreshti nuk u gjet' using errcode = 'P0002';
  end if;
  o := public._open_order_row(i.order_id);
  if i.status <> 'new' then
    raise exception 'Rreshti është dërguar – anuloje me arsye' using errcode = '22023';
  end if;
  if p ? 'quantity' then
    v_qty := (p->>'quantity')::numeric;
    if v_qty <= 0 then
      delete from public.order_items where id = i.id;
      return public.order_json(o.id);
    end if;
    update public.order_items set quantity = least(v_qty, 999) where id = i.id;
  end if;
  if p ? 'note' then
    update public.order_items set note = left(nullif(trim(coalesce(p->>'note', '')), ''), 200) where id = i.id;
  end if;
  return public.order_json(o.id);
end $$;

-- ---------------------------------------------------------------------
-- send_order: new lines → tickets per station. Returns { order, tickets }.
-- Lines whose category has no station are just marked sent.
-- ---------------------------------------------------------------------
create or replace function public.send_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_business();
  o public.orders%rowtype := public._open_order_row(nullif(p->>'order_id', '')::uuid);
  s text;
  v_ticket uuid;
  v_tickets jsonb := '[]'::jsonb;
  v_table text := (select name from public.dining_tables where id = o.table_id);
  v_waiter text := (select full_name from public.profiles where id = auth.uid());
begin
  for s in select distinct station from public.order_items where order_id = o.id and status = 'new' and station is not null loop
    insert into public.kitchen_tickets (business_id, order_id, station, table_name, order_no, waiter_name, items)
    select v_business, o.id, s, v_table, o.order_no, v_waiter,
           jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity,
                     'modifiers', (select coalesce(jsonb_agg(m->>'name'), '[]'::jsonb) from jsonb_array_elements(i.modifiers) m),
                     'note', i.note) order by i.created_at)
    from public.order_items i where i.order_id = o.id and i.status = 'new' and i.station = s
    returning id into v_ticket;
    update public.order_items set status = 'sent', sent_at = now(), ticket_id = v_ticket
      where order_id = o.id and status = 'new' and station = s;
    v_tickets := v_tickets || (select to_jsonb(t) from public.kitchen_tickets t where t.id = v_ticket);
  end loop;
  update public.order_items set status = 'sent', sent_at = now() where order_id = o.id and status = 'new';
  return jsonb_build_object('order', public.order_json(o.id), 'tickets', v_tickets);
end $$;

-- set_ticket: p { ticket_id, printed?: true, done?: true } – the kitchen/bar screen.
create or replace function public.set_ticket(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_business();
  v_id uuid := nullif(p->>'ticket_id', '')::uuid;
begin
  perform 1 from public.kitchen_tickets where id = v_id and business_id = v_business for update;
  if not found then
    raise exception 'Fletëporosia nuk u gjet' using errcode = 'P0002';
  end if;
  if coalesce((p->>'printed')::boolean, false) then
    update public.kitchen_tickets set printed_at = coalesce(printed_at, now()) where id = v_id;
  end if;
  if coalesce((p->>'done')::boolean, false) then
    update public.kitchen_tickets set done_at = coalesce(done_at, now()) where id = v_id;
    update public.order_items set status = 'ready' where ticket_id = v_id and status = 'sent';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- cancel_order_item: p { item_id, quantity, reason, approver_id?, pin? }
-- Unsent: anyone. Sent: manager, or a worker with a manager's PIN. Never paid quantity.
-- ---------------------------------------------------------------------
create or replace function public.cancel_order_item(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_business();
  i public.order_items%rowtype;
  o public.orders%rowtype;
  v_qty numeric;
  a record;
begin
  select * into i from public.order_items where id = nullif(p->>'item_id', '')::uuid and business_id = v_business for update;
  if not found then
    raise exception 'Rreshti nuk u gjet' using errcode = 'P0002';
  end if;
  o := public._open_order_row(i.order_id);
  v_qty := coalesce((p->>'quantity')::numeric, i.quantity - i.paid_qty);
  if v_qty <= 0 or v_qty > i.quantity - i.paid_qty then
    raise exception 'Mund të anulohen deri në %', i.quantity - i.paid_qty using errcode = '22023';
  end if;
  if i.status <> 'new' then
    select * into a from public._approve(nullif(p->>'approver_id', '')::uuid, p->>'pin');
    if a.approver is null then
      return jsonb_build_object('ok', false, 'error', a.error);
    end if;
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (v_business, auth.uid(), 'order_item_cancel', 'order', o.id::text, jsonb_build_object(
      'order_no', o.order_no, 'name', i.name, 'quantity', v_qty, 'value', round(v_qty * i.unit_price, 2),
      'reason', left(coalesce(p->>'reason', ''), 200), 'approved_by', a.approver));
  end if;
  if v_qty = i.quantity then
    update public.order_items set status = 'cancelled' where id = i.id;
  else
    update public.order_items set quantity = quantity - v_qty where id = i.id;
  end if;
  return jsonb_build_object('ok', true, 'order', public.order_json(o.id));
end $$;

-- ---------------------------------------------------------------------
-- move_order: p { order_id, table_id } – to a free table, or merged into that table's open order.
-- ---------------------------------------------------------------------
create or replace function public.move_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_business();
  o public.orders%rowtype := public._open_order_row(nullif(p->>'order_id', '')::uuid);
  v_table uuid := nullif(p->>'table_id', '')::uuid;
  v_target uuid;
begin
  perform 1 from public.dining_tables where id = v_table and business_id = v_business and active;
  if not found then
    raise exception 'Tavolina nuk u gjet' using errcode = 'P0002';
  end if;
  if v_table = o.table_id then
    return public.order_json(o.id);
  end if;
  select id into v_target from public.orders where table_id = v_table and status = 'open' for update;
  if v_target is null then
    update public.orders set table_id = v_table where id = o.id;
    v_target := o.id;
  else
    update public.order_items set order_id = v_target where order_id = o.id;
    update public.kitchen_tickets set order_id = v_target where order_id = o.id;
    update public.orders set status = 'cancelled', closed_at = now(), note = concat_ws(' ', note, '(bashkuar me #' || (select order_no from public.orders where id = v_target) || ')')
      where id = o.id;
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'order_move', 'order', o.id::text, jsonb_build_object(
    'order_no', o.order_no, 'from', (select name from public.dining_tables where id = o.table_id),
    'to', (select name from public.dining_tables where id = v_table), 'merged', v_target <> o.id));
  return public.order_json(v_target);
end $$;

-- cancel_order: an order with nothing sent and nothing paid (opened by mistake).
create or replace function public.cancel_order(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype := public._open_order_row(nullif(p->>'order_id', '')::uuid);
begin
  if exists (select 1 from public.order_items where order_id = o.id and status in ('sent', 'ready') and quantity > paid_qty) then
    raise exception 'Porosia ka artikuj të dërguar – anuloji një nga një' using errcode = '22023';
  end if;
  delete from public.order_items where order_id = o.id and status = 'new';
  update public.orders set status = case when exists (select 1 from public.order_payments op join public.order_items i on i.id = op.order_item_id where i.order_id = o.id) then 'paid' else 'cancelled' end,
                           closed_at = now() where id = o.id;
end $$;

-- ---------------------------------------------------------------------
-- create_sale: p.order_id + items[].order_item_id (+ order_qty) pays those lines.
-- Add-on lines carry the same order_item_id with "addon": true (not counted).
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = '_create_sale_staff') then
    alter function public.create_sale(jsonb) rename to _create_sale_staff;
  end if;
end $$;
revoke execute on function public._create_sale_staff(jsonb) from public, anon, authenticated;

create or replace function public.create_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_order uuid := nullif(p->>'order_id', '')::uuid;
  v_sale jsonb;
  v_sale_id uuid;
  it jsonb;
  i public.order_items%rowtype;
  v_qty numeric;
  v_new boolean;
begin
  if v_order is null then
    return public._create_sale_staff(p);
  end if;
  if v_business is null then
    raise exception 'Nuk ke biznes aktiv' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = v_order and business_id = v_business for update;
  if not found then
    raise exception 'Porosia nuk u gjet' using errcode = 'P0002';
  end if;
  -- An already stored sale (offline replay) is returned as it is.
  v_new := not exists (select 1 from public.sales where business_id = v_business and client_id = nullif(p->>'client_id', '')::uuid);
  if v_new then
    for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
      continue when it->>'order_item_id' is null or coalesce((it->>'addon')::boolean, false);
      select * into i from public.order_items where id = (it->>'order_item_id')::uuid and order_id = v_order for update;
      if not found or i.status = 'cancelled' then
        raise exception 'Rreshti i porosisë nuk u gjet' using errcode = 'P0002';
      end if;
      v_qty := coalesce((it->>'quantity')::numeric, 0);
      if v_qty <= 0 or v_qty > i.quantity - i.paid_qty then
        raise exception '"%" është paguar tashmë', i.name using errcode = '22023';
      end if;
    end loop;
  end if;

  v_sale := public._create_sale_staff(p);
  v_sale_id := (v_sale->>'id')::uuid;

  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    continue when it->>'order_item_id' is null or coalesce((it->>'addon')::boolean, false);
    insert into public.order_payments (sale_id, order_item_id, business_id, quantity)
    values (v_sale_id, (it->>'order_item_id')::uuid, v_business, (it->>'quantity')::numeric)
    on conflict do nothing;
  end loop;
  update public.order_items oi set paid_qty = (select coalesce(sum(op.quantity), 0) from public.order_payments op where op.order_item_id = oi.id)
    where oi.order_id = v_order;
  if not exists (select 1 from public.order_items where order_id = v_order and status <> 'cancelled' and quantity > paid_qty) then
    update public.orders set status = 'paid', closed_at = coalesce(closed_at, now()) where id = v_order and status = 'open';
  end if;
  return v_sale;
end $$;

-- ---------------------------------------------------------------------
-- Modifiers. p: { product_id, groups: [{name, multi?, required?, options: [{name, price?}]}] }
-- Priced options get a hidden add-on product ("+ Bajame") sold as its own line.
-- ---------------------------------------------------------------------
create or replace function public.save_modifiers(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
  prod public.products%rowtype;
  g jsonb;
  o jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_opts jsonb;
  v_price numeric;
  v_addon uuid;
  v_keep uuid[] := '{}';
  v_name text;
begin
  select * into prod from public.products where id = nullif(p->>'product_id', '')::uuid and business_id = v_business for update;
  if not found or prod.addon_of is not null then
    raise exception 'Artikulli nuk u gjet' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p->'groups', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p->'groups', '[]'::jsonb)) > 10 then
    raise exception 'Deri në 10 grupe' using errcode = '22023';
  end if;
  for g in select * from jsonb_array_elements(coalesce(p->'groups', '[]'::jsonb)) loop
    continue when nullif(trim(coalesce(g->>'name', '')), '') is null;
    v_opts := '[]'::jsonb;
    for o in select * from jsonb_array_elements(coalesce(g->'options', '[]'::jsonb)) limit 20 loop
      v_name := left(trim(coalesce(o->>'name', '')), 40);
      continue when v_name = '';
      v_price := round(greatest(coalesce((o->>'price')::numeric, 0), 0), 2);
      v_addon := null;
      if v_price > 0 then
        select id into v_addon from public.products where addon_of = prod.id and name = '+ ' || v_name;
        if v_addon is null then
          insert into public.products (business_id, kind, name, category_id, unit, sale_price, vat_code, atk_type, show_in_pos, addon_of)
          values (v_business, 'service', '+ ' || v_name, prod.category_id, 'cope', v_price, prod.vat_code, prod.atk_type, false, prod.id)
          returning id into v_addon;
        else
          update public.products set sale_price = v_price, vat_code = prod.vat_code, active = true, updated_at = now() where id = v_addon;
        end if;
        v_keep := v_keep || v_addon;
      end if;
      v_opts := v_opts || jsonb_strip_nulls(jsonb_build_object('name', v_name, 'price', v_price, 'product_id', v_addon));
    end loop;
    v_groups := v_groups || jsonb_build_object('name', left(trim(g->>'name'), 40),
                  'multi', coalesce((g->>'multi')::boolean, false), 'required', coalesce((g->>'required')::boolean, false),
                  'options', v_opts);
  end loop;
  update public.products set active = false, updated_at = now() where addon_of = prod.id and active and not id = any (v_keep);
  update public.products set modifiers = v_groups, updated_at = now() where id = prod.id;
  return v_groups;
end $$;

-- ---------------------------------------------------------------------
-- Recipes. p: { product_id, items: [{ingredient_id, quantity}] } – quantity per 1 dish.
-- One level: an ingredient cannot have a recipe itself.
-- ---------------------------------------------------------------------
create or replace function public.save_recipe(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
  prod public.products%rowtype;
  r jsonb;
  ing public.products%rowtype;
  v_qty numeric;
  v_cost numeric;
begin
  select * into prod from public.products where id = nullif(p->>'product_id', '')::uuid and business_id = v_business for update;
  if not found or prod.kind <> 'product' then
    raise exception 'Artikulli nuk u gjet' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.recipe_items where ingredient_id = prod.id) then
    raise exception '"%" është përbërës në një recetë tjetër', prod.name using errcode = '22023';
  end if;
  delete from public.recipe_items where product_id = prod.id;
  for r in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    select * into ing from public.products where id = nullif(r->>'ingredient_id', '')::uuid and business_id = v_business;
    if not found or ing.kind <> 'product' or ing.id = prod.id then
      raise exception 'Përbërësi nuk u gjet' using errcode = 'P0002';
    end if;
    if ing.has_recipe then
      raise exception '"%" ka recetë vetë – përbërësi duhet të jetë mall me stok', ing.name using errcode = '22023';
    end if;
    v_qty := round(coalesce((r->>'quantity')::numeric, 0), 3);
    if v_qty <= 0 then
      raise exception 'Sasia e "%" duhet të jetë më e madhe se 0', ing.name using errcode = '22023';
    end if;
    insert into public.recipe_items (product_id, ingredient_id, business_id, quantity)
    values (prod.id, ing.id, v_business, v_qty)
    on conflict (product_id, ingredient_id) do update set quantity = recipe_items.quantity + excluded.quantity;
  end loop;
  update public.products set has_recipe = exists (select 1 from public.recipe_items where product_id = prod.id), updated_at = now()
    where id = prod.id;
  -- dish cost = ingredients' cost
  select coalesce(round(sum(ri.quantity * coalesce(pc.purchase_price, 0)), 4), 0) into v_cost
  from public.recipe_items ri left join public.product_costs pc on pc.product_id = ri.ingredient_id
  where ri.product_id = prod.id;
  if exists (select 1 from public.recipe_items where product_id = prod.id) then
    insert into public.product_costs (product_id, business_id, purchase_price, updated_at)
    values (prod.id, v_business, v_cost, now())
    on conflict (product_id) do update set purchase_price = excluded.purchase_price, updated_at = now();
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'recipe_change', 'product', prod.id::text,
          jsonb_build_object('name', prod.name, 'ingredients', jsonb_array_length(coalesce(p->'items', '[]'::jsonb)), 'cost', v_cost));
  return jsonb_build_object('cost', v_cost, 'items', (select coalesce(jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'quantity', quantity)), '[]'::jsonb) from public.recipe_items where product_id = prod.id));
end $$;

-- A dish with a recipe moves its ingredients (sale, void, refund).
create or replace function public._move_stock(p_business uuid, p_product uuid, p_qty numeric, p_kind text, p_sale uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after numeric;
  r record;
begin
  if exists (select 1 from public.products where id = p_product and has_recipe) then
    for r in select ingredient_id, quantity from public.recipe_items where product_id = p_product loop
      perform public._move_stock(p_business, r.ingredient_id, round(p_qty * r.quantity, 3), p_kind, p_sale);
    end loop;
    return;
  end if;
  update public.products set stock = stock + p_qty, updated_at = now()
    where id = p_product and business_id = p_business and kind = 'product'
    returning stock into v_after;
  if found then
    insert into public.stock_movements (business_id, product_id, kind, quantity, stock_after, ref_type, ref_id, worker_id)
    values (p_business, p_product, p_kind, p_qty, v_after, 'sale', p_sale::text, auth.uid());
  end if;
end $$;
revoke execute on function public._move_stock(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;

revoke execute on function public.order_json(uuid), public.save_tables(jsonb), public.open_order(jsonb),
  public.add_order_items(jsonb), public.set_order_item(jsonb), public.send_order(jsonb), public.set_ticket(jsonb),
  public.cancel_order_item(jsonb), public.move_order(jsonb), public.cancel_order(jsonb), public.create_sale(jsonb),
  public.save_modifiers(jsonb), public.save_recipe(jsonb) from public, anon;
grant execute on function public.order_json(uuid), public.save_tables(jsonb), public.open_order(jsonb),
  public.add_order_items(jsonb), public.set_order_item(jsonb), public.send_order(jsonb), public.set_ticket(jsonb),
  public.cancel_order_item(jsonb), public.move_order(jsonb), public.cancel_order(jsonb), public.create_sale(jsonb),
  public.save_modifiers(jsonb), public.save_recipe(jsonb) to authenticated;
