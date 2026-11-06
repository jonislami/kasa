-- =====================================================================
-- 0009 – Boutique variants (phase 8b): size × colour, each with its own barcode and stock.
-- Run after 0001–0008.
--
-- A model ("Xhinse slim fit") is a product with has_variants = true; every size × colour is a
-- child product (parent_id) named "Xhinse slim fit · Blu e errët · 30/32". Children are what is
-- sold, received, counted and refunded – so sales, stock, inventory and reports need no change.
--   * price, VAT, category, unit, ATK type and purchase price follow the model (trigger)
--   * a model itself cannot be sold (create_sale asks for a size and colour)
--   * internal EAN-13 barcodes are generated for new variants
-- =====================================================================

alter table public.products add column if not exists parent_id uuid references public.products (id) on delete cascade;
alter table public.products add column if not exists has_variants boolean not null default false;
alter table public.products add column if not exists variant_size text;
alter table public.products add column if not exists variant_color text;
alter table public.products add column if not exists color_hex text check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$');
create index if not exists products_parent_idx on public.products (parent_id) where parent_id is not null;
create unique index if not exists products_variant_uq on public.products (parent_id, lower(coalesce(variant_size, '')), lower(coalesce(variant_color, '')))
  where parent_id is not null and active;

-- Size / colour order for the grid (as the owner entered them).
alter table public.products add column if not exists variant_sizes text[];
alter table public.products add column if not exists variant_colors jsonb;   -- [{ name, hex }]

-- ---------------------------------------------------------------------
-- Children follow the model (price, VAT, category, unit, ATK type, name, cost)
-- ---------------------------------------------------------------------
create or replace function public.products_variant_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.has_variants and (
       new.sale_price is distinct from old.sale_price or new.vat_code is distinct from old.vat_code
    or new.category_id is distinct from old.category_id or new.unit is distinct from old.unit
    or new.atk_type is distinct from old.atk_type or new.name is distinct from old.name
    or new.min_stock is distinct from old.min_stock) then
    update public.products c set
      sale_price = new.sale_price, vat_code = new.vat_code, category_id = new.category_id,
      unit = new.unit, atk_type = new.atk_type,
      name = new.name || coalesce(' · ' || c.variant_color, '') || coalesce(' · ' || c.variant_size, ''),
      updated_at = now()
    where c.parent_id = new.id;
  end if;
  if new.has_variants and new.active is distinct from old.active and not new.active then
    update public.products set active = false, updated_at = now() where parent_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists products_variant_sync on public.products;
create trigger products_variant_sync after update on public.products
  for each row execute function public.products_variant_sync();

create or replace function public.product_costs_variant_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.products where id = new.product_id and has_variants) then
    insert into public.product_costs (product_id, business_id, purchase_price, updated_at)
    select c.id, c.business_id, new.purchase_price, now() from public.products c where c.parent_id = new.product_id
    on conflict (product_id) do update set purchase_price = excluded.purchase_price, updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists product_costs_variant_sync on public.product_costs;
create trigger product_costs_variant_sync after insert or update of purchase_price on public.product_costs
  for each row execute function public.product_costs_variant_sync();

-- ---------------------------------------------------------------------
-- save_variants: sizes × colours of a model. Creates the missing combinations (with barcodes),
-- re-activates archived ones that are wanted again, archives combinations no longer wanted
-- (their sales and stock history stay). Returns the variants.
-- p: { product_id, sizes: ["S","M"], colors: [{ name: "E zezë", hex: "#111111" }] }
-- ---------------------------------------------------------------------
create or replace function public.save_variants(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_id uuid := nullif(p->>'product_id', '')::uuid;
  m public.products%rowtype;
  v_cost numeric;
  s text;
  c jsonb;
  v_sizes text[];
  v_colors jsonb;
  v_child uuid;
  v_created int := 0;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  select * into m from public.products where id = v_id and business_id = v_business for update;
  if not found or m.parent_id is not null then
    raise exception 'Artikulli nuk u gjet' using errcode = 'P0002';
  end if;
  if m.kind = 'service' then
    raise exception 'Shërbimet nuk kanë variante' using errcode = '22023';
  end if;

  -- sizes and colours without duplicates, in the order the owner gave them
  select coalesce(array_agg(trim(x) order by ord) filter (where length(trim(x)) > 0), '{}') into v_sizes
    from (select distinct on (lower(trim(x))) x, ord from jsonb_array_elements_text(coalesce(p->'sizes', '[]'::jsonb)) with ordinality t(x, ord) order by lower(trim(x)), ord) u;
  select coalesce(jsonb_agg(jsonb_build_object('name', trim(e->>'name'), 'hex', nullif(e->>'hex', '')) order by ord), '[]'::jsonb) into v_colors
    from (select distinct on (lower(trim(e->>'name'))) e, ord from jsonb_array_elements(coalesce(p->'colors', '[]'::jsonb)) with ordinality t(e, ord)
          where length(trim(coalesce(e->>'name', ''))) > 0 order by lower(trim(e->>'name')), ord) u;

  if cardinality(v_sizes) = 0 and jsonb_array_length(v_colors) = 0 then
    raise exception 'Shto të paktën një madhësi ose një ngjyrë' using errcode = '22023';
  end if;
  if cardinality(v_sizes) * greatest(jsonb_array_length(v_colors), 1) > 400 then
    raise exception 'Deri në 400 variante për artikull' using errcode = '22023';
  end if;
  if not m.has_variants and m.stock <> 0 then
    raise exception 'Artikulli ka % në stok. Shkarkoje ose numëroje në 0 para se ta ndash në variante.', m.stock using errcode = '22023';
  end if;

  v_cost := coalesce((select purchase_price from public.product_costs where product_id = m.id), 0);

  -- archive the combinations that are no longer wanted
  update public.products ch set active = false, updated_at = now()
  where ch.parent_id = m.id and ch.active and not (
    (cardinality(v_sizes) = 0 or lower(coalesce(ch.variant_size, '')) in (select lower(x) from unnest(v_sizes) x))
    and (jsonb_array_length(v_colors) = 0 or lower(coalesce(ch.variant_color, '')) in (select lower(e->>'name') from jsonb_array_elements(v_colors) e))
  );

  for c in select * from jsonb_array_elements(case when jsonb_array_length(v_colors) = 0 then '[{"name":null}]'::jsonb else v_colors end) loop
    foreach s in array (case when cardinality(v_sizes) = 0 then array[null::text] else v_sizes end) loop
      select id into v_child from public.products
        where parent_id = m.id and lower(coalesce(variant_size, '')) = lower(coalesce(s, ''))
          and lower(coalesce(variant_color, '')) = lower(coalesce(c->>'name', ''))
        order by active desc limit 1;
      if v_child is not null then
        update public.products set active = true, color_hex = nullif(c->>'hex', ''), updated_at = now() where id = v_child;
      else
        insert into public.products (business_id, kind, name, barcode, category_id, unit, sale_price, vat_code, min_stock,
                                     atk_type, show_in_pos, parent_id, variant_size, variant_color, color_hex, created_by)
        values (v_business, 'product', m.name || coalesce(' · ' || (c->>'name'), '') || coalesce(' · ' || s, ''),
                public.next_internal_barcode(), m.category_id, m.unit, m.sale_price, m.vat_code, m.min_stock,
                m.atk_type, true, m.id, s, c->>'name', nullif(c->>'hex', ''), auth.uid())
        returning id into v_child;
        insert into public.product_costs (product_id, business_id, purchase_price) values (v_child, v_business, v_cost);
        v_created := v_created + 1;
      end if;
    end loop;
  end loop;

  update public.products set has_variants = true, variant_sizes = v_sizes, variant_colors = v_colors, updated_at = now() where id = m.id;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'variants_save', 'product', m.id::text,
          jsonb_build_object('name', m.name, 'sizes', to_jsonb(v_sizes), 'colors', v_colors, 'created', v_created));

  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'size', variant_size, 'color', variant_color, 'barcode', barcode, 'stock', stock)
                 order by variant_color, variant_size), '[]'::jsonb)
          from public.products where parent_id = m.id and active);
end $$;

-- A model is not sold itself.
create or replace function public.products_model_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_id is not null and exists (select 1 from public.products where id = new.product_id and has_variants) then
    raise exception 'Zgjidh madhësinë dhe ngjyrën e "%"', new.name using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists sale_items_model_guard on public.sale_items;
create trigger sale_items_model_guard before insert on public.sale_items
  for each row execute function public.products_model_guard();
drop trigger if exists stock_entry_items_model_guard on public.stock_entry_items;
create trigger stock_entry_items_model_guard before insert on public.stock_entry_items
  for each row execute function public.products_model_guard();

revoke execute on function public.save_variants(jsonb) from public, anon;
grant execute on function public.save_variants(jsonb) to authenticated;
