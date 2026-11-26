-- =====================================================================
-- 0056 – Prices and quantities with up to 4 decimals (ATK, testimi teknik 21.01.2027: "çmime dhe sasi të
-- produkteve me 2 dhe 4 numra pas presjes dhjetore").
--   • Sale price of a product and unit price of a sale / order line: 4 decimals (was 2).
--   • Quantities: 4 decimals (was 3); _unit_decimals gives 4 to every unit that is not counted in whole pieces
--     (kg, kg bruto, ton, metre, m², m³, km, m/s², kWh, hour, work hour); copë, pako, litër… stay whole.
--   • Line totals, discounts, payments, VAT and every coupon total stay with 2 decimals:
--     line total = round(quantity × price, 2), as before.
-- Existing data does not change (2.50 stays 2.5000). Older clients keep working: they send 2-decimal prices
-- and whole / 3-decimal quantities, which still fit.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.products          alter column sale_price type numeric(14, 4),
                                     alter column stock      type numeric(14, 4),
                                     alter column min_stock  type numeric(14, 4);
alter table public.sale_items        alter column unit_price type numeric(14, 4),
                                     alter column quantity   type numeric(14, 4);
alter table public.stock_movements   alter column quantity    type numeric(14, 4),
                                     alter column stock_after type numeric(14, 4);
alter table public.order_items       alter column unit_price type numeric(14, 4),
                                     alter column quantity   type numeric(14, 4),
                                     alter column paid_qty   type numeric(14, 4);
alter table public.order_payments    alter column quantity type numeric(14, 4);
alter table public.stock_entry_items alter column quantity type numeric(14, 4);
alter table public.product_lots      alter column quantity type numeric(14, 4);
alter table public.lot_movements     alter column quantity type numeric(14, 4);
alter table public.recipe_items      alter column quantity type numeric(14, 4);

-- ---------------------------------------------------------------------
-- 2. Rounding of quantities by unit
-- ---------------------------------------------------------------------
create or replace function public._unit_decimals(p_unit text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_unit in ('kg', 'kgb', 'tn', 'lm', 'mts', 'mtv', 'kmt', 'msk', 'kwh', 'hur', 'op') then 4
    else 0
  end
$$;

-- ---------------------------------------------------------------------
-- 3. Prices rounded to 4 decimals in the functions (each change must be found, or the migration stops)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('public.save_product(jsonb)',
       'v_sale numeric := round(coalesce((p->>''sale_price'')::numeric, 0), 2);',
       'v_sale numeric := round(coalesce((p->>''sale_price'')::numeric, 0), 4);'),
      -- the price of an offline sale rung up with an older price (three places in the function)
      ('public._create_sale_core(jsonb)',
       'round((it->>''unit_price'')::numeric, 2)',
       'round((it->>''unit_price'')::numeric, 4)'),
      ('public.add_order_items(jsonb)',
       'values (o.id, v_business, prod.id, prod.name, round(v_price, 2), v_qty,',
       'values (o.id, v_business, prod.id, prod.name, round(v_price, 4), v_qty,'),
      ('public._move_stock(uuid,uuid,numeric,text,uuid)',
       'round(p_qty * r.quantity, 3)',
       'round(p_qty * r.quantity, 4)'),
      ('public.save_recipe(jsonb)',
       'v_qty := round(coalesce((r->>''quantity'')::numeric, 0), 3);',
       'v_qty := round(coalesce((r->>''quantity'')::numeric, 0), 4);')
    ) t(fn, old, new)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.old in v_def) = 0 then
      raise exception '0056: % does not contain the expected rounding (%)', r.fn, r.old;
    end if;
    execute replace(v_def, r.old, r.new);
  end loop;
end $$;
