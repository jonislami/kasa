-- =====================================================================
-- 0039 – The sales book of a client linked with KontoSef.app takes the fiscal coupons of its SEF tills by itself.
-- acc_vat_book_range (0032) returned only the accountant's documents (acc_documents). When the client is linked
-- (approved link, active membership, active business – the same rule as the VAT return of 0018), it now also returns
-- the till's sales: one row per day and till, "Konsumatorë të fundit", with the coupon numbers of that day and the
-- amounts by VAT rate (E 18%, D 8%, C 0%, A exempt) after the cancels and returns of that day. A day whose returns
-- exceed its sales comes as a credit note. These rows are read-only (source 'kasa'); nothing is copied, so a coupon
-- issued later in the period shows up the next time the book is opened.
-- The shape of the old rows does not change; the old program ignores the new fields (source, coupons, returns).
-- =====================================================================

-- The till's coupons of a period as sales-book rows (one per day and till).
create or replace function public._acc_kasa_book_rows(p_business uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select s.id, s.sale_date, s.register_id, s.kind, s.invoice_no, s.total, s.vat_lines
      from public.sales s
     where s.business_id = p_business and s.sale_date between p_from and p_to
  ),
  l as (
    select s.sale_date, s.register_id, upper(x->>'code') as code,
           coalesce((x->>'net')::numeric, 0) as net, coalesce((x->>'vat')::numeric, 0) as vat, coalesce((x->>'gross')::numeric, 0) as gross
      from s, jsonb_array_elements(case when jsonb_typeof(s.vat_lines) = 'array' then s.vat_lines else '[]'::jsonb end) x
  ),
  r as (
    select sale_date, register_id,
           round(coalesce(sum(net) filter (where code = 'E'), 0), 2) as net_e, round(coalesce(sum(vat) filter (where code = 'E'), 0), 2) as vat_e,
           round(coalesce(sum(net) filter (where code = 'D'), 0), 2) as net_d, round(coalesce(sum(vat) filter (where code = 'D'), 0), 2) as vat_d,
           round(coalesce(sum(gross) filter (where code = 'C'), 0), 2) as amt_c,
           round(coalesce(sum(gross) filter (where code not in ('E', 'D', 'C') or code is null), 0), 2) as amt_a
      from l group by 1, 2
  ),
  h as (
    select sale_date, register_id, round(sum(total), 2) as total,
           count(*) filter (where kind = 'sale') as coupons, count(*) filter (where kind <> 'sale') as returns,
           min(invoice_no) filter (where kind = 'sale') as first_no, max(invoice_no) filter (where kind = 'sale') as last_no
      from s group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', null, 'source', 'kasa', 'kind', 'sale', 'date', h.sale_date,
           'doc_no', 'KF ' || coalesce(
              lpad(h.first_no::text, 5, '0') || case when h.last_no <> h.first_no then '-' || lpad(h.last_no::text, 5, '0') else '' end,
              'kthime') || ' · ' || coalesce(g.name, 'Arka'),
           'partner', 'Konsumatorë të fundit', 'nui', '', 'vat_no', '',
           'doc_type', case when h.total < 0 then 'credit_note' else 'invoice' end,
           'vat_flag', 'none', 'category', 'goods', 'atk_category', null, 'asset', false, 'export', false,
           'net_e', coalesce(r.net_e, 0), 'vat_e', coalesce(r.vat_e, 0), 'net_d', coalesce(r.net_d, 0), 'vat_d', coalesce(r.vat_d, 0),
           'amt_c', coalesce(r.amt_c, 0), 'amt_a', coalesce(r.amt_a, 0), 'vat_nd', 0, 'total', h.total,
           'coupons', h.coupons, 'returns', h.returns
         ) order by h.sale_date, g.name), '[]'::jsonb)
    from h
    left join r on r.sale_date = h.sale_date and r.register_id is not distinct from h.register_id
    left join public.registers g on g.id = h.register_id
   where h.total <> 0 or h.coupons > 0
$$;

create or replace function public.acc_vat_book_range(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_docs jsonb;
  v_kasa jsonb := '[]'::jsonb;
begin
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Zgjidh një periudhë deri në një vit' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'kind', d.kind, 'date', d.doc_date, 'doc_no', d.doc_no, 'partner', coalesce(d.partner_name, p.name, ''),
      'nui', coalesce(nullif(d.partner_nui, ''), p.nui, p.fiscal_number, ''), 'vat_no', coalesce(nullif(d.partner_vat, ''), p.vat_number, ''),
      'doc_type', d.doc_type, 'vat_flag', d.vat_flag, 'category', d.category, 'atk_category', d.atk_category,
      'asset', d.category = 'assets', 'export', d.export,
      'net_e', d.net_e, 'vat_e', d.vat_e, 'net_d', d.net_d, 'vat_d', d.vat_d, 'amt_c', d.amt_c, 'amt_a', d.amt_a,
      'vat_nd', d.vat_nd, 'total', d.total
    ) order by d.doc_date, d.doc_no), '[]'::jsonb)
    into v_docs
    from public.acc_documents d
    left join public.acc_partners p on p.id = d.partner_id
   where d.client_id = c.id and d.kind in ('sale', 'purchase') and d.doc_date between p_from and p_to;

  -- the SEF tills of a linked client (same rule as the VAT return)
  if c.kasa_business_id is not null and c.link_status = 'approved'
     and exists (select 1 from public.business_members m join public.businesses bb on bb.id = m.business_id
                  where m.user_id = c.accountant_id and m.business_id = c.kasa_business_id and m.status = 'active' and bb.active) then
    v_kasa := public._acc_kasa_book_rows(c.kasa_business_id, p_from, p_to);
  end if;

  return (
    select coalesce(jsonb_agg(x order by x->>'date', x->>'doc_no'), '[]'::jsonb)
      from jsonb_array_elements(v_docs || v_kasa) x
  );
end $$;

revoke execute on function public._acc_kasa_book_rows(uuid, date, date) from public, anon, authenticated;
