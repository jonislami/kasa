-- K1 test (0016). Run after migrations 0001–0016 inside a transaction; ends with an exception (rollback).
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000d1','t-acc@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000d2','t-acc2@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.accountants (user_id, full_name, email) values
 ('00000000-0000-0000-0000-0000000000d1','Kont A','t-acc@test.local'),
 ('00000000-0000-0000-0000-0000000000d2','Kont B','t-acc2@test.local');
create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create temp table t_vars (k text primary key, v text);
grant all on t_vars to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 300), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || left(sqlerrm, 100));
end $f$;
create or replace function pg_temp.v(p text) returns text language sql as $f$ select v from t_vars where k = p $f$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
insert into t_vars select 'client', public.acc_save_client('{"name":"Firma SHPK","nui":"811111111","vat_number":"330111111","legal_form":"SHPK","representative":"Arben K.","iban":"XK05 1212 0123 4567 8906"}'::jsonb)::text;
select pg_temp.try('client extra', $$select jsonb_build_object('form', legal_form, 'iban', iban) from public.acc_clients where id = pg_temp.v('client')::uuid$$);
insert into t_vars select 'cust', public.acc_save_partner(jsonb_build_object('client_id', pg_temp.v('client'), 'name', 'Blerësi SH.P.K.', 'nui', '822222222', 'role', 'customer', 'city', 'Pejë'))::text;
insert into t_vars select 'supp', public.acc_save_partner(jsonb_build_object('client_id', pg_temp.v('client'), 'name', 'Furnitori', 'nui', '833333333', 'role', 'supplier'))::text;
select pg_temp.try('partner dup nui', $$select to_jsonb(public.acc_save_partner(jsonb_build_object('client_id', pg_temp.v('client'), 'name', 'X', 'nui', '822222222')))$$);

-- sale invoice with lines: 2 × 50 (10% off) at 18% + 1 × 20 at 8%  → net E 90, VAT 16.20; D 20, VAT 1.60; total 127.80
select pg_temp.try('sale', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'sale', 'doc_date', '2026-10-05', 'due_date', '2026-10-20',
  'partner_id', pg_temp.v('cust'), 'lines', jsonb_build_array(
    jsonb_build_object('description', 'Shërbim', 'quantity', 2, 'unit_price', 50, 'discount_pct', 10, 'vat_code', 'E'),
    jsonb_build_object('description', 'Libër', 'quantity', 1, 'unit_price', 20, 'vat_code', 'D'))))$$);
insert into t_vars select 'inv', id::text from public.acc_documents where doc_no = 'F-2026-0001';
select pg_temp.try('sale amounts', $$select jsonb_build_object('ne', net_e, 've', vat_e, 'nd', net_d, 'vd', vat_d, 'total', total, 'disc', discount_total, 'partner', partner_name, 'addr', partner_address) from public.acc_documents where id = pg_temp.v('inv')::uuid$$);
select pg_temp.try('second number', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'sale', 'doc_date', '2026-10-06', 'partner_id', pg_temp.v('cust'), 'net_e', 100, 'vat_e', 18)) - 'id'$$);
select pg_temp.try('dup number', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'sale', 'doc_no', 'F-2026-0001', 'doc_date', '2026-10-06', 'net_e', 1, 'vat_e', 0.18))$$);
select pg_temp.try('bad line', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'sale', 'doc_date', '2026-10-06', 'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'quantity', 0, 'unit_price', 1))))$$);

-- payments: 50 then 100 (too much), then the rest
select pg_temp.try('pay 50', $$select to_jsonb(public.acc_save_payment(jsonb_build_object('doc_id', pg_temp.v('inv'), 'amount', 50, 'method', 'bank', 'pay_date', '2026-10-10')) is not null)$$);
select pg_temp.try('pay too much', $$select to_jsonb(public.acc_save_payment(jsonb_build_object('doc_id', pg_temp.v('inv'), 'amount', 100, 'method', 'cash')))$$);
select pg_temp.try('balance after 50', $$select jsonb_build_object('paid', paid, 'open', open) from public.acc_doc_balances where id = pg_temp.v('inv')::uuid$$);

-- credit note 10 net at 18% on the invoice → 11.80 off
select pg_temp.try('credit no ref', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'sale', 'doc_type', 'credit_note', 'doc_date', '2026-10-12', 'net_e', 10, 'vat_e', 1.8))$$);
select pg_temp.try('credit', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'sale', 'doc_type', 'credit_note', 'ref_doc_id', pg_temp.v('inv'), 'partner_id', pg_temp.v('cust'), 'doc_date', '2026-10-12',
  'lines', jsonb_build_array(jsonb_build_object('description', 'Kthim', 'quantity', 1, 'unit_price', 10, 'vat_code', 'E')))) - 'id'$$);
select pg_temp.try('balance after credit', $$select jsonb_build_object('paid', paid, 'credited', credited, 'open', open) from public.acc_doc_balances where id = pg_temp.v('inv')::uuid$$);
select pg_temp.try('pay rest', $$select to_jsonb(public.acc_save_payment(jsonb_build_object('doc_id', pg_temp.v('inv'), 'amount', 66, 'method', 'cash', 'pay_date', '2026-10-15')) is not null)$$);
select pg_temp.try('list sale', $$select jsonb_agg(jsonb_build_object('no', x->>'doc_no', 'type', x->>'doc_type', 'total', x->'total', 'open', x->'open', 'st', x->>'pay_status', 'od', x->'overdue_days', 'ref', x->>'ref_doc_no')) from jsonb_array_elements(public.acc_documents_list(pg_temp.v('client')::uuid, 'sale', '2026-10-01', '2026-10-31')) x$$);
select pg_temp.try('delete referenced', $$select to_jsonb(public.acc_delete_document(pg_temp.v('inv')::uuid))$$);

-- purchase: duplicate check, non-deductible VAT
select pg_temp.try('purchase', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'purchase', 'category', 'fuel', 'doc_no', 'AB-77', 'doc_date', '2026-10-07', 'partner_id', pg_temp.v('supp'), 'net_e', 100, 'vat_e', 18, 'vat_deductible', false, 'paid_now', jsonb_build_object('method', 'cash'))) - 'id'$$);
select pg_temp.try('purchase dup', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'purchase', 'doc_no', 'ab-77', 'doc_date', '2026-10-08', 'partner_id', pg_temp.v('supp'), 'net_e', 5, 'vat_e', 0.9))$$);
select pg_temp.try('purchase dup forced', $$select (public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'purchase', 'doc_no', 'ab-77', 'doc_date', '2026-10-08', 'partner_id', pg_temp.v('supp'), 'net_e', 5, 'vat_e', 0.9, 'force', true)) ? 'id')::text::jsonb$$);
select pg_temp.try('purchase no number', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'purchase', 'doc_date', '2026-10-08', 'net_e', 5))$$);
select pg_temp.try('nd amounts', $$select jsonb_build_object('ve', vat_e, 'nd', vat_nd, 'total', total) from public.acc_documents where doc_no = 'AB-77'$$);
select pg_temp.try('books', $$select jsonb_build_object('sales', b->'manual'->'sales', 'exp', b->'manual'->'expenses', 'vat_exp', b->'manual'->'expense_vat', 'recv', b->'manual'->'receivable', 'pay', b->'manual'->'payable') from public.acc_client_books(pg_temp.v('client')::uuid, '2026-10-01', '2026-10-31') b$$);

-- proforma: own numbers, not in the books, converted to an invoice
select pg_temp.try('proforma', $$select public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'proforma', 'doc_date', '2026-10-09', 'partner_id', pg_temp.v('cust'), 'lines', jsonb_build_array(jsonb_build_object('description', 'Ofertë', 'quantity', 3, 'unit_price', 10, 'vat_code', 'E')))) - 'id'$$);
select pg_temp.try('convert', $$select public.acc_convert_proforma((select id from public.acc_documents where doc_no = 'PF-2026-0001'), '2026-10-11') - 'id'$$);
select pg_temp.try('convert twice', $$select public.acc_convert_proforma((select id from public.acc_documents where doc_no = 'PF-2026-0001'), '2026-10-11')$$);
select pg_temp.try('pay proforma', $$select to_jsonb(public.acc_save_payment(jsonb_build_object('doc_id', (select id from public.acc_documents where doc_no = 'PF-2026-0001'), 'amount', 1)))$$);
select pg_temp.try('sales after convert', $$select (public.acc_client_books(pg_temp.v('client')::uuid, '2026-10-01', '2026-10-31')->'manual'->'sales')$$);

-- debts and statement (as of 2026-11-10: F-2026-0002 118 due since 10-06 → 31-60)
select pg_temp.try('debts', $$select jsonb_build_object('total', d->'total', 'b', d->'buckets', 'n', jsonb_array_length(d->'partners')) from public.acc_debts(pg_temp.v('client')::uuid, 'receivable', '2026-11-10') d$$);
select pg_temp.try('statement', $$select jsonb_build_object('open', s->'opening', 'rows', (select jsonb_agg(jsonb_build_array(r->>'type', r->'debit', r->'credit')) from jsonb_array_elements(s->'rows') r)) from public.acc_partner_statement(pg_temp.v('cust')::uuid, '2026-10-01', '2026-10-31') s$$);
select pg_temp.try('partners list', $$select jsonb_agg(jsonb_build_object('n', x->>'name', 'r', x->'receivable', 'p', x->'payable', 'docs', x->'docs')) from jsonb_array_elements(public.acc_partners_list(pg_temp.v('client')::uuid)) x$$);
select pg_temp.try('detail', $$select jsonb_build_object('lines', jsonb_array_length(d->'lines'), 'pays', jsonb_array_length(d->'payments'), 'corr', jsonb_array_length(d->'corrections'), 'hist', (select jsonb_agg(h->>'action') from jsonb_array_elements(d->'history') h)) from public.acc_document_detail(pg_temp.v('inv')::uuid) d$$);
select pg_temp.try('delete partner used', $$select to_jsonb(public.acc_delete_partner(pg_temp.v('cust')::uuid))$$);
select pg_temp.try('file wrong folder', $$select to_jsonb(public.acc_add_file(jsonb_build_object('client_id', pg_temp.v('client'), 'path', 'other/x.pdf', 'file_name', 'x.pdf')))$$);
select pg_temp.try('file ok', $$select to_jsonb(public.acc_add_file(jsonb_build_object('client_id', pg_temp.v('client'), 'doc_id', pg_temp.v('inv'), 'path', pg_temp.v('client') || '/a-x.pdf', 'file_name', 'x.pdf', 'size_bytes', 100))) is not null$$);

-- the other accountant sees nothing and cannot write
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select pg_temp.try('B partners', $$select to_jsonb(count(*)) from public.acc_partners$$);
select pg_temp.try('B lines', $$select to_jsonb(count(*)) from public.acc_document_lines$$);
select pg_temp.try('B payments', $$select to_jsonb(count(*)) from public.acc_payments$$);
select pg_temp.try('B balances', $$select to_jsonb(count(*)) from public.acc_doc_balances$$);
select pg_temp.try('B pay', $$select to_jsonb(public.acc_save_payment(jsonb_build_object('doc_id', pg_temp.v('inv'), 'amount', 1)))$$);
select pg_temp.try('B detail', $$select public.acc_document_detail(pg_temp.v('inv')::uuid)$$);
select pg_temp.try('B direct insert', $$insert into public.acc_payments (client_id, doc_id, pay_date, amount, method) values (pg_temp.v('client')::uuid, pg_temp.v('inv')::uuid, current_date, 1, 'cash') returning to_jsonb(id)$$);

reset role;
do $$ begin raise exception 'RESULTS %', (select string_agg(k || ' => ' || v, E'\n') from t_results); end $$;
