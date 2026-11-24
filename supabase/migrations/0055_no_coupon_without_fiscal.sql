-- =====================================================================
-- 0055 – No fiscalization, no coupon.
-- A sale, cancel or return is saved only on a till registered at ATK (registers.fiscal_status = 'registered' with a
-- POS ID). A till that is not registered issues nothing, not even a "Kupon jo-fiskal".
-- A sale made without internet was already signed on the device (it could only be signed on a registered till), so
-- it is accepted when it arrives even if the till was unregistered meanwhile.
-- Existing sales do not change.
-- =====================================================================
create or replace function public._sales_fiscal_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.offline, false) then
    return new;
  end if;
  if new.register_id is null or not exists (
    select 1 from public.registers r
     where r.id = new.register_id and r.fiscal_status = 'registered' and r.atk_pos_id is not null
  ) then
    raise exception 'Arka nuk është e regjistruar në ATK: pa fiskalizim nuk lëshohet asnjë kupon.' using errcode = '42501', hint = 'not_fiscal';
  end if;
  return new;
end $$;

drop trigger if exists sales_fiscal_guard on public.sales;
create trigger sales_fiscal_guard before insert on public.sales for each row execute function public._sales_fiscal_guard();
revoke execute on function public._sales_fiscal_guard() from public, anon, authenticated;
