-- K2 test (0017). Run after migrations 0001–0017 inside a transaction; ends with an exception (rollback).
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
  insert into t_results values (p_key, coalesce(left(r::text, 400), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || left(sqlerrm, 100));
end $f$;
create or replace function pg_temp.v(p text) returns text language sql as $f$ select v from t_vars where k = p $f$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
insert into t_vars select 'client', public.acc_save_client('{"name":"Firma"}'::jsonb)::text;
insert into t_vars select 'cust', public.acc_save_partner(jsonb_build_object('client_id', pg_temp.v('client'), 'name', 'Blerësi Ardi', 'role', 'customer'))::text;
insert into t_vars select 'bank', public.acc_save_account(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'bank', 'bank_name', 'ProCredit', 'iban', 'XK05 1212', 'opening_balance', 1000, 'opening_date', '2026-01-01'))::text;
insert into t_vars select 'cash', public.acc_save_account(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'cash', 'opening_balance', 50))::text;
-- invoice F-2026-0001 118.00, F-2026-0002 59.00; purchase AB-1 236.00
insert into t_vars select 'inv1', (public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'sale', 'doc_date', '2026-10-01', 'partner_id', pg_temp.v('cust'), 'net_e', 100, 'vat_e', 18)) ->> 'id');
insert into t_vars select 'inv2', (public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'sale', 'doc_date', '2026-10-02', 'partner_id', pg_temp.v('cust'), 'net_e', 50, 'vat_e', 9)) ->> 'id');
insert into t_vars select 'pur', (public.acc_save_invoice(jsonb_build_object('client_id', pg_temp.v('client'), 'kind', 'purchase', 'doc_no', 'AB-1', 'partner_name', 'Furnitori', 'doc_date', '2026-10-03', 'net_e', 200, 'vat_e', 36)) ->> 'id');

-- payment from cash for inv2 (method follows the account)
select pg_temp.try('pay cash', $$select to_jsonb(public.acc_save_payment(jsonb_build_object('doc_id', pg_temp.v('inv2'), 'amount', 59, 'account_id', pg_temp.v('cash'), 'pay_date', '2026-10-05')) is not null)$$);
select pg_temp.try('pay method', $$select to_jsonb(method) from public.acc_payments where doc_id = pg_temp.v('inv2')::uuid$$);
-- movements: owner deposit 500 into bank, transfer 100 bank→cash, VAT payment −40
select pg_temp.try('owner in', $$select to_jsonb(public.acc_save_transaction(jsonb_build_object('account_id', pg_temp.v('bank'), 'amount', 500, 'category', 'owner', 'tx_date', '2026-10-04')) is not null)$$);
select pg_temp.try('transfer', $$select to_jsonb(public.acc_save_transaction(jsonb_build_object('account_id', pg_temp.v('bank'), 'to_account_id', pg_temp.v('cash'), 'amount', 100, 'category', 'transfer', 'tx_date', '2026-10-06')) is not null)$$);
select pg_temp.try('transfer same', $$select to_jsonb(public.acc_save_transaction(jsonb_build_object('account_id', pg_temp.v('bank'), 'to_account_id', pg_temp.v('bank'), 'amount', 1, 'category', 'transfer')))$$);
select pg_temp.try('vat out', $$select to_jsonb(public.acc_save_transaction(jsonb_build_object('account_id', pg_temp.v('bank'), 'amount', -40, 'category', 'vat', 'tx_date', '2026-10-20')) is not null)$$);
select pg_temp.try('zero', $$select to_jsonb(public.acc_save_transaction(jsonb_build_object('account_id', pg_temp.v('bank'), 'amount', 0)))$$);

-- statement import (bank): customer pays inv1 (118, mentions F-2026-0001), supplier paid 236, bank fee 2.50, salary −400
select pg_temp.try('import', $$select public.acc_import_bank_lines(pg_temp.v('bank')::uuid, jsonb_build_array(
  jsonb_build_object('date', '2026-10-10', 'amount', 118, 'description', 'Pagese per faturen F-2026-0001', 'counterparty', 'Ardi'),
  jsonb_build_object('date', '2026-10-11', 'amount', -236, 'description', 'AB-1 Furnitori'),
  jsonb_build_object('date', '2026-10-31', 'amount', -2.5, 'description', 'Provizion mujor'),
  jsonb_build_object('date', '2026-10-31', 'amount', -2.5, 'description', 'Provizion mujor'),
  jsonb_build_object('date', '2026-10-25', 'amount', -400, 'description', 'Paga Tetor')))$$);
select pg_temp.try('import again', $$select public.acc_import_bank_lines(pg_temp.v('bank')::uuid, jsonb_build_array(
  jsonb_build_object('date', '2026-10-10', 'amount', 118, 'description', 'Pagese per faturen F-2026-0001', 'counterparty', 'Ardi'),
  jsonb_build_object('date', '2026-10-31', 'amount', -2.5, 'description', 'Provizion mujor')))$$);
select pg_temp.try('lines', $$select jsonb_agg(jsonb_build_object('amt', x->'amount', 'sug', (select jsonb_agg(jsonb_build_array(s->>'doc_no', s->'score')) from jsonb_array_elements(x->'suggestions') s))) from jsonb_array_elements(public.acc_bank_lines_list(pg_temp.v('bank')::uuid, 'new')) x$$);
insert into t_vars select 'l_in', id::text from public.acc_bank_lines where amount = 118;
insert into t_vars select 'l_sup', id::text from public.acc_bank_lines where amount = -236;
insert into t_vars select 'l_fee', id::text from public.acc_bank_lines where amount = -2.5 order by hash limit 1;
insert into t_vars select 'l_wage', id::text from public.acc_bank_lines where amount = -400;
select pg_temp.try('match wrong side', $$select to_jsonb(public.acc_match_bank_line(pg_temp.v('l_in')::uuid, pg_temp.v('pur')::uuid))$$);
select pg_temp.try('match in', $$select to_jsonb(public.acc_match_bank_line(pg_temp.v('l_in')::uuid, pg_temp.v('inv1')::uuid))$$);
select pg_temp.try('match supplier', $$select to_jsonb(public.acc_match_bank_line(pg_temp.v('l_sup')::uuid, pg_temp.v('pur')::uuid))$$);
select pg_temp.try('match twice', $$select to_jsonb(public.acc_match_bank_line(pg_temp.v('l_in')::uuid, pg_temp.v('inv1')::uuid))$$);
select pg_temp.try('fee as expense', $$select to_jsonb(public.acc_book_bank_line(pg_temp.v('l_fee')::uuid, '{"expense_category":"bank"}'::jsonb))$$);
select pg_temp.try('wage as movement', $$select to_jsonb(public.acc_book_bank_line(pg_temp.v('l_wage')::uuid, '{"category":"wages","description":"Pagat tetor"}'::jsonb))$$);
select pg_temp.try('balances inv', $$select jsonb_agg(jsonb_build_object('no', d.doc_no, 'open', b.open) order by d.doc_no) from public.acc_documents d join public.acc_doc_balances b on b.id = d.id where d.client_id = pg_temp.v('client')::uuid$$);
-- bank: 1000 + 500 − 100 − 40 + 118 − 236 − 2.5 − 400 = 839.50 ; cash: 50 + 59 + 100 = 209
select pg_temp.try('accounts', $$select jsonb_agg(jsonb_build_object('n', x->>'name', 'bal', x->'balance', 'tm', x->'to_match')) from jsonb_array_elements(public.acc_accounts_list(pg_temp.v('client')::uuid, '2026-11-30')) x$$);
select pg_temp.try('ledger', $$select jsonb_build_object('open', l->'opening', 'close', l->'closing', 'n', jsonb_array_length(l->'rows')) from public.acc_account_ledger(pg_temp.v('bank')::uuid, '2026-10-01', '2026-10-31') l$$);
select pg_temp.try('cash flow', $$select jsonb_build_object('open', f->'opening', 'close', f->'closing', 'groups', f->'groups') from public.acc_cash_flow(pg_temp.v('client')::uuid, '2026-10-01', '2026-10-31') f$$);
select pg_temp.try('expenses in books', $$select (public.acc_client_books(pg_temp.v('client')::uuid, '2026-10-01', '2026-10-31')->'manual'->'expenses')$$);
-- undo the supplier match: payment removed, invoice open again
select pg_temp.try('unmatch', $$select to_jsonb(public.acc_set_bank_line(pg_temp.v('l_sup')::uuid, 'new'))$$);
select pg_temp.try('pur open after unmatch', $$select to_jsonb(open) from public.acc_doc_balances where id = pg_temp.v('pur')::uuid$$);
select pg_temp.try('delete transfer', $$select to_jsonb(public.acc_delete_transaction((select id from public.acc_transactions where category = 'transfer' limit 1)))$$);
select pg_temp.try('transfers left', $$select to_jsonb(count(*)) from public.acc_transactions where category = 'transfer'$$);
-- loan 1200 over 12 months, received in the bank, one instalment
select pg_temp.try('loan', $$select to_jsonb(public.acc_save_loan(jsonb_build_object('client_id', pg_temp.v('client'), 'lender', 'TEB', 'principal', 1200, 'rate_pct', 6, 'start_date', '2026-10-01', 'months', 12, 'account_id', pg_temp.v('bank'))) is not null)$$);
select pg_temp.try('instalment', $$select to_jsonb(public.acc_save_transaction(jsonb_build_object('account_id', pg_temp.v('bank'), 'amount', -100, 'category', 'loan', 'loan_id', (select id from public.acc_loans limit 1), 'tx_date', '2026-11-01')) is not null)$$);
select pg_temp.try('loans', $$select jsonb_agg(jsonb_build_object('p', x->'principal', 'repaid', x->'repaid')) from jsonb_array_elements(public.acc_loans_list(pg_temp.v('client')::uuid)) x$$);
select pg_temp.try('dashboard', $$select jsonb_build_object('oct', d->'months'->9, 'recv', d->'receivable', 'pay', d->'payable', 'acc', jsonb_array_length(d->'accounts'), 'recent', jsonb_array_length(d->'recent'), 'vat_prev', d->'vat_prev'->'due') from public.acc_client_dashboard(pg_temp.v('client')::uuid, 2026) d$$);
select pg_temp.try('delete used account', $$select to_jsonb(public.acc_delete_account(pg_temp.v('cash')::uuid))$$);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select pg_temp.try('B accounts', $$select to_jsonb(count(*)) from public.acc_money_accounts$$);
select pg_temp.try('B lines', $$select to_jsonb(count(*)) from public.acc_bank_lines$$);
select pg_temp.try('B tx', $$select to_jsonb(count(*)) from public.acc_transactions$$);
select pg_temp.try('B ledger', $$select public.acc_account_ledger(pg_temp.v('bank')::uuid, '2026-10-01', '2026-10-31')$$);
select pg_temp.try('B move', $$select to_jsonb(public.acc_save_transaction(jsonb_build_object('account_id', pg_temp.v('bank'), 'amount', 5)))$$);

reset role;
do $$ begin raise exception 'RESULTS %', (select string_agg(k || ' => ' || v, E'\n') from t_results); end $$;
