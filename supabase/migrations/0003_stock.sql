-- =====================================================================
-- 0003 – Stock (phase 4): suppliers, goods entries (draft → confirm), write-offs / adjustments,
-- inventory counts. Run after 0001 + 0002.
--
-- Security:
--   * everything here is manager-only (admin/manager); workers see none of it
--   * stock changes only through security-definer RPCs that write stock_movements
--   * confirmed entries and inventory counts are immutable (corrections = new movements)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
              references public.businesses (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  nui         text,
  vat_number  text,
  phone       text,
  email       text,
  address     text,
  note        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists suppliers_name_uq on public.suppliers (business_id, lower(name));

-- ---------------------------------------------------------------------
-- Goods entries (purchase invoices) – header + lines
-- ---------------------------------------------------------------------
create table if not exists public.stock_entries (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null default public.current_business_id()
                references public.businesses (id) on delete cascade,
  entry_no      bigint,                                   -- per business, set on confirm
  status        text not null default 'draft' check (status in ('draft', 'confirmed')),
  supplier_id   uuid references public.suppliers (id) on delete set null,
  invoice_no    text,                                     -- supplier's invoice number
  entry_date    date not null default current_date,
  payment       text not null default 'cash' check (payment in ('cash', 'bank', 'due')),
  due_days      int check (due_days is null or due_days between 1 and 365),
  note          text,
  items_count   int not null default 0,
  units_total   numeric(14, 3) not null default 0,
  total         numeric(14, 2) not null default 0,        -- VAT included
  net_total     numeric(14, 2) not null default 0,
  vat_total     numeric(14, 2) not null default 0,
  vat_lines     jsonb not null default '[]'::jsonb,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  confirmed_by  uuid references auth.users (id),
  confirmed_at  timestamptz
);
create index if not exists stock_entries_business_idx on public.stock_entries (business_id, created_at desc);
create unique index if not exists stock_entries_no_uq on public.stock_entries (business_id, entry_no) where entry_no is not null;

create table if not exists public.stock_entry_items (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.stock_entries (id) on delete cascade,
  business_id uuid not null default public.current_business_id()
              references public.businesses (id) on delete cascade,
  position    int not null,
  product_id  uuid not null references public.products (id),
  name        text not null,                            -- snapshot
  unit        text not null,
  vat_code    char(1) not null check (vat_code in ('E', 'D', 'C', 'A')),
  quantity    numeric(14, 3) not null check (quantity > 0),
  unit_cost   numeric(12, 4) not null check (unit_cost >= 0),   -- VAT included
  total       numeric(14, 2) not null
);
create index if not exists stock_entry_items_entry_idx on public.stock_entry_items (entry_id, position);

alter table public.businesses add column if not exists stock_entry_counter bigint not null default 0;

-- Confirmed entries are immutable (no client has write grants; this also stops definer code).
create or replace function public.stock_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'stock_entries' then
    if old.status = 'confirmed' then
      raise exception 'Hyrja e konfirmuar nuk ndryshohet' using errcode = '42501';
    end if;
  else
    if exists (select 1 from public.stock_entries e where e.id = coalesce(old.entry_id, new.entry_id) and e.status = 'confirmed') then
      raise exception 'Hyrja e konfirmuar nuk ndryshohet' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists stock_entries_guard on public.stock_entries;
create trigger stock_entries_guard before update or delete on public.stock_entries
  for each row execute function public.stock_entries_guard();
drop trigger if exists stock_entry_items_guard on public.stock_entry_items;
create trigger stock_entry_items_guard before insert or update or delete on public.stock_entry_items
  for each row execute function public.stock_entries_guard();

-- ---------------------------------------------------------------------
-- Inventory counts (confirmed in one step; drafts live on the device)
-- ---------------------------------------------------------------------
create table if not exists public.inventory_counts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null default public.current_business_id()
                references public.businesses (id) on delete cascade,
  count_no      bigint not null,
  title         text,                                   -- e.g. "Pije" or "I plotë"
  note          text,
  items_count   int not null default 0,
  diff_count    int not null default 0,                 -- lines with a difference
  value_diff    numeric(14, 2) not null default 0,      -- at purchase price
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now()
);
create index if not exists inventory_counts_business_idx on public.inventory_counts (business_id, created_at desc);

create table if not exists public.inventory_count_items (
  id          bigint generated always as identity primary key,
  count_id    uuid not null references public.inventory_counts (id) on delete cascade,
  business_id uuid not null default public.current_business_id()
              references public.businesses (id) on delete cascade,
  product_id  uuid not null references public.products (id),
  name        text not null,
  unit        text not null,
  expected    numeric(14, 3) not null,
  counted     numeric(14, 3) not null check (counted >= 0),
  diff        numeric(14, 3) not null,
  unit_cost   numeric(12, 4) not null default 0
);
create index if not exists inventory_count_items_count_idx on public.inventory_count_items (count_id);

alter table public.businesses add column if not exists inventory_counter bigint not null default 0;

drop trigger if exists inventory_counts_immutable on public.inventory_counts;
create trigger inventory_counts_immutable before update or delete on public.inventory_counts
  for each row execute function public.audit_log_immutable();
drop trigger if exists inventory_count_items_immutable on public.inventory_count_items;
create trigger inventory_count_items_immutable before update or delete on public.inventory_count_items
  for each row execute function public.audit_log_immutable();

-- Write-off reasons (stock_movements.kind = 'adjustment', reason kept in note/ref_type)
alter table public.stock_movements add column if not exists reason text
  check (reason is null or reason in ('damage', 'expired', 'loss', 'own_use', 'return_supplier', 'correction', 'other'));

-- ---------------------------------------------------------------------
-- RLS – manager only
-- ---------------------------------------------------------------------
alter table public.suppliers             enable row level security;
alter table public.stock_entries         enable row level security;
alter table public.stock_entry_items     enable row level security;
alter table public.inventory_counts      enable row level security;
alter table public.inventory_count_items enable row level security;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated using (business_id = public.current_business_id() and public.is_manager());
drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated with check (business_id = public.current_business_id() and public.is_manager());
drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());
revoke delete on public.suppliers from anon, authenticated;   -- archive with active = false

drop policy if exists stock_entries_select on public.stock_entries;
create policy stock_entries_select on public.stock_entries
  for select to authenticated using (business_id = public.current_business_id() and public.is_manager());
drop policy if exists stock_entry_items_select on public.stock_entry_items;
create policy stock_entry_items_select on public.stock_entry_items
  for select to authenticated using (business_id = public.current_business_id() and public.is_manager());
drop policy if exists inventory_counts_select on public.inventory_counts;
create policy inventory_counts_select on public.inventory_counts
  for select to authenticated using (business_id = public.current_business_id() and public.is_manager());
drop policy if exists inventory_count_items_select on public.inventory_count_items;
create policy inventory_count_items_select on public.inventory_count_items
  for select to authenticated using (business_id = public.current_business_id() and public.is_manager());

revoke insert, update, delete on public.stock_entries, public.stock_entry_items,
  public.inventory_counts, public.inventory_count_items from anon, authenticated;
revoke all on public.suppliers, public.stock_entries, public.stock_entry_items,
  public.inventory_counts, public.inventory_count_items from anon;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._require_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  return v_business;
end $$;

-- Applies a manual stock change (+/-) and writes the movement. Returns stock after.
create or replace function public._apply_stock(
  p_business uuid, p_product uuid, p_qty numeric, p_kind text, p_ref_type text, p_ref_id text,
  p_note text, p_reason text
)
returns numeric
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
  if not found then
    raise exception 'Produkti nuk u gjet ose është shërbim' using errcode = 'P0002';
  end if;
  insert into public.stock_movements (business_id, product_id, kind, quantity, stock_after, ref_type, ref_id, note, reason, worker_id)
  values (p_business, p_product, p_kind, p_qty, v_after, p_ref_type, p_ref_id, p_note, p_reason, auth.uid());
  return v_after;
end $$;

revoke execute on function public._require_manager() from public, anon, authenticated;
revoke execute on function public._apply_stock(uuid, uuid, numeric, text, text, text, text, text) from public, anon, authenticated;

-- Recomputes an entry's totals (VAT once per rate over that rate's gross).
create or replace function public._entry_totals(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'rate', rate, 'gross', gross, 'net', net, 'vat', gross - net) order by code), '[]'::jsonb)
  into v_lines
  from (
    select i.vat_code as code, public._vat_rate(i.vat_code) as rate, sum(i.total) as gross,
           round(sum(i.total) / (1 + public._vat_rate(i.vat_code)), 2) as net
    from public.stock_entry_items i where i.entry_id = p_entry
    group by i.vat_code
  ) t;

  update public.stock_entries e set
    items_count = (select count(*) from public.stock_entry_items where entry_id = p_entry),
    units_total = coalesce((select sum(quantity) from public.stock_entry_items where entry_id = p_entry), 0),
    total = coalesce((select sum((x->>'gross')::numeric) from jsonb_array_elements(v_lines) x), 0),
    net_total = coalesce((select sum((x->>'net')::numeric) from jsonb_array_elements(v_lines) x), 0),
    vat_total = coalesce((select sum((x->>'vat')::numeric) from jsonb_array_elements(v_lines) x), 0),
    vat_lines = v_lines,
    updated_at = now()
  where e.id = p_entry;
end $$;
revoke execute on function public._entry_totals(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- save_stock_entry: create or replace a DRAFT entry.
-- p: { id?, supplier_id?, invoice_no?, entry_date?, payment?, due_days?, note?,
--      items: [{ product_id, quantity, unit_cost }] }
-- ---------------------------------------------------------------------
create or replace function public.save_stock_entry(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_supplier uuid := nullif(p->>'supplier_id', '')::uuid;
  v_payment text := coalesce(nullif(p->>'payment', ''), 'cash');
  r jsonb;
  prod public.products%rowtype;
  v_pos int := 0;
  v_qty numeric;
  v_cost numeric;
begin
  if v_supplier is not null and not exists (select 1 from public.suppliers where id = v_supplier and business_id = v_business) then
    raise exception 'Furnitori nuk u gjet' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p->'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) > 1000 then
    raise exception 'Deri në 1000 rreshta për hyrje' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.stock_entries (business_id, supplier_id, invoice_no, entry_date, payment, due_days, note, created_by)
    values (
      v_business, v_supplier, nullif(trim(coalesce(p->>'invoice_no', '')), ''),
      coalesce(nullif(p->>'entry_date', '')::date, current_date), v_payment,
      case when v_payment = 'due' then coalesce(nullif(p->>'due_days', '')::int, 30) end,
      nullif(trim(coalesce(p->>'note', '')), ''), auth.uid()
    ) returning id into v_id;
  else
    perform 1 from public.stock_entries where id = v_id and business_id = v_business and status = 'draft' for update;
    if not found then
      raise exception 'Drafti nuk u gjet ose është konfirmuar' using errcode = 'P0002';
    end if;
    update public.stock_entries set
      supplier_id = v_supplier,
      invoice_no = nullif(trim(coalesce(p->>'invoice_no', '')), ''),
      entry_date = coalesce(nullif(p->>'entry_date', '')::date, entry_date),
      payment = v_payment,
      due_days = case when v_payment = 'due' then coalesce(nullif(p->>'due_days', '')::int, 30) end,
      note = nullif(trim(coalesce(p->>'note', '')), '')
    where id = v_id;
    delete from public.stock_entry_items where entry_id = v_id;
  end if;

  for r in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    select * into prod from public.products where id = nullif(r->>'product_id', '')::uuid and business_id = v_business;
    if not found then
      raise exception 'Produkti nuk u gjet' using errcode = 'P0002';
    end if;
    if prod.kind = 'service' then
      raise exception '"%" është shërbim dhe nuk ka stok', prod.name using errcode = '22023';
    end if;
    v_qty := coalesce((r->>'quantity')::numeric, 0);
    if prod.unit <> 'kg' then v_qty := trunc(v_qty); else v_qty := round(v_qty, 3); end if;
    v_cost := round(coalesce((r->>'unit_cost')::numeric, 0), 4);
    if v_qty <= 0 then
      raise exception 'Sasia e "%" duhet të jetë më e madhe se 0', prod.name using errcode = '22023';
    end if;
    if v_cost < 0 then
      raise exception 'Kosto e "%" nuk mund të jetë negative', prod.name using errcode = '22023';
    end if;
    v_pos := v_pos + 1;
    insert into public.stock_entry_items (entry_id, business_id, position, product_id, name, unit, vat_code, quantity, unit_cost, total)
    values (v_id, v_business, v_pos, prod.id, prod.name, prod.unit, prod.vat_code, v_qty, v_cost, round(v_qty * v_cost, 2));
  end loop;

  perform public._entry_totals(v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- confirm_stock_entry: adds stock, writes movements, updates purchase prices (last cost).
-- p: same as save_stock_entry (saved first) – returns the confirmed entry id.
-- ---------------------------------------------------------------------
create or replace function public.confirm_stock_entry(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
  v_id uuid;
  v_no bigint;
  i record;
  v_old_cost numeric;
  v_changed int := 0;
begin
  v_id := public.save_stock_entry(p);

  perform 1 from public.stock_entries where id = v_id for update;
  if (select items_count from public.stock_entries where id = v_id) = 0 then
    raise exception 'Shto të paktën një produkt' using errcode = '22023';
  end if;

  update public.businesses set stock_entry_counter = stock_entry_counter + 1
    where id = v_business returning stock_entry_counter into v_no;

  for i in select * from public.stock_entry_items where entry_id = v_id order by position loop
    perform public._apply_stock(v_business, i.product_id, i.quantity, 'entry', 'stock_entry', v_id::text, null, null);

    select purchase_price into v_old_cost from public.product_costs where product_id = i.product_id;
    if v_old_cost is distinct from i.unit_cost then
      insert into public.product_costs (product_id, business_id, purchase_price, updated_at)
      values (i.product_id, v_business, i.unit_cost, now())
      on conflict (product_id) do update set purchase_price = excluded.purchase_price, updated_at = now();
      insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
      values (v_business, auth.uid(), 'price_change', 'product', i.product_id::text, jsonb_build_object(
        'name', i.name, 'purchase_price', jsonb_build_array(v_old_cost, i.unit_cost), 'source', 'stock_entry', 'entry_no', v_no));
      v_changed := v_changed + 1;
    end if;
  end loop;

  -- The guard blocks updates of confirmed rows, so status changes last.
  update public.stock_entries set
    status = 'confirmed', entry_no = v_no, confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
  where id = v_id;

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  select v_business, auth.uid(), 'stock_entry_confirm', 'stock_entry', v_id::text,
         jsonb_build_object('entry_no', v_no, 'invoice_no', e.invoice_no, 'total', e.total,
                            'items', e.items_count, 'cost_changes', v_changed)
  from public.stock_entries e where e.id = v_id;
  return v_id;
end $$;

create or replace function public.delete_stock_entry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
begin
  delete from public.stock_entries where id = p_id and business_id = v_business and status = 'draft';
  if not found then
    raise exception 'Drafti nuk u gjet ose është konfirmuar' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- adjust_stock: write-off (damage, expiry, loss…) or correction.
-- p: { product_id, quantity (signed: − out, + in), reason, note? } → stock after
-- ---------------------------------------------------------------------
create or replace function public.adjust_stock(p jsonb)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
  prod public.products%rowtype;
  v_qty numeric := coalesce((p->>'quantity')::numeric, 0);
  v_reason text := coalesce(nullif(p->>'reason', ''), 'other');
  v_after numeric;
begin
  select * into prod from public.products where id = nullif(p->>'product_id', '')::uuid and business_id = v_business for update;
  if not found or prod.kind = 'service' then
    raise exception 'Produkti nuk u gjet ose është shërbim' using errcode = 'P0002';
  end if;
  if prod.unit <> 'kg' then v_qty := trunc(v_qty); else v_qty := round(v_qty, 3); end if;
  if v_qty = 0 then
    raise exception 'Shkruaj sasinë' using errcode = '22023';
  end if;
  if v_reason not in ('damage', 'expired', 'loss', 'own_use', 'return_supplier', 'correction', 'other') then
    raise exception 'Arsyeja nuk njihet' using errcode = '22023';
  end if;
  if v_reason <> 'correction' and v_qty > 0 then
    raise exception 'Shkarkimi e zvogëlon stokun – sasia duhet të jetë negative' using errcode = '22023';
  end if;

  v_after := public._apply_stock(v_business, prod.id, v_qty, 'adjustment', 'adjustment', null,
                                 nullif(trim(coalesce(p->>'note', '')), ''), v_reason);

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'stock_adjust', 'product', prod.id::text, jsonb_build_object(
    'name', prod.name, 'quantity', v_qty, 'reason', v_reason, 'stock_after', v_after,
    'value', round(v_qty * coalesce((select purchase_price from public.product_costs where product_id = prod.id), 0), 2)));
  return v_after;
end $$;

-- ---------------------------------------------------------------------
-- confirm_inventory: counted quantities → movements for the differences.
-- p: { title?, note?, items: [{ product_id, counted }] } → { id, count_no, diff_count, value_diff }
-- ---------------------------------------------------------------------
create or replace function public.confirm_inventory(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
  v_id uuid := gen_random_uuid();
  v_no bigint;
  v_rows jsonb;
  c jsonb;
  v_items int;
  v_diffs int;
  v_value numeric;
begin
  if jsonb_typeof(coalesce(p->'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then
    raise exception 'Numëro të paktën një produkt' using errcode = '22023';
  end if;
  if jsonb_array_length(p->'items') > 10000 then
    raise exception 'Deri në 10000 produkte për inventarizim' using errcode = '22023';
  end if;
  if (select count(distinct x->>'product_id') from jsonb_array_elements(p->'items') x) <> jsonb_array_length(p->'items') then
    raise exception 'I njëjti produkt është dy herë në listë' using errcode = '22023';
  end if;

  -- Lock the products, then read their stock (expected) and cost.
  perform 1 from public.products
    where business_id = v_business
      and id in (select nullif(x->>'product_id', '')::uuid from jsonb_array_elements(p->'items') x)
    for update;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', pr.id, 'name', pr.name, 'unit', pr.unit, 'expected', pr.stock,
           'counted', case when pr.unit = 'kg' then round((x->>'counted')::numeric, 3) else trunc((x->>'counted')::numeric) end,
           'unit_cost', coalesce(pc.purchase_price, 0)) order by pr.name), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(p->'items') x
  join public.products pr on pr.id = nullif(x->>'product_id', '')::uuid
                         and pr.business_id = v_business and pr.kind = 'product'
  left join public.product_costs pc on pc.product_id = pr.id;

  if jsonb_array_length(v_rows) <> jsonb_array_length(p->'items') then
    raise exception 'Disa produkte nuk u gjetën' using errcode = 'P0002';
  end if;
  if exists (select 1 from jsonb_array_elements(v_rows) r where r->'counted' = 'null'::jsonb or (r->>'counted')::numeric < 0) then
    raise exception 'Sasia e numëruar duhet të jetë 0 ose më shumë' using errcode = '22023';
  end if;

  select count(*),
         count(*) filter (where (r->>'counted')::numeric <> (r->>'expected')::numeric),
         coalesce(round(sum(((r->>'counted')::numeric - (r->>'expected')::numeric) * (r->>'unit_cost')::numeric), 2), 0)
  into v_items, v_diffs, v_value
  from jsonb_array_elements(v_rows) r;

  update public.businesses set inventory_counter = inventory_counter + 1
    where id = v_business returning inventory_counter into v_no;
  insert into public.inventory_counts (id, business_id, count_no, title, note, items_count, diff_count, value_diff, created_by)
  values (v_id, v_business, v_no, nullif(trim(coalesce(p->>'title', '')), ''), nullif(trim(coalesce(p->>'note', '')), ''),
          v_items, v_diffs, v_value, auth.uid());

  for c in select * from jsonb_array_elements(v_rows) loop
    insert into public.inventory_count_items (count_id, business_id, product_id, name, unit, expected, counted, diff, unit_cost)
    values (v_id, v_business, (c->>'product_id')::uuid, c->>'name', c->>'unit', (c->>'expected')::numeric,
            (c->>'counted')::numeric, (c->>'counted')::numeric - (c->>'expected')::numeric, (c->>'unit_cost')::numeric);
    if (c->>'counted')::numeric <> (c->>'expected')::numeric then
      perform public._apply_stock(v_business, (c->>'product_id')::uuid,
        (c->>'counted')::numeric - (c->>'expected')::numeric, 'inventory', 'inventory', v_id::text, null, null);
    end if;
  end loop;

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'inventory_confirm', 'inventory', v_id::text,
          jsonb_build_object('count_no', v_no, 'items', v_items, 'differences', v_diffs, 'value_diff', v_value));
  return jsonb_build_object('id', v_id, 'count_no', v_no, 'items_count', v_items, 'diff_count', v_diffs, 'value_diff', v_value);
end $$;

revoke execute on function public.save_stock_entry(jsonb) from public, anon;
revoke execute on function public.confirm_stock_entry(jsonb) from public, anon;
revoke execute on function public.delete_stock_entry(uuid) from public, anon;
revoke execute on function public.adjust_stock(jsonb) from public, anon;
revoke execute on function public.confirm_inventory(jsonb) from public, anon;
grant execute on function public.save_stock_entry(jsonb) to authenticated;
grant execute on function public.confirm_stock_entry(jsonb) to authenticated;
grant execute on function public.delete_stock_entry(uuid) to authenticated;
grant execute on function public.adjust_stock(jsonb) to authenticated;
grant execute on function public.confirm_inventory(jsonb) to authenticated;
