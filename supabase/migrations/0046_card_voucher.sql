-- =====================================================================
-- 0046 – A sale paid partly by card and partly by voucher (Të kombinuara: Kartelë + Vauçer).
-- The non-cash amount stays in card_amount as before (reports, wallet and books do not change); voucher_amount says
-- how much of it was a voucher, so the fiscal coupon sends two payments: CreditCard and Voucher.
-- A cancel coupon takes the voucher part of its original (negative, like its other amounts).
-- =====================================================================
alter table public.sales add column if not exists voucher_amount numeric(12,2) not null default 0;

create or replace function public.sales_voucher_from_original()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'void' and new.ref_sale_id is not null and coalesce(new.voucher_amount, 0) = 0 then
    select -s.voucher_amount into new.voucher_amount from public.sales s where s.id = new.ref_sale_id;
    new.voucher_amount := coalesce(new.voucher_amount, 0);
  end if;
  return new;
end $$;

drop trigger if exists sales_voucher_from_original on public.sales;
create trigger sales_voucher_from_original before insert on public.sales for each row execute function public.sales_voucher_from_original();

create or replace function public.create_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := nullif(p->'payment'->>'kind', '');
  v_voucher numeric := round(coalesce(nullif(p->'payment'->>'voucher_amount', '')::numeric, 0), 2);
  v_sale jsonb;
begin
  if v_kind is not null and v_kind not in ('bank', 'voucher', 'cheque') then
    raise exception 'Mënyra e pagesës nuk njihet' using errcode = '22023';
  end if;
  if v_voucher < 0 or (v_voucher > 0 and (coalesce(p->'payment'->>'method', '') <> 'card' or v_kind is not null)) then
    raise exception 'Vauçeri kombinohet vetëm me kartelë' using errcode = '22023';
  end if;
  v_sale := public._create_sale_order(p);
  if v_kind is not null and v_sale->>'payment_method' in ('card', 'mixed') and v_sale->>'payment_kind' is null then
    perform set_config('kasa.building_sale', 'on', true);
    update public.sales set payment_kind = v_kind where id = (v_sale->>'id')::uuid and payment_kind is null;
    perform set_config('kasa.building_sale', 'off', true);
    v_sale := v_sale || jsonb_build_object('payment_kind', v_kind);
  end if;
  -- card + voucher: the voucher part of the card amount (a sale sent again keeps what it has)
  if v_voucher > 0 and v_sale->>'payment_method' = 'card' and coalesce((v_sale->>'voucher_amount')::numeric, 0) = 0 then
    if v_voucher >= abs((v_sale->>'total')::numeric) then
      raise exception 'Pjesa me vauçer duhet të jetë më e vogël se totali' using errcode = '22023';
    end if;
    perform set_config('kasa.building_sale', 'on', true);
    update public.sales set voucher_amount = v_voucher where id = (v_sale->>'id')::uuid and voucher_amount = 0;
    perform set_config('kasa.building_sale', 'off', true);
    v_sale := v_sale || jsonb_build_object('voucher_amount', v_voucher);
  end if;
  return v_sale;
end $$;

-- sale_json: the voucher part next to the card amount
do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.sale_json(uuid)'::regprocedure);
  if position('''voucher_amount''' in d) = 0 then
    d := replace(d, '''card_amount'', s.card_amount,', '''card_amount'', s.card_amount, ''voucher_amount'', s.voucher_amount,');
    if position('''voucher_amount''' in d) = 0 then raise exception 'sale_json: card_amount not found'; end if;
    execute d;
  end if;
end $$;
