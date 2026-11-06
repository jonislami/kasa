-- =====================================================================
-- 0010 – Pharmacy: lots (batch/serial number + expiry date), FEFO.
--
-- * product_lots: quantity per lot. Stock stays on products.stock; stock that
--   has no lot ("pa seri") = products.stock − sum(lots). Lots never hold prices.
-- * Stock entries carry lot_no + expires_on per line; confirming the entry adds
--   the quantity to that lot (save/confirm_stock_entry wrappers).
-- * Every stock movement out (sale, adjustment, inventory) takes from the lots
--   First-Expired-First-Out: lots that are still valid by nearest expiry, then
--   lots without expiry, then expired lots. Voids/refunds put the quantity back
--   in the lots it came from. A write-off can name one lot (adjust_stock lot_id).
-- * assign_lot: gives a lot/expiry to stock that has none (stock unchanged).
-- Older clients keep working: the new fields are optional everywhere.
-- =====================================================================

create table if not exists public.product_lots (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id()
              references public.businesses (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  lot_no      text,
  expires_on  date,
  quantity    numeric(14, 3) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists product_lots_uq
  on public.product_lots (product_id, coalesce(lot_no, ''), coalesce(expires_on, 'infinity'::date));
create index if not exists product_lots_business_idx on public.product_lots (business_id, expires_on) where quantity > 0;

-- Which lot each movement touched (for returns and for the history).
create table if not exists public.lot_movements (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  lot_id      uuid not null references public.product_lots (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  movement_id bigint references public.stock_movements (id) on delete cascade,
  kind        text not null,
  quantity    numeric(14, 3) not null,   -- + in, - out
  ref_type    text,
  ref_id      text,
  created_at  timestamptz not null default now()
);
create index if not exists lot_movements_lot_idx on public.lot_movements (lot_id, created_at desc);
create index if not exists lot_movements_ref_idx on public.lot_movements (ref_id, product_id);

alter table public.stock_entry_items add column if not exists lot_no text;
alter table public.stock_entry_items add column if not exists expires_on date;

alter table public.product_lots  enable row level security;
alter table public.lot_movements enable row level security;

drop policy if exists product_lots_select on public.product_lots;
create policy product_lots_select on public.product_lots
  for select to authenticated using (business_id = public.current_business_id());
drop policy if exists lot_movements_select on public.lot_movements;
create policy lot_movements_select on public.lot_movements
  for select to authenticated using (business_id = public.current_business_id() and public.is_manager());
revoke insert, update, delete on public.product_lots, public.lot_movements from anon, authenticated;
revoke all on public.product_lots, public.lot_movements from anon;

-- ---------------------------------------------------------------------
-- Adds (or takes) quantity on one lot, creating it when needed. Returns the lot id.
-- ---------------------------------------------------------------------
create or replace function public._lot_add(
  p_business uuid, p_product uuid, p_lot_no text, p_expires date, p_qty numeric,
  p_kind text, p_movement bigint, p_ref_type text, p_ref_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_lot text := nullif(trim(coalesce(p_lot_no, '')), '');
begin
  select id into v_id from public.product_lots
    where product_id = p_product and coalesce(lot_no, '') = coalesce(v_lot, '')
      and coalesce(expires_on, 'infinity'::date) = coalesce(p_expires, 'infinity'::date)
    for update;
  if v_id is null then
    insert into public.product_lots (business_id, product_id, lot_no, expires_on, quantity)
    values (p_business, p_product, v_lot, p_expires, p_qty)
    returning id into v_id;
  else
    update public.product_lots set quantity = quantity + p_qty, updated_at = now() where id = v_id;
  end if;
  insert into public.lot_movements (business_id, lot_id, product_id, movement_id, kind, quantity, ref_type, ref_id)
  values (p_business, v_id, p_product, p_movement, p_kind, p_qty, p_ref_type, p_ref_id);
  return v_id;
end $$;
revoke execute on function public._lot_add(uuid, uuid, text, date, numeric, text, bigint, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Stock movement → lots. Entries are handled by confirm_stock_entry (they know the lot).
-- ---------------------------------------------------------------------
create or replace function public.stock_movements_lots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot uuid := nullif(current_setting('kasa.lot_id', true), '')::uuid;
  v_need numeric;
  v_take numeric;
  v_today date := public._local_date();
  v_orig text;
  l record;
begin
  if new.kind in ('entry', 'initial') or new.quantity = 0 then
    return null;
  end if;
  if not exists (select 1 from public.product_lots where product_id = new.product_id) then
    return null;
  end if;

  -- One named lot (write-off of an expired lot, correction).
  if v_lot is not null then
    update public.product_lots set quantity = quantity + new.quantity, updated_at = now()
      where id = v_lot and product_id = new.product_id;
    if found then
      insert into public.lot_movements (business_id, lot_id, product_id, movement_id, kind, quantity, ref_type, ref_id)
      values (new.business_id, v_lot, new.product_id, new.id, new.kind, new.quantity, new.ref_type, new.ref_id);
    end if;
    return null;
  end if;

  if new.quantity < 0 then
    v_need := -new.quantity;
    for l in
      select id, quantity from public.product_lots
      where product_id = new.product_id and quantity > 0
      order by case when expires_on is null then 1 when expires_on < v_today then 2 else 0 end,
               expires_on nulls last, created_at
      for update
    loop
      exit when v_need <= 0;
      v_take := least(v_need, l.quantity);
      update public.product_lots set quantity = quantity - v_take, updated_at = now() where id = l.id;
      insert into public.lot_movements (business_id, lot_id, product_id, movement_id, kind, quantity, ref_type, ref_id)
      values (new.business_id, l.id, new.product_id, new.id, new.kind, -v_take, new.ref_type, new.ref_id);
      v_need := v_need - v_take;
    end loop;
    return null;   -- whatever is left came from stock without a lot
  end if;

  -- Void / refund: back to the lots the original sale took from.
  if new.kind in ('void', 'refund') and new.ref_type = 'sale' then
    select ref_sale_id::text into v_orig from public.sales where id = nullif(new.ref_id, '')::uuid;
    if v_orig is null then
      return null;
    end if;
    v_need := new.quantity;
    for l in
      select lm.lot_id, -sum(lm.quantity) as taken
      from public.lot_movements lm
      where lm.product_id = new.product_id
        and (lm.ref_id = v_orig
             or lm.ref_id in (select s.id::text from public.sales s where s.ref_sale_id::text = v_orig))
      group by lm.lot_id
      having -sum(lm.quantity) > 0
      order by min(lm.id) desc
    loop
      exit when v_need <= 0;
      v_take := least(v_need, l.taken);
      update public.product_lots set quantity = quantity + v_take, updated_at = now() where id = l.lot_id;
      insert into public.lot_movements (business_id, lot_id, product_id, movement_id, kind, quantity, ref_type, ref_id)
      values (new.business_id, l.lot_id, new.product_id, new.id, new.kind, v_take, new.ref_type, new.ref_id);
      v_need := v_need - v_take;
    end loop;
  end if;
  -- Other increases (correction, inventory surplus) stay without a lot.
  return null;
end $$;
revoke execute on function public.stock_movements_lots() from public, anon, authenticated;

drop trigger if exists stock_movements_lots on public.stock_movements;
create trigger stock_movements_lots after insert on public.stock_movements
  for each row execute function public.stock_movements_lots();

-- ---------------------------------------------------------------------
-- Stock entries: lot_no / expires_on per line.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = '_save_stock_entry_core') then
    alter function public.save_stock_entry(jsonb) rename to _save_stock_entry_core;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = '_confirm_stock_entry_core') then
    alter function public.confirm_stock_entry(jsonb) rename to _confirm_stock_entry_core;
  end if;
end $$;
revoke execute on function public._save_stock_entry_core(jsonb) from public, anon, authenticated;
revoke execute on function public._confirm_stock_entry_core(jsonb) from public, anon, authenticated;

create or replace function public.save_stock_entry(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  r record;
  v_exp date;
begin
  v_id := public._save_stock_entry_core(p);
  -- The core keeps the order of p.items: line n = position n.
  for r in select x.value as item, x.ordinality as pos
           from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality x loop
    begin
      v_exp := nullif(r.item->>'expires_on', '')::date;
    exception when others then
      raise exception 'Data e skadimit nuk është e saktë (rreshti %)', r.pos using errcode = '22023';
    end;
    if v_exp is not null and (v_exp < date '2000-01-01' or v_exp > date '2100-12-31') then
      raise exception 'Data e skadimit nuk është e saktë (rreshti %)', r.pos using errcode = '22023';
    end if;
    if nullif(trim(coalesce(r.item->>'lot_no', '')), '') is not null or v_exp is not null then
      update public.stock_entry_items
        set lot_no = left(nullif(trim(coalesce(r.item->>'lot_no', '')), ''), 60), expires_on = v_exp
        where entry_id = v_id and position = r.pos;
    end if;
  end loop;
  return v_id;
end $$;

create or replace function public.confirm_stock_entry(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  i record;
begin
  v_id := public._confirm_stock_entry_core(p);
  for i in select * from public.stock_entry_items
           where entry_id = v_id and (lot_no is not null or expires_on is not null) order by position loop
    perform public._lot_add(i.business_id, i.product_id, i.lot_no, i.expires_on, i.quantity,
                            'entry', null, 'stock_entry', v_id::text);
  end loop;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- adjust_stock: optional lot_id (write-off of that lot, e.g. expired).
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = '_adjust_stock_core') then
    alter function public.adjust_stock(jsonb) rename to _adjust_stock_core;
  end if;
end $$;
revoke execute on function public._adjust_stock_core(jsonb) from public, anon, authenticated;

create or replace function public.adjust_stock(p jsonb)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
  v_lot uuid := nullif(p->>'lot_id', '')::uuid;
  lot public.product_lots%rowtype;
  v_after numeric;
begin
  if v_lot is not null then
    select * into lot from public.product_lots
      where id = v_lot and business_id = v_business and product_id = nullif(p->>'product_id', '')::uuid
      for update;
    if not found then
      raise exception 'Seria nuk u gjet' using errcode = 'P0002';
    end if;
    if coalesce((p->>'quantity')::numeric, 0) < 0 and -(p->>'quantity')::numeric > lot.quantity then
      raise exception 'Seria % ka vetëm % copë', coalesce(lot.lot_no, '(pa numër)'), lot.quantity using errcode = '22023';
    end if;
    perform set_config('kasa.lot_id', v_lot::text, true);
  end if;
  v_after := public._adjust_stock_core(p);
  perform set_config('kasa.lot_id', '', true);
  return v_after;
end $$;

-- ---------------------------------------------------------------------
-- assign_lot: stock without a lot gets a lot number / expiry (stock unchanged).
-- p: { product_id, lot_no?, expires_on?, quantity } → lot id
-- ---------------------------------------------------------------------
create or replace function public.assign_lot(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
  prod public.products%rowtype;
  v_qty numeric := coalesce((p->>'quantity')::numeric, 0);
  v_free numeric;
  v_exp date := nullif(p->>'expires_on', '')::date;
  v_lot uuid;
begin
  select * into prod from public.products where id = nullif(p->>'product_id', '')::uuid and business_id = v_business for update;
  if not found or prod.kind = 'service' then
    raise exception 'Produkti nuk u gjet ose është shërbim' using errcode = 'P0002';
  end if;
  if nullif(trim(coalesce(p->>'lot_no', '')), '') is null and v_exp is null then
    raise exception 'Shkruaj serinë ose afatin e skadimit' using errcode = '22023';
  end if;
  if prod.unit <> 'kg' then v_qty := trunc(v_qty); else v_qty := round(v_qty, 3); end if;
  v_free := prod.stock - coalesce((select sum(quantity) from public.product_lots where product_id = prod.id and quantity > 0), 0);
  if v_qty <= 0 or v_qty > v_free then
    raise exception 'Pa seri janë vetëm % – sasia duhet të jetë nga 1 deri në atë numër', greatest(v_free, 0) using errcode = '22023';
  end if;
  v_lot := public._lot_add(v_business, prod.id, left(p->>'lot_no', 60), v_exp, v_qty, 'assign', null, 'assign', null);
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'lot_assign', 'product', prod.id::text,
          jsonb_build_object('name', prod.name, 'lot_no', p->>'lot_no', 'expires_on', v_exp, 'quantity', v_qty));
  return v_lot;
end $$;

revoke execute on function public.save_stock_entry(jsonb), public.confirm_stock_entry(jsonb),
  public.adjust_stock(jsonb), public.assign_lot(jsonb) from public, anon;
grant execute on function public.save_stock_entry(jsonb), public.confirm_stock_entry(jsonb),
  public.adjust_stock(jsonb), public.assign_lot(jsonb) to authenticated;
