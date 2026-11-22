-- =====================================================================
-- 0046 – Two non-cash payments in one sale (the till's payment window: tick up to two of Kesh, Kartelë, Vauçer,
-- Transfer bankar). Kesh + one of them works as before (mixed). Two non-cash ones (e.g. Kartelë + Vauçer,
-- Vauçer + Transfer) are a card sale whose non-cash amount (card_amount, unchanged for reports and the wallet) is split:
-- payment_kind is the first part (null = card), split_kind / split_amount the second part. The fiscal coupon then sends
-- two payments. A cancel coupon takes the split of its original (negative, like its other amounts).
-- =====================================================================
alter table public.sales add column if not exists split_kind text;
alter table public.sales add column if not exists split_amount numeric(12,2) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_split_kind_check') then
    alter table public.sales add constraint sales_split_kind_check check (split_kind is null or split_kind in ('card', 'bank', 'voucher'));
  end if;
end $$;

create or replace function public.sales_split_from_original()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'void' and new.ref_sale_id is not null and new.split_kind is null then
    select s.split_kind, -s.split_amount into new.split_kind, new.split_amount from public.sales s where s.id = new.ref_sale_id;
    new.split_amount := coalesce(new.split_amount, 0);
  end if;
  return new;
end $$;

drop trigger if exists sales_split_from_original on public.sales;
create trigger sales_split_from_original before insert on public.sales for each row execute function public.sales_split_from_original();

create or replace function public.create_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := nullif(p->'payment'->>'kind', '');
  v_split_kind text := nullif(p->'payment'->'split'->>'kind', '');
  v_split numeric := round(coalesce(nullif(p->'payment'->'split'->>'amount', '')::numeric, 0), 2);
  v_sale jsonb;
begin
  if v_kind is not null and v_kind not in ('bank', 'voucher', 'cheque') then
    raise exception 'Mënyra e pagesës nuk njihet' using errcode = '22023';
  end if;
  if v_split_kind is not null then
    if v_split_kind not in ('card', 'bank', 'voucher') or v_split <= 0 then
      raise exception 'Pjesa e dytë e pagesës nuk është e saktë' using errcode = '22023';
    end if;
    if coalesce(p->'payment'->>'method', '') <> 'card' or v_split_kind = coalesce(v_kind, 'card') or v_kind = 'cheque' then
      raise exception 'Ky kombinim i pagesës nuk lejohet' using errcode = '22023';
    end if;
  end if;
  v_sale := public._create_sale_order(p);
  if v_kind is not null and v_sale->>'payment_method' in ('card', 'mixed') and v_sale->>'payment_kind' is null then
    perform set_config('kasa.building_sale', 'on', true);
    update public.sales set payment_kind = v_kind where id = (v_sale->>'id')::uuid and payment_kind is null;
    perform set_config('kasa.building_sale', 'off', true);
    v_sale := v_sale || jsonb_build_object('payment_kind', v_kind);
  end if;
  -- two non-cash parts: the second one (a sale sent again keeps what it has)
  if v_split_kind is not null and v_sale->>'payment_method' = 'card' and v_sale->>'split_kind' is null then
    if v_split >= abs((v_sale->>'total')::numeric) then
      raise exception 'Pjesa e dytë duhet të jetë më e vogël se totali' using errcode = '22023';
    end if;
    perform set_config('kasa.building_sale', 'on', true);
    update public.sales set split_kind = v_split_kind, split_amount = v_split where id = (v_sale->>'id')::uuid and split_kind is null;
    perform set_config('kasa.building_sale', 'off', true);
    v_sale := v_sale || jsonb_build_object('split_kind', v_split_kind, 'split_amount', v_split);
  end if;
  return v_sale;
end $$;

-- sale_json: the second part next to the card amount
do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.sale_json(uuid)'::regprocedure);
  if position('''split_kind''' in d) = 0 then
    d := replace(d, '''card_amount'', s.card_amount,', '''card_amount'', s.card_amount, ''split_kind'', s.split_kind, ''split_amount'', s.split_amount,');
    if position('''split_kind''' in d) = 0 then raise exception 'sale_json: card_amount not found'; end if;
    execute d;
  end if;
end $$;
