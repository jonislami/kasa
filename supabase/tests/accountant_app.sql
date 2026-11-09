-- Accountant program test (0013). Run after migrations 0001–0013 inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-ownera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','t-workera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','t-ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000d1','t-acc@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000d2','t-acc2@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type, nui, vat_number) values
 ('aaaaaaaa-0000-0000-0000-000000000000','T Market A','market','811111111','330111111'),
 ('bbbbbbbb-0000-0000-0000-000000000000','T Market B','market','822222222',null);
insert into public.profiles (id, business_id, role, full_name) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner A'),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','worker','Worker A'),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B');
insert into public.products (id, business_id, name, unit, sale_price, vat_code, stock) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Qumësht 1L','cope',1.08,'D',100);
insert into public.product_costs (product_id, business_id, purchase_price) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',0.54);
-- the platform admin's Edge Function creates these rows
insert into public.accountants (user_id, full_name, email, office_name) values
 ('00000000-0000-0000-0000-0000000000d1','Kont Abilisti','t-acc@test.local','Zyra K'),
 ('00000000-0000-0000-0000-0000000000d2','Tjetri','t-acc2@test.local','Zyra T');

create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create temp table t_vars (k text primary key, v text);
grant all on t_vars to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 500), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || left(sqlerrm, 110));
end $f$;

set local role authenticated;

-- worker A sells 10 milk
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000001","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":10}],"payment":{"method":"cash"}}'::jsonb);
select pg_temp.try('worker acc_me', $$select public.acc_me() - 'user_id'$$);
select pg_temp.try('worker save client', $$select to_jsonb(public.acc_save_client('{"name":"X"}'::jsonb))$$);
select pg_temp.try('worker clients', $$select to_jsonb(count(*)) from public.acc_clients$$);

-- accountant 1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select pg_temp.try('acc_me', $$select public.acc_me() - 'user_id'$$);
select pg_temp.try('client bad nui', $$select to_jsonb(public.acc_save_client('{"name":"Y","nui":"123"}'::jsonb))$$);
insert into t_vars select 'manual', public.acc_save_client('{"name":"Dyqani Jashtë","nui":"899999999","vat_number":"330999999","city":"Ferizaj"}'::jsonb)::text;
insert into t_vars select 'kasa', public.acc_save_client('{"name":"Market A","vat_registered":true}'::jsonb)::text;
select pg_temp.try('client dup nui', $$select to_jsonb(public.acc_save_client('{"name":"Z","nui":"899999999"}'::jsonb))$$);
-- documents for the manual client
select pg_temp.try('sale 1', $$select to_jsonb(public.acc_save_document(jsonb_build_object('client_id',(select v from t_vars where k='manual'),'kind','sale','doc_date',current_date,'doc_no','F-1','partner_name','Blerësi','net_e',100,'vat_e',18,'net_d',50,'vat_d',4)) is not null)$$);
select pg_temp.try('purchase goods', $$select to_jsonb(public.acc_save_document(jsonb_build_object('client_id',(select v from t_vars where k='manual'),'kind','purchase','category','goods','doc_date',current_date,'partner_name','Furnitori','partner_nui','811000000','net_e',60,'vat_e',10.80,'payment','due')) is not null)$$);
select pg_temp.try('purchase rent', $$select to_jsonb(public.acc_save_document(jsonb_build_object('client_id',(select v from t_vars where k='manual'),'kind','purchase','category','rent','doc_date',current_date,'amt_a',200)) is not null)$$);
select pg_temp.try('doc zero', $$select to_jsonb(public.acc_save_document(jsonb_build_object('client_id',(select v from t_vars where k='manual'),'kind','sale','doc_date',current_date)))$$);
select pg_temp.try('import', $$select to_jsonb(public.acc_import_documents((select v from t_vars where k='manual')::uuid, jsonb_build_array(
   jsonb_build_object('kind','sale','doc_date',current_date,'net_e',10,'vat_e',1.80),
   jsonb_build_object('kind','purchase','category','utilities','doc_date',current_date,'net_e',20,'vat_e',3.60))))$$);
select pg_temp.try('import bad row', $$select to_jsonb(public.acc_import_documents((select v from t_vars where k='manual')::uuid, jsonb_build_array(
   jsonb_build_object('kind','sale','doc_date',current_date,'net_e',10), jsonb_build_object('kind','x','doc_date',current_date,'net_e',1))))$$);
select pg_temp.try('period filed', $$select to_jsonb(public.acc_set_period((select v from t_vars where k='manual')::uuid, current_date, 'filed'))$$);
insert into t_results select 'books manual', (public.acc_client_books((select v from t_vars where k='manual')::uuid, date_trunc('month', current_date)::date, current_date) -> 'manual')::text;
insert into t_results select 'books kasa none', coalesce(public.acc_client_books((select v from t_vars where k='manual')::uuid, current_date, current_date) ->> 'kasa', 'null');
-- Kasa link
select pg_temp.try('link bad nui', $$select to_jsonb(public.acc_request_link((select v from t_vars where k='kasa')::uuid, '800000000'))$$);
select pg_temp.try('link A', $$select to_jsonb(public.acc_request_link((select v from t_vars where k='kasa')::uuid, '811111111'))$$);
select pg_temp.try('sales before approval', $$select to_jsonb(count(*)) from public.sales$$);
select pg_temp.try('open before approval', $$select to_jsonb(public.set_active_business('aaaaaaaa-0000-0000-0000-000000000000'))$$);
insert into t_results select 'books before approval', coalesce(public.acc_client_books((select v from t_vars where k='kasa')::uuid, current_date, current_date) ->> 'kasa', 'null');

-- accountant 2 cannot see accountant 1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select pg_temp.try('acc2 clients', $$select to_jsonb(count(*)) from public.acc_clients$$);
select pg_temp.try('acc2 docs', $$select to_jsonb(count(*)) from public.acc_documents$$);
select pg_temp.try('acc2 books of acc1', $$select public.acc_client_books((select v from t_vars where k='manual')::uuid, current_date, current_date)$$);
select pg_temp.try('acc2 doc into acc1 client', $$select to_jsonb(public.acc_save_document(jsonb_build_object('client_id',(select v from t_vars where k='manual'),'kind','sale','doc_date',current_date,'net_e',1)))$$);

-- owner B cannot approve A's request; owner A approves
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select pg_temp.try('B accountants', $$select public.business_accountants()$$);
select pg_temp.try('B approve', $$select to_jsonb(public.respond_accountant_request((select v from t_vars where k='kasa')::uuid, true))$$);
select pg_temp.try('B acc_clients', $$select to_jsonb(count(*)) from public.acc_clients$$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select pg_temp.try('worker approve', $$select to_jsonb(public.respond_accountant_request((select v from t_vars where k='kasa')::uuid, true))$$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'A requests', (select string_agg((x->>'full_name') || ' ' || (x->>'office_name') || ' ' || (x->>'status'), ', ') from jsonb_array_elements(public.business_accountants()) x);
select pg_temp.try('A approve', $$select to_jsonb(public.respond_accountant_request((select v from t_vars where k='kasa')::uuid, true))$$);
select pg_temp.try('A owner summary still works', $$select public.accounting_summary(current_date, current_date) -> 'sales' -> 'gross'$$);

-- accountant 1 after approval
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
insert into t_results select 'books kasa', (public.acc_client_books((select v from t_vars where k='kasa')::uuid, current_date, current_date) -> 'kasa' -> 'sales')::text;
select pg_temp.try('sales before open', $$select to_jsonb(count(*)) from public.sales$$);
select pg_temp.try('open A', $$select to_jsonb(public.set_active_business('aaaaaaaa-0000-0000-0000-000000000000'))$$);
select pg_temp.try('sales after open', $$select to_jsonb(count(*)) from public.sales$$);
select pg_temp.try('profiles after open', $$select to_jsonb(count(*)) from public.profiles$$);
select pg_temp.try('create_sale', $$select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000009","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":1}],"payment":{"method":"cash"}}'::jsonb)$$);
select pg_temp.try('open B', $$select to_jsonb(public.set_active_business('bbbbbbbb-0000-0000-0000-000000000000'))$$);
insert into t_results select 'overview', (select string_agg((x->>'name') || ' sales ' || (x->>'sales') || ' vat ' || (x->>'vat_out') || '/' || (x->>'vat_in') || ' ' || (x->>'vat_status') || ' ' || (x->>'link_status'), ' | ') from jsonb_array_elements(public.acc_clients_overview(current_date)) x);

-- owner A revokes
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select pg_temp.try('A revoke', $$select to_jsonb(public.revoke_accountant('00000000-0000-0000-0000-0000000000d1'))$$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select pg_temp.try('sales after revoke', $$select to_jsonb(count(*)) from public.sales$$);
insert into t_results select 'books after revoke', coalesce(public.acc_client_books((select v from t_vars where k='kasa')::uuid, current_date, current_date) ->> 'kasa', 'null') || ' ' || (select link_status from public.acc_clients where id = (select v from t_vars where k='kasa')::uuid);
select pg_temp.try('delete client', $$select to_jsonb(public.acc_delete_client((select v from t_vars where k='kasa')::uuid))$$);

-- platform admin view (as nobody → refused)
select pg_temp.try('platform list by accountant', $$select public.platform_accountants()$$);
reset role;
update public.accountants set active = false where user_id = '00000000-0000-0000-0000-0000000000d1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select pg_temp.try('inactive clients', $$select to_jsonb(count(*)) from public.acc_clients$$);
select pg_temp.try('inactive save', $$select to_jsonb(public.acc_save_client('{"name":"Q"}'::jsonb))$$);

reset role;
do $$ begin
  raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results);
end $$;
