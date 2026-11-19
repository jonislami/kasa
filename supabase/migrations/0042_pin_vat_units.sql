-- =====================================================================
-- 0042 – Three fixes.
-- 1. Cancels and returns always need the PIN of an owner / manager, checked on the server. Before, _approve let the
--    sale through without a PIN (and with a wrong one) when the till session itself belonged to an owner or manager –
--    in the SEF program the owner signs in with PIN, so a wrong PIN still changed the sale. Now: no approver, no PIN, a
--    wrong PIN or a locked approver → the RPC returns the error before it writes anything (no new coupon, no stock).
--    The same check covers void_sale, refund_sale and cancel_order_item.
-- 2. A business outside VAT (no VAT number, the rule of the books and the accounting) sells everything as A
--    (outside VAT, 0%): a trigger sets every new sale line to A, so the totals, the VAT lines and the fiscal coupon
--    have no VAT. Return / cancel lines keep the rate of the line they return.
-- 3. Every unit of the official ATK list for products (not only copë / kg / pako / litër); quantities are rounded by
--    the unit (_unit_decimals: kg, kg bruto, ton 3; metre, m², m³, km, m/s², kWh, hour, work hour 2; the rest whole).
--    The functions that rounded only "kg" are changed in place, everything else in them stays the same.
-- Existing data does not change.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Approval with PIN, always
-- ---------------------------------------------------------------------
create or replace function public._approve(p_approver uuid, p_pin text, out approver uuid, out error text)
returns record
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  p public.profiles%rowtype;
begin
  -- no shortcut for an owner / manager session: the PIN of the approver is checked every time
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
revoke execute on function public._approve(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. A business outside VAT sells as A
-- ---------------------------------------------------------------------
create or replace function public._business_has_vat(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select nullif(trim(b.vat_number), '') is not null from public.businesses b where b.id = p_business), true)
$$;

create or replace function public._sale_item_vat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ref_item_id is null and not public._business_has_vat(new.business_id) then
    new.vat_code := 'A';
    new.vat_rate := 0;
  end if;
  return new;
end $$;

drop trigger if exists sale_items_vat on public.sale_items;
create trigger sale_items_vat before insert on public.sale_items for each row execute function public._sale_item_vat();
revoke execute on function public._business_has_vat(uuid), public._sale_item_vat() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Units of the ATK list
-- ---------------------------------------------------------------------
create or replace function public._unit_decimals(p_unit text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_unit in ('kg', 'kgb', 'tn') then 3
    when p_unit in ('lm', 'mts', 'mtv', 'kmt', 'msk', 'kwh', 'hur', 'op') then 2
    else 0
  end
$$;

alter table public.products drop constraint if exists products_unit_check;
alter table public.products add constraint products_unit_check check (unit in (
  'cope', 'kg', 'pako', 'liter', 'ea', 'sec', 'min', 'hur', 'day', 'mon', 'ann', 'kgb', 'tn', 'grm', 'm4', 'udh', 'kmt', 'lm',
  'mts', 'mtv', 'msk', 'kwh', 'nfj', 'nfq', 'prq', 'dp', 'op', 'prd', 'pal', 'xbx', 'set'));

-- the rounding by unit in the functions that knew only "kg" (each change must be found, or the migration stops)
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('public._create_sale_core(jsonb)',
       'if prod.unit = ''kg'' then v_qty := round(v_qty, 3); else v_qty := round(v_qty, 0); end if;',
       'v_qty := round(v_qty, public._unit_decimals(prod.unit));'),
      ('public.add_order_items(jsonb)',
       'if prod.unit = ''kg'' then v_qty := round(v_qty, 3); else v_qty := round(v_qty, 0); end if;',
       'v_qty := round(v_qty, public._unit_decimals(prod.unit));'),
      ('public.refund_sale(jsonb)',
       'if i.unit = ''kg'' then v_qty := round(v_qty, 3); else v_qty := round(v_qty, 0); end if;',
       'v_qty := round(v_qty, public._unit_decimals(i.unit));'),
      ('public._save_stock_entry_core(jsonb)',
       'if prod.unit <> ''kg'' then v_qty := trunc(v_qty); else v_qty := round(v_qty, 3); end if;',
       'if public._unit_decimals(prod.unit) = 0 then v_qty := trunc(v_qty); else v_qty := round(v_qty, public._unit_decimals(prod.unit)); end if;'),
      ('public._adjust_stock_core(jsonb)',
       'if prod.unit <> ''kg'' then v_qty := trunc(v_qty); else v_qty := round(v_qty, 3); end if;',
       'if public._unit_decimals(prod.unit) = 0 then v_qty := trunc(v_qty); else v_qty := round(v_qty, public._unit_decimals(prod.unit)); end if;'),
      ('public.assign_lot(jsonb)',
       'if prod.unit <> ''kg'' then v_qty := trunc(v_qty); else v_qty := round(v_qty, 3); end if;',
       'if public._unit_decimals(prod.unit) = 0 then v_qty := trunc(v_qty); else v_qty := round(v_qty, public._unit_decimals(prod.unit)); end if;'),
      ('public.confirm_inventory(jsonb)',
       'case when pr.unit = ''kg'' then round((x->>''counted'')::numeric, 3) else trunc(',
       'case when public._unit_decimals(pr.unit) > 0 then round((x->>''counted'')::numeric, public._unit_decimals(pr.unit)) else trunc('),
      ('public.save_product(jsonb)',
       'if v_unit <> ''kg'' then',
       'if public._unit_decimals(v_unit) = 0 then')
    ) t(fn, old, new)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.old in v_def) = 0 then
      raise exception '0042: % does not contain the expected rounding (%)', r.fn, r.old;
    end if;
    execute replace(v_def, r.old, r.new);
  end loop;
end $$;
