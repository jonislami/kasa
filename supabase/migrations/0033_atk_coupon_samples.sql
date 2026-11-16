-- =====================================================================
-- 0033 – ATK requirements (Kërkesat specifike, Shtojca F; list "Njësitë matëse – Kategoritë"):
-- * The sale returned to the till also carries the original sale (number, date, items, totals, what was returned
--   so far), so the cancel and return coupons print as in the ATK samples ("KUPON FISKAL I ANULUAR",
--   "KUPON FISKAL KTHIMI" with "KTHIMI I ARTIKUJVE" and "TOTALI I MBETUR").
-- * ATK category of a boutique: VM = "Veshmbathje" (clothes, shoes) – the official list; was TT.
-- Nothing changes shape for older clients (one more key in the JSON).
-- =====================================================================

create or replace function public.sale_json(p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'ref_sale_id', s.ref_sale_id,
    'ref_invoice_no', (select o.invoice_no from public.sales o where o.id = s.ref_sale_id),
    'invoice_no', s.invoice_no, 'daily_no', s.daily_no, 'sale_date', s.sale_date,
    'created_at', s.created_at, 'client_created_at', s.client_created_at,
    'items_count', s.items_count, 'subtotal', s.subtotal, 'invoice_discount', s.invoice_discount,
    'discount_total', s.discount_total, 'total', s.total, 'net_total', s.net_total, 'vat_total', s.vat_total,
    'vat_lines', s.vat_lines, 'payment_method', s.payment_method, 'cash_amount', s.cash_amount,
    'card_amount', s.card_amount, 'tendered', s.tendered, 'change_amount', s.change_amount,
    'reason', s.reason, 'note', s.note, 'offline', s.offline, 'offline_no', s.offline_no,
    'fiscal_status', s.fiscal_status, 'worker_id', s.worker_id,
    'worker_name', (select pr.full_name from public.profiles pr where pr.id = s.worker_id),
    'register_name', (select r.name from public.registers r where r.id = s.register_id),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'position', i.position, 'product_id', i.product_id, 'name', i.name, 'unit', i.unit,
        'quantity', i.quantity, 'unit_price', i.unit_price, 'line_discount', i.line_discount,
        'invoice_discount', i.invoice_discount, 'total', i.total, 'vat_code', i.vat_code, 'atk_type', i.atk_type,
        'refunded', (select coalesce(-sum(r.quantity), 0) from public.sale_items r where r.ref_item_id = i.id)
      ) order by i.position), '[]'::jsonb)
      from public.sale_items i where i.sale_id = s.id
    ),
    -- 0033: the original sale on a cancel / return coupon (ATK Shtojca F): its number, date, items and totals,
    -- and how much of it was returned up to this coupon (for "TOTALI I MBETUR")
    'ref', (
      select jsonb_build_object(
        'invoice_no', o.invoice_no, 'created_at', coalesce(o.client_created_at, o.created_at), 'total', o.total,
        'subtotal', o.subtotal, 'invoice_discount', o.invoice_discount, 'net_total', o.net_total, 'vat_total', o.vat_total,
        'vat_lines', o.vat_lines, 'payment_method', o.payment_method, 'items_count', o.items_count,
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                    'name', oi.name, 'unit', oi.unit, 'quantity', oi.quantity, 'unit_price', oi.unit_price,
                    'line_discount', oi.line_discount, 'total', oi.total, 'vat_code', oi.vat_code) order by oi.position), '[]'::jsonb)
                  from public.sale_items oi where oi.sale_id = o.id),
        'returned', (select coalesce(sum(r.total), 0) from public.sales r
                     where r.ref_sale_id = o.id and r.kind = 'refund' and r.created_at <= s.created_at))
      from public.sales o where o.id = s.ref_sale_id
    ),
    'voided', exists (select 1 from public.sales v where v.ref_sale_id = s.id and v.kind = 'void'),
    'has_refunds', exists (select 1 from public.sales v where v.ref_sale_id = s.id and v.kind = 'refund')
  )
  from public.sales s
  where s.id = p_sale_id and s.business_id = public.current_business_id()
$$;

create or replace function public._atk_default_type(p_business uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case b.type::text when 'market' then 'AU' when 'restaurant' then 'UR' when 'pharmacy' then 'BM'
                           when 'salon' then 'SHZ' when 'boutique' then 'VM' else 'TT' end
  from public.businesses b where b.id = p_business;
$$;
revoke execute on function public._atk_default_type(uuid) from public, anon, authenticated;

update public.products p set atk_type = 'VM'
from public.businesses b
where b.id = p.business_id and b.type::text = 'boutique' and p.atk_type = 'TT';
