-- Lots / FEFO test (0010). Run after migrations 0001–0010 inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000c1','t-owner@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c2','t-worker@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type) values ('aaaaaaaa-0000-0000-0000-0000000000cc','T Barnatore','pharmacy');
insert into public.profiles (id, business_id, role, full_name) values
 ('00000000-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-0000000000cc','admin','Owner'),
 ('00000000-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-0000000000cc','worker','Worker');
create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create temp table t_vars (k text primary key, v jsonb);
grant all on t_vars to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 220), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || sqlerrm);
end $f$;
create or replace function pg_temp.lots() returns text language sql as $f$
  select string_agg(coalesce(lot_no, '-') || '@' || coalesce(expires_on::text, 'pa afat') || '=' || quantity::text, ' | ' order by expires_on nulls last, lot_no)
  from public.product_lots where product_id = (select (v#>>'{}')::uuid from t_vars where k='p')
$f$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t_vars select 'p', to_jsonb(public.save_product('{"name":"Paracetamol 500mg","substance":"Paracetamol","sale_price":2.5,"purchase_price":1,"vat_code":"D","unit":"pako","initial_stock":4}'::jsonb));
-- entry: an expired lot, a lot expiring soon, a lot expiring later (listed out of order)
select public.confirm_stock_entry(jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('product_id', (select v#>>'{}' from t_vars where k='p'), 'quantity', 10, 'unit_cost', 1, 'lot_no', 'L-LATE', 'expires_on', (current_date + 400)::text),
  jsonb_build_object('product_id', (select v#>>'{}' from t_vars where k='p'), 'quantity', 5, 'unit_cost', 1, 'lot_no', 'L-SOON', 'expires_on', (current_date + 20)::text),
  jsonb_build_object('product_id', (select v#>>'{}' from t_vars where k='p'), 'quantity', 2, 'unit_cost', 1, 'lot_no', 'L-OLD', 'expires_on', (current_date - 5)::text))));
insert into t_results select '1 after entry', pg_temp.lots() || ' · stock ' || (select stock::text from public.products where id = (select (v#>>'{}')::uuid from t_vars where k='p'));
insert into t_results select '1b entry lines', (select string_agg(lot_no || ':' || expires_on::text, ',' order by position) from public.stock_entry_items where product_id = (select (v#>>'{}')::uuid from t_vars where k='p'));
-- worker sells 7: FEFO → 5 from L-SOON, 2 from L-LATE; the expired lot is not sold
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
insert into t_vars select 's1', public.create_sale(jsonb_build_object('client_id','11111111-0000-0000-0000-0000000000c1',
  'items', jsonb_build_array(jsonb_build_object('product_id', (select v#>>'{}' from t_vars where k='p'), 'quantity', 7)), 'payment', '{"method":"card"}'::jsonb));
insert into t_results select '2 after sale 7', pg_temp.lots();
insert into t_results select '2b worker sees lots', (select count(*)::text from public.product_lots);
select pg_temp.try('2c worker lot moves', $$select to_jsonb(count(*)) from public.lot_movements$$);
select pg_temp.try('2d worker write-off', format($$select to_jsonb(public.adjust_stock('{"product_id":"%s","quantity":-1,"reason":"expired"}'::jsonb))$$, (select v#>>'{}' from t_vars where k='p')));
-- owner refunds 3 of the 7 → back to the lots they came from (latest taken first: L-LATE 2, then L-SOON 1)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select public.refund_sale(jsonb_build_object('client_id','33333333-0000-0000-0000-0000000000c1','sale_id',(select v->>'id' from t_vars where k='s1'),
  'items', jsonb_build_array(jsonb_build_object('sale_item_id',(select v->'items'->0->>'id' from t_vars where k='s1'),'quantity',3)),
  'reason','x','method','cash'));
insert into t_results select '3 after refund 3', pg_temp.lots();
-- write off the expired lot
select pg_temp.try('4 write-off too much', format($$select to_jsonb(public.adjust_stock(jsonb_build_object('product_id','%s','quantity',-3,'reason','expired','lot_id',(select id from public.product_lots where lot_no='L-OLD'))))$$, (select v#>>'{}' from t_vars where k='p')));
select pg_temp.try('4b write-off expired', format($$select to_jsonb(public.adjust_stock(jsonb_build_object('product_id','%s','quantity',-2,'reason','expired','lot_id',(select id from public.product_lots where lot_no='L-OLD'))))$$, (select v#>>'{}' from t_vars where k='p')));
insert into t_results select '4c after write-off', pg_temp.lots();
-- 4 units of initial stock have no lot: assign 3 of them, then 2 more is too many
select pg_temp.try('5 assign 3', format($$select to_jsonb(public.assign_lot('{"product_id":"%s","lot_no":"L-INIT","expires_on":"%s","quantity":3}'::jsonb))$$, (select v#>>'{}' from t_vars where k='p'), current_date + 200));
select pg_temp.try('5b assign 2 more', format($$select to_jsonb(public.assign_lot('{"product_id":"%s","lot_no":"L-X","quantity":2}'::jsonb))$$, (select v#>>'{}' from t_vars where k='p')));
insert into t_results select '5c lots', pg_temp.lots() || ' · stock ' || (select stock::text from public.products where id = (select (v#>>'{}')::uuid from t_vars where k='p'));
-- sale of 20 (more than all lots) – allowed, lots go to 0, stock negative, sale not blocked
insert into t_vars select 's2', public.create_sale(jsonb_build_object('client_id','11111111-0000-0000-0000-0000000000c2',
  'items', jsonb_build_array(jsonb_build_object('product_id', (select v#>>'{}' from t_vars where k='p'), 'quantity', 20)), 'payment', '{"method":"card"}'::jsonb));
insert into t_results select '6 after sale 20', pg_temp.lots() || ' · stock ' || (select stock::text from public.products where id = (select (v#>>'{}')::uuid from t_vars where k='p'));
-- void of that sale puts everything back
select public.void_sale(jsonb_build_object('client_id','22222222-0000-0000-0000-0000000000c1','sale_id',(select v->>'id' from t_vars where k='s2'),'reason','Gabim në arkë'));
insert into t_results select '7 after void', pg_temp.lots() || ' · stock ' || (select stock::text from public.products where id = (select (v#>>'{}')::uuid from t_vars where k='p'));
-- bad expiry date
select pg_temp.try('8 bad date', format($$select to_jsonb(public.save_stock_entry('{"items":[{"product_id":"%s","quantity":1,"unit_cost":1,"lot_no":"A","expires_on":"31.12.2027"}]}'::jsonb))$$, (select v#>>'{}' from t_vars where k='p')));
-- a market product without lots is untouched
select public.save_product('{"name":"Ujë","sale_price":0.5,"initial_stock":10}'::jsonb);
select public.create_sale(jsonb_build_object('client_id','11111111-0000-0000-0000-0000000000c3',
  'items', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Ujë'), 'quantity', 3)), 'payment', '{"method":"card"}'::jsonb));
insert into t_results select '9 no-lot product', (select stock::text from public.products where name = 'Ujë') || ' lots ' || (select count(*)::text from public.product_lots l join public.products p on p.id = l.product_id where p.name = 'Ujë');
reset role;
do $$ begin raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n' order by k) from t_results); end $$;
