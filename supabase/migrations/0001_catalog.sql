-- =====================================================================
-- 0001 – Catalog (phase 2): categories, products & services, purchase prices,
-- stock movements (initial stock only for now), internal barcodes, Excel import.
--
-- Security:
--   * workers can read products (for the till) but NOT purchase prices (product_costs is manager-only)
--   * products / costs / stock change only through security-definer RPCs
--   * every price change is written to audit_log
-- =====================================================================

-- Counter for internal EAN-13 barcodes (prefix 20 = in-store use)
alter table public.businesses add column if not exists barcode_counter bigint not null default 0;

-- ---------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
              references public.businesses (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  sort        int not null default 0,
  atk_type    text,                       -- default ATK item type for products in this category
  created_at  timestamptz not null default now()
);
create unique index if not exists categories_name_uq on public.categories (business_id, lower(name));

-- ---------------------------------------------------------------------
-- Products & services
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null default public.current_business_id()
               references public.businesses (id) on delete cascade,
  kind         text not null default 'product' check (kind in ('product', 'service')),
  name         text not null check (length(trim(name)) > 0),
  barcode      text,
  category_id  uuid references public.categories (id) on delete set null,
  unit         text not null default 'cope' check (unit in ('cope', 'kg', 'pako', 'liter')),
  sale_price   numeric(12, 2) not null default 0 check (sale_price >= 0),   -- VAT included
  vat_code     char(1) not null default 'E' check (vat_code in ('E', 'D', 'C', 'A')),
  stock        numeric(14, 3) not null default 0,                           -- changed only by RPC
  min_stock    numeric(14, 3) not null default 0 check (min_stock >= 0),
  duration_min int check (duration_min is null or duration_min between 1 and 1440),  -- services
  substance    text,                                                         -- pharmacy (active substance)
  atk_type     text not null default 'TT',                                   -- ATK item type
  show_in_pos  boolean not null default true,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id)
);
create index if not exists products_business_idx on public.products (business_id, active);
create unique index if not exists products_barcode_uq on public.products (business_id, barcode)
  where barcode is not null and active;

-- Purchase prices are kept apart so workers never see them.
create table if not exists public.product_costs (
  product_id     uuid primary key references public.products (id) on delete cascade,
  business_id    uuid not null default public.current_business_id()
                 references public.businesses (id) on delete cascade,
  purchase_price numeric(12, 4) not null default 0 check (purchase_price >= 0),  -- VAT included
  updated_at     timestamptz not null default now()
);
create index if not exists product_costs_business_idx on public.product_costs (business_id);

-- ---------------------------------------------------------------------
-- Stock movements (append-only). Phase 2 writes only 'initial'; phase 4 adds the rest.
-- ---------------------------------------------------------------------
create table if not exists public.stock_movements (
  id          bigint generated always as identity primary key,
  business_id uuid not null default public.current_business_id()
              references public.businesses (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  kind        text not null check (kind in ('initial', 'entry', 'sale', 'void', 'refund', 'adjustment', 'inventory')),
  quantity    numeric(14, 3) not null,          -- + in, - out
  stock_after numeric(14, 3) not null,
  ref_type    text,
  ref_id      text,
  note        text,
  worker_id   uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index if not exists stock_movements_business_idx on public.stock_movements (business_id, created_at desc);

drop trigger if exists stock_movements_immutable on public.stock_movements;
create trigger stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.categories      enable row level security;
alter table public.products        enable row level security;
alter table public.product_costs   enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated using (business_id = public.current_business_id());
drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories
  for insert to authenticated with check (business_id = public.current_business_id() and public.is_manager());
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories
  for update to authenticated
  using (business_id = public.current_business_id() and public.is_manager())
  with check (business_id = public.current_business_id() and public.is_manager());
drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories
  for delete to authenticated using (business_id = public.current_business_id() and public.is_manager());

drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select to authenticated using (business_id = public.current_business_id());
revoke insert, update, delete on public.products from anon, authenticated;

drop policy if exists product_costs_select on public.product_costs;
create policy product_costs_select on public.product_costs
  for select to authenticated using (business_id = public.current_business_id() and public.is_manager());
revoke insert, update, delete on public.product_costs from anon, authenticated;

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
  for select to authenticated using (business_id = public.current_business_id() and public.is_manager());
revoke insert, update, delete on public.stock_movements from anon, authenticated;

revoke all on public.categories, public.products, public.product_costs, public.stock_movements from anon;

-- ---------------------------------------------------------------------
-- Internal barcode: EAN-13, prefix "20", 10-digit counter, check digit
-- ---------------------------------------------------------------------
create or replace function public.ean13_check_digit(p_12 text)
returns int
language sql
immutable
set search_path = ''
as $$
  select (10 - (sum((substr(p_12, i, 1))::int * case when i % 2 = 0 then 3 else 1 end) % 10)) % 10
  from generate_series(1, 12) as i
$$;

create or replace function public.next_internal_barcode()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_n bigint;
  v_code text;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  loop
    update public.businesses set barcode_counter = barcode_counter + 1
      where id = v_business returning barcode_counter into v_n;
    v_code := '20' || lpad(v_n::text, 10, '0');
    v_code := v_code || public.ean13_check_digit(v_code)::text;
    exit when not exists (select 1 from public.products where business_id = v_business and barcode = v_code);
  end loop;
  return v_code;
end $$;

-- ---------------------------------------------------------------------
-- save_product: create or update a product/service (+ purchase price, initial stock)
-- p jsonb: { id?, kind, name, barcode?, category_id?, unit, sale_price, purchase_price?, vat_code,
--            min_stock?, initial_stock?, duration_min?, substance?, atk_type?, show_in_pos? }
-- ---------------------------------------------------------------------
create or replace function public.save_product(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.products%rowtype;
  v_old_cost numeric;
  v_kind text := coalesce(nullif(p->>'kind', ''), 'product');
  v_barcode text := nullif(trim(coalesce(p->>'barcode', '')), '');
  v_cat uuid := nullif(p->>'category_id', '')::uuid;
  v_sale numeric := round(coalesce((p->>'sale_price')::numeric, 0), 2);
  v_cost numeric := round(coalesce((p->>'purchase_price')::numeric, 0), 4);
  v_initial numeric := coalesce((p->>'initial_stock')::numeric, 0);
  v_unit text := coalesce(nullif(p->>'unit', ''), 'cope');
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri mund të ndryshojë produktet' using errcode = '42501';
  end if;
  if length(trim(coalesce(p->>'name', ''))) = 0 then
    raise exception 'Shkruaj emrin' using errcode = '22023';
  end if;
  if v_cat is not null and not exists (select 1 from public.categories where id = v_cat and business_id = v_business) then
    raise exception 'Kategoria nuk u gjet' using errcode = '22023';
  end if;
  if v_barcode is not null and exists (
    select 1 from public.products
    where business_id = v_business and barcode = v_barcode and active and id is distinct from v_id
  ) then
    raise exception 'Ky barkod është te një produkt tjetër' using errcode = '23505';
  end if;
  if v_kind = 'service' then
    v_unit := 'cope';
    v_initial := 0;
  end if;
  if v_unit <> 'kg' then
    v_initial := trunc(v_initial);
  end if;

  if v_id is null then
    insert into public.products (
      business_id, kind, name, barcode, category_id, unit, sale_price, vat_code, min_stock,
      duration_min, substance, atk_type, show_in_pos, created_by
    ) values (
      v_business, v_kind, trim(p->>'name'), v_barcode, v_cat, v_unit, v_sale,
      coalesce(nullif(p->>'vat_code', ''), 'E'),
      case when v_kind = 'service' then 0 else coalesce((p->>'min_stock')::numeric, 0) end,
      case when v_kind = 'service' then nullif(p->>'duration_min', '')::int end,
      nullif(trim(coalesce(p->>'substance', '')), ''),
      coalesce(nullif(p->>'atk_type', ''), 'TT'),
      coalesce((p->>'show_in_pos')::boolean, true),
      auth.uid()
    ) returning id into v_id;

    insert into public.product_costs (product_id, business_id, purchase_price) values (v_id, v_business, v_cost);

    if v_initial <> 0 then
      update public.products set stock = v_initial where id = v_id;
      insert into public.stock_movements (business_id, product_id, kind, quantity, stock_after, note, worker_id)
      values (v_business, v_id, 'initial', v_initial, v_initial, 'Stoku fillestar', auth.uid());
    end if;

    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (v_business, auth.uid(), 'product_create', 'product', v_id::text,
            jsonb_build_object('name', trim(p->>'name'), 'sale_price', v_sale, 'purchase_price', v_cost));
    return v_id;
  end if;

  select * into v_old from public.products where id = v_id and business_id = v_business for update;
  if not found then
    raise exception 'Produkti nuk u gjet' using errcode = 'P0002';
  end if;
  select purchase_price into v_old_cost from public.product_costs where product_id = v_id;

  update public.products set
    kind = v_kind,
    name = trim(p->>'name'),
    barcode = v_barcode,
    category_id = v_cat,
    unit = v_unit,
    sale_price = v_sale,
    vat_code = coalesce(nullif(p->>'vat_code', ''), vat_code),
    min_stock = case when v_kind = 'service' then 0 else coalesce((p->>'min_stock')::numeric, min_stock) end,
    duration_min = case when v_kind = 'service' then nullif(p->>'duration_min', '')::int end,
    substance = nullif(trim(coalesce(p->>'substance', '')), ''),
    atk_type = coalesce(nullif(p->>'atk_type', ''), atk_type),
    show_in_pos = coalesce((p->>'show_in_pos')::boolean, show_in_pos),
    updated_at = now()
  where id = v_id;

  if p ? 'purchase_price' then
    insert into public.product_costs (product_id, business_id, purchase_price, updated_at)
    values (v_id, v_business, v_cost, now())
    on conflict (product_id) do update set purchase_price = excluded.purchase_price, updated_at = now();
  end if;

  if v_old.sale_price is distinct from v_sale
     or (p ? 'purchase_price' and v_old_cost is distinct from v_cost)
     or v_old.vat_code is distinct from coalesce(nullif(p->>'vat_code', ''), v_old.vat_code) then
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (v_business, auth.uid(), 'price_change', 'product', v_id::text, jsonb_build_object(
      'name', trim(p->>'name'),
      'sale_price', jsonb_build_array(v_old.sale_price, v_sale),
      'purchase_price', jsonb_build_array(v_old_cost, case when p ? 'purchase_price' then v_cost else v_old_cost end),
      'vat_code', jsonb_build_array(v_old.vat_code, coalesce(nullif(p->>'vat_code', ''), v_old.vat_code))
    ));
  else
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (v_business, auth.uid(), 'product_update', 'product', v_id::text, jsonb_build_object('name', trim(p->>'name')));
  end if;
  return v_id;
end $$;

-- Archive / restore (products are never deleted – sales will reference them)
create or replace function public.set_product_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_barcode text;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  select barcode into v_barcode from public.products where id = p_id and business_id = v_business;
  if not found then
    raise exception 'Produkti nuk u gjet' using errcode = 'P0002';
  end if;
  if p_active and v_barcode is not null and exists (
    select 1 from public.products where business_id = v_business and barcode = v_barcode and active and id <> p_id
  ) then
    raise exception 'Ky barkod tani është te një produkt tjetër' using errcode = '23505';
  end if;
  update public.products set active = p_active, updated_at = now() where id = p_id;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), case when p_active then 'product_restore' else 'product_archive' end, 'product', p_id::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- import_products: rows from Excel. Matches existing products by barcode (else by exact name),
-- creates missing categories. Returns { created, updated }.
-- row: { name, barcode?, category?, unit?, sale_price, purchase_price?, vat_code?, min_stock?, stock?, kind?, duration_min? }
-- ---------------------------------------------------------------------
create or replace function public.import_products(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  r jsonb;
  v_cat uuid;
  v_existing uuid;
  v_payload jsonb;
  v_created int := 0;
  v_updated int := 0;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Deri në 5000 rreshta për import' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_cat := null;
    if length(trim(coalesce(r->>'category', ''))) > 0 then
      select id into v_cat from public.categories
        where business_id = v_business and lower(name) = lower(trim(r->>'category'));
      if v_cat is null then
        insert into public.categories (business_id, name) values (v_business, trim(r->>'category')) returning id into v_cat;
      end if;
    end if;

    v_existing := null;
    if length(trim(coalesce(r->>'barcode', ''))) > 0 then
      select id into v_existing from public.products
        where business_id = v_business and barcode = trim(r->>'barcode') and active;
    end if;
    if v_existing is null then
      select id into v_existing from public.products
        where business_id = v_business and active and lower(name) = lower(trim(r->>'name'))
        limit 1;
    end if;

    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'id', v_existing,
      'kind', coalesce(r->>'kind', 'product'),
      'name', r->>'name',
      'barcode', r->>'barcode',
      'category_id', v_cat,
      'unit', r->>'unit',
      'sale_price', r->'sale_price',
      'purchase_price', r->'purchase_price',
      'vat_code', r->>'vat_code',
      'min_stock', r->'min_stock',
      'duration_min', r->'duration_min',
      'initial_stock', case when v_existing is null then r->'stock' end
    ));
    perform public.save_product(v_payload);
    if v_existing is null then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
  end loop;

  insert into public.audit_log (business_id, user_id, action, entity, details)
  values (v_business, auth.uid(), 'products_import', 'product',
          jsonb_build_object('created', v_created, 'updated', v_updated));
  return jsonb_build_object('created', v_created, 'updated', v_updated);
end $$;

revoke execute on function public.next_internal_barcode() from public, anon;
revoke execute on function public.save_product(jsonb) from public, anon;
revoke execute on function public.set_product_active(uuid, boolean) from public, anon;
revoke execute on function public.import_products(jsonb) from public, anon;
grant execute on function public.next_internal_barcode() to authenticated;
grant execute on function public.save_product(jsonb) to authenticated;
grant execute on function public.set_product_active(uuid, boolean) to authenticated;
grant execute on function public.import_products(jsonb) to authenticated;
