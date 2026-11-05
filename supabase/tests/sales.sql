-- Sales test (0002). Run after migrations 0001 + 0002 inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-ownera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','t-workera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','t-ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type) values
 ('aaaaaaaa-0000-0000-0000-000000000000','T Market A','market'),
 ('bbbbbbbb-0000-0000-0000-000000000000','T Market B','market');
insert into public.profiles (id, business_id, role, full_name) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner A'),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','worker','Worker A'),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B');
insert into public.registers (id, business_id, name) values ('aaaaaaaa-1111-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000000','Arka 1');
insert into public.products (id, business_id, name, unit, sale_price, vat_code, stock) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Qumësht 1L','cope',0.95,'D',10),
 ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Ujë 1.5L','cope',0.45,'E',100),
 ('aaaaaaaa-2222-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000000','Domate','kg',1.20,'D',20);
insert into public.product_costs (product_id, business_id, purchase_price) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',0.72);

create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create temp table t_vars (k text primary key, v jsonb);
grant all on t_vars to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 160), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || sqlerrm);
end $f$;

-- ---------- owner sets PIN ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select pg_temp.try('weak pin', $$select to_jsonb(public.set_own_pin('1234'))$$);
select public.set_own_pin('2580');
insert into t_results select 'pin set', public.my_pin_status()::text;

-- ---------- worker sells ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
insert into t_vars select 's1', public.create_sale('{
  "client_id":"11111111-0000-0000-0000-000000000001","register_id":"aaaaaaaa-1111-0000-0000-000000000000",
  "items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":2,"unit_price":0.95},
           {"product_id":"aaaaaaaa-2222-0000-0000-000000000002","quantity":6,"unit_price":0.45}],
  "invoice_discount":0.10, "payment":{"method":"cash","tendered":20}}'::jsonb);
insert into t_results select 's1 no/daily/total/change', (v->>'invoice_no') || '/' || (v->>'daily_no') || '/' || (v->>'total') || '/' || (v->>'change_amount') from t_vars where k='s1';
insert into t_results select 's1 vat', (v->'vat_lines')::text from t_vars where k='s1';
insert into t_results select 's1 items', (select string_agg((x->>'name') || ':' || (x->>'total') || '(-' || (x->>'invoice_discount') || ')', ', ') from jsonb_array_elements(v->'items') x) from t_vars where k='s1';
insert into t_results select 'stock after s1', (select string_agg(name || '=' || stock::text, ', ' order by name) from public.products);
insert into t_results select 'idempotent', (public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000001","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":99}],"payment":{"method":"cash"}}'::jsonb)->>'invoice_no');
insert into t_vars select 's2', public.create_sale('{
  "client_id":"11111111-0000-0000-0000-000000000002",
  "items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":1,"unit_price":0.01},
           {"product_id":"aaaaaaaa-2222-0000-0000-000000000003","quantity":1.2345,"discount":0.10}],
  "payment":{"method":"mixed","card_amount":1.00,"tendered":5}}'::jsonb);
insert into t_results select 's2 no/total/cash/card/change', (v->>'invoice_no') || '/' || (v->>'total') || '/' || (v->>'cash_amount') || '/' || (v->>'card_amount') || '/' || (v->>'change_amount') from t_vars where k='s2';
insert into t_results select 's2 items', (select string_agg((x->>'name') || ':' || (x->>'quantity') || 'x' || (x->>'unit_price') || '=' || (x->>'total'), ', ') from jsonb_array_elements(v->'items') x) from t_vars where k='s2';
select pg_temp.try('tendered too low', $$select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000003","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":1}],"payment":{"method":"cash","tendered":0.5}}'::jsonb)$$);
select pg_temp.try('empty sale', $$select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000004","items":[],"payment":{"method":"cash"}}'::jsonb)$$);
select pg_temp.try('other business product', $$select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000005","items":[{"product_id":"00000000-9999-0000-0000-000000000000","quantity":1}],"payment":{"method":"card"}}'::jsonb)$$);
insert into t_results select 'worker sees sales', count(*)::text from public.sales;
insert into t_results select 'worker sees costs', count(*)::text from public.sale_item_costs;
select pg_temp.try('worker update sale', $$update public.sales set total = 0 returning to_jsonb(id)$$);

-- void without / with wrong / with right PIN
select pg_temp.try('void no pin', format($$select public.void_sale('{"client_id":"22222222-0000-0000-0000-000000000001","sale_id":"%s","reason":"Gabim në arkë"}'::jsonb)$$, (select v->>'id' from t_vars where k='s2')));
select pg_temp.try('void wrong pin', format($$select public.void_sale('{"client_id":"22222222-0000-0000-0000-000000000001","sale_id":"%s","reason":"Gabim në arkë","approver_id":"00000000-0000-0000-0000-0000000000b1","pin":"1111"}'::jsonb)$$, (select v->>'id' from t_vars where k='s2')));
select pg_temp.try('void right pin', format($$select public.void_sale('{"client_id":"22222222-0000-0000-0000-000000000001","sale_id":"%s","reason":"Gabim në arkë","approver_id":"00000000-0000-0000-0000-0000000000b1","pin":"2580"}'::jsonb)$$, (select v->>'id' from t_vars where k='s2')));
insert into t_results select 'stock after void', (select string_agg(name || '=' || stock::text, ', ' order by name) from public.products);
select pg_temp.try('void twice', format($$select public.void_sale('{"client_id":"22222222-0000-0000-0000-000000000002","sale_id":"%s","reason":"x","approver_id":"00000000-0000-0000-0000-0000000000b1","pin":"2580"}'::jsonb)$$, (select v->>'id' from t_vars where k='s2')));

-- refunds on s1 (water line: 6 × 0.45 with invoice discount share)
insert into t_vars select 'water_item', to_jsonb(x->>'id') from t_vars, jsonb_array_elements(v->'items') x where k='s1' and x->>'name' like 'Ujë%';
select pg_temp.try('refund 2 water', format($$select public.refund_sale('{"client_id":"33333333-0000-0000-0000-000000000001","sale_id":"%s","items":[{"sale_item_id":"%s","quantity":2}],"reason":"Produkt i dëmtuar","method":"cash","approver_id":"00000000-0000-0000-0000-0000000000b1","pin":"2580"}'::jsonb)->'sale'->'total'$$, (select v->>'id' from t_vars where k='s1'), (select v#>>'{}' from t_vars where k='water_item')));
select pg_temp.try('refund 5 more water', format($$select public.refund_sale('{"client_id":"33333333-0000-0000-0000-000000000002","sale_id":"%s","items":[{"sale_item_id":"%s","quantity":5}],"reason":"x","method":"cash","approver_id":"00000000-0000-0000-0000-0000000000b1","pin":"2580"}'::jsonb)$$, (select v->>'id' from t_vars where k='s1'), (select v#>>'{}' from t_vars where k='water_item')));
select pg_temp.try('refund rest 4 water', format($$select public.refund_sale('{"client_id":"33333333-0000-0000-0000-000000000003","sale_id":"%s","items":[{"sale_item_id":"%s","quantity":4}],"reason":"x","method":"card","approver_id":"00000000-0000-0000-0000-0000000000b1","pin":"2580"}'::jsonb)->'sale'->'total'$$, (select v->>'id' from t_vars where k='s1'), (select v#>>'{}' from t_vars where k='water_item')));
select pg_temp.try('void after refunds', format($$select public.void_sale('{"client_id":"22222222-0000-0000-0000-000000000003","sale_id":"%s","reason":"x","approver_id":"00000000-0000-0000-0000-0000000000b1","pin":"2580"}'::jsonb)$$, (select v->>'id' from t_vars where k='s1')));
insert into t_results select 'lookup s1 refunded', (select string_agg((x->>'name') || ' refunded ' || (x->>'refunded'), ', ') from jsonb_array_elements(public.lookup_sale(1)->'items') x);

-- ---------- owner checks ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'owner sees sales', count(*)::text || ' / kinds ' || string_agg(kind || '#' || invoice_no, ',' order by invoice_no) from public.sales;
insert into t_results select 'sum s2+void', sum(total)::text from public.sales where id = (select (v->>'id')::uuid from t_vars where k='s2') or ref_sale_id = (select (v->>'id')::uuid from t_vars where k='s2');
insert into t_results select 'sum water line + refunds', (select sum(total)::text from public.sale_items where id = (select (v#>>'{}')::uuid from t_vars where k='water_item') or ref_item_id = (select (v#>>'{}')::uuid from t_vars where k='water_item'));
insert into t_results select 'owner sees costs', count(*)::text from public.sale_item_costs;
insert into t_results select 'movements', (select string_agg(kind || ':' || quantity::text, ', ' order by id) from public.stock_movements);
insert into t_results select 'audit', (select string_agg(action, ',' order by id) from public.audit_log where business_id = 'aaaaaaaa-0000-0000-0000-000000000000');
insert into t_vars select 's9', public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000009","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000003","quantity":0.5}],"payment":{"method":"card"}}'::jsonb);
insert into t_results select 'owner void directly (no pin)', (public.void_sale(jsonb_build_object('client_id','22222222-0000-0000-0000-000000000009','sale_id',(select v->>'id' from t_vars where k='s9'),'reason','x'))->>'ok');

-- ---------- other business ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t_results select 'B sees sales', count(*)::text from public.sales;
insert into t_results select 'B lookup #1', coalesce(public.lookup_sale(1)::text, 'null');
select pg_temp.try('B sells A product', $$select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000001","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":1}],"payment":{"method":"cash"}}'::jsonb)$$);

reset role;
do $$ begin
  raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results);
end $$;
