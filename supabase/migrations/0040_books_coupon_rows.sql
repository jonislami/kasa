-- =====================================================================
-- 0040 – The fiscal coupons in the sales book one by one, as the other programs and ATK expect them:
-- one row per coupon, buyer "Qytetar", NUI / fiscal number "1" (the ATK code for the final consumer), the number
-- printed on the coupon (0000000040, or OFF-… while it waits to be sent). A cancel or return is its own row as a
-- credit note (negative), with the number of its own coupon. Replaces the day-by-till rows of 0039; the caller
-- (acc_vat_book_range of 0039) does not change.
-- =====================================================================
create or replace function public._acc_kasa_book_rows(p_business uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select s.id, s.sale_date, s.kind, s.invoice_no, s.offline_no, s.created_at, round(s.total, 2) as total,
           case when jsonb_typeof(s.vat_lines) = 'array' then s.vat_lines else '[]'::jsonb end as vat_lines
      from public.sales s
     where s.business_id = p_business and s.sale_date between p_from and p_to and s.total <> 0
  ),
  r as (
    select s.id,
           round(coalesce(sum((x->>'net')::numeric) filter (where upper(x->>'code') = 'E'), 0), 2) as net_e,
           round(coalesce(sum((x->>'vat')::numeric) filter (where upper(x->>'code') = 'E'), 0), 2) as vat_e,
           round(coalesce(sum((x->>'net')::numeric) filter (where upper(x->>'code') = 'D'), 0), 2) as net_d,
           round(coalesce(sum((x->>'vat')::numeric) filter (where upper(x->>'code') = 'D'), 0), 2) as vat_d,
           round(coalesce(sum((x->>'gross')::numeric) filter (where upper(x->>'code') = 'C'), 0), 2) as amt_c,
           round(coalesce(sum((x->>'gross')::numeric) filter (where coalesce(upper(x->>'code'), '') not in ('E', 'D', 'C')), 0), 2) as amt_a
      from s, jsonb_array_elements(s.vat_lines) x
     group by s.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', null, 'source', 'kasa', 'kind', 'sale', 'date', s.sale_date,
           'doc_no', case when s.offline_no is not null and coalesce(s.invoice_no, 0) = 0 then s.offline_no else lpad(s.invoice_no::text, 10, '0') end,
           'partner', 'Qytetar', 'nui', '1', 'vat_no', '',
           'doc_type', case when s.kind = 'sale' and s.total > 0 then 'invoice' else 'credit_note' end,
           'vat_flag', 'none', 'category', 'goods', 'atk_category', null, 'asset', false, 'export', false,
           'net_e', coalesce(r.net_e, 0), 'vat_e', coalesce(r.vat_e, 0), 'net_d', coalesce(r.net_d, 0), 'vat_d', coalesce(r.vat_d, 0),
           -- a coupon without the split by rate (old rows) counts whole at 0%
           'amt_c', coalesce(r.amt_c, case when r.id is null then s.total else 0 end), 'amt_a', coalesce(r.amt_a, 0),
           'vat_nd', 0, 'total', s.total,
           'coupons', case when s.kind = 'sale' then 1 else 0 end, 'returns', case when s.kind = 'sale' then 0 else 1 end
         ) order by s.sale_date, s.invoice_no, s.created_at), '[]'::jsonb)
    from s
    left join r on r.id = s.id
$$;

revoke execute on function public._acc_kasa_book_rows(uuid, date, date) from public, anon, authenticated;
