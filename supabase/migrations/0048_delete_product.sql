-- =====================================================================
-- 0048: delete a product from the SEF till (owner / manager).
-- A product that was never used (no sale, order, stock movement, stock entry, inventory count, appointment, or
-- use as a recipe ingredient – also for its variants) is deleted for good. A product with history is archived:
-- the coupons, the stock movements and the audit trail must stay (ATK, 10 years), so it only leaves the till and
-- the catalog list (active = false, the barcode is free again). Returns 'deleted' or 'archived'.
-- =====================================================================
create or replace function public.delete_product(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_name text;
  v_ids uuid[];
  v_used boolean;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri mund të fshijë produktet' using errcode = '42501';
  end if;
  select name into v_name from public.products where id = p_id and business_id = v_business for update;
  if not found then
    raise exception 'Produkti nuk u gjet' using errcode = 'P0002';
  end if;

  -- the product and its variants
  select array_agg(id) into v_ids from public.products where business_id = v_business and (id = p_id or parent_id = p_id);

  v_used := exists (select 1 from public.sale_items where product_id = any (v_ids))
         or exists (select 1 from public.order_items where product_id = any (v_ids))
         or exists (select 1 from public.stock_movements where product_id = any (v_ids))
         or exists (select 1 from public.lot_movements where product_id = any (v_ids))
         or exists (select 1 from public.stock_entry_items where product_id = any (v_ids))
         or exists (select 1 from public.inventory_count_items where product_id = any (v_ids))
         or exists (select 1 from public.appointments where product_id = any (v_ids))
         or exists (select 1 from public.recipe_items where ingredient_id = any (v_ids));

  if v_used then
    update public.products set active = false, show_in_pos = false, updated_at = now() where id = any (v_ids);
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (v_business, auth.uid(), 'product_archive', 'product', p_id::text, jsonb_build_object('name', v_name, 'reason', 'delete_with_history'));
    return 'archived';
  end if;

  delete from public.products where id = p_id;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'product_delete', 'product', p_id::text, jsonb_build_object('name', v_name));
  return 'deleted';
end $$;

revoke execute on function public.delete_product(uuid) from public, anon;
grant execute on function public.delete_product(uuid) to authenticated;
