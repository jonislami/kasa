-- Restaurant test (0011). Run after migrations 0001–0011 inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000d1','t-owner@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000d2','t-waiter@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type) values ('aaaaaaaa-0000-0000-0000-0000000000dd','T Kafe','restaurant');
insert into public.profiles (id, business_id, role, full_name) values
 ('00000000-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-0000000000dd','admin','Owner'),
 ('00000000-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-0000000000dd','worker','Kamarieri');
create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create temp table t_vars (k text primary key, v jsonb);
grant all on t_vars to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 240), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || sqlerrm);
end $f$;
create or replace function pg_temp.v(p_k text) returns text language sql as $f$ select v#>>'{}' from t_vars where k = p_k $f$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
insert into public.categories (name, station) values ('Pije', 'bar'), ('Ushqim', 'kitchen'), ('Të ftohta', null);
insert into t_vars select 'kafe', to_jsonb(public.save_product(jsonb_build_object('name','Makiato','sale_price',1.2,'vat_code','D','category_id',(select id from public.categories where name='Pije'))));
insert into t_vars select 'burger', to_jsonb(public.save_product(jsonb_build_object('name','Burger','sale_price',4.5,'vat_code','E','category_id',(select id from public.categories where name='Ushqim'))));
insert into t_vars select 'uje', to_jsonb(public.save_product(jsonb_build_object('name','Ujë 0.5','sale_price',0.8,'vat_code','E','initial_stock',20,'purchase_price',0.3,'category_id',(select id from public.categories where name='Të ftohta'))));
insert into t_vars select 'buke', to_jsonb(public.save_product('{"name":"Bukë burgeri","sale_price":0,"purchase_price":0.25,"initial_stock":50}'::jsonb));
insert into t_vars select 'mish', to_jsonb(public.save_product('{"name":"Mish i grirë","unit":"kg","sale_price":0,"purchase_price":8,"initial_stock":5}'::jsonb));
select pg_temp.try('1 modifiers', format($$select public.save_modifiers('{"product_id":"%s","groups":[{"name":"Qumështi","options":[{"name":"I zakonshëm"},{"name":"Bajame","price":0.3}]},{"name":"Sheqeri","multi":true,"options":[{"name":"Pa sheqer"}]}]}'::jsonb)$$, pg_temp.v('kafe')));
insert into t_results select '1b addon', (select name || ' ' || sale_price || ' ' || kind || ' pos=' || show_in_pos from public.products where addon_of = pg_temp.v('kafe')::uuid);
select pg_temp.try('2 recipe', format($$select public.save_recipe('{"product_id":"%s","items":[{"ingredient_id":"%s","quantity":1},{"ingredient_id":"%s","quantity":0.15}]}'::jsonb)$$, pg_temp.v('burger'), pg_temp.v('buke'), pg_temp.v('mish')));
select pg_temp.try('2b recipe cycle', format($$select public.save_recipe('{"product_id":"%s","items":[{"ingredient_id":"%s","quantity":1}]}'::jsonb)$$, pg_temp.v('buke'), pg_temp.v('mish')));
insert into t_vars select 'tables', public.save_tables('{"tables":[{"name":"1","x":0,"y":0},{"name":"2","x":1,"y":0},{"name":"T1","area":"Terasa","shape":"round","seats":2}]}'::jsonb);
insert into t_results select '3 tables', jsonb_array_length(v)::text from t_vars where k = 'tables';
-- waiter
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select pg_temp.try('3b waiter tables', $$select public.save_tables('{"tables":[]}'::jsonb)$$);
insert into t_vars select 'o', public.open_order(jsonb_build_object('table_id', (select id from public.dining_tables where name = '1'), 'guests', 3));
insert into t_vars select 'o_again', public.open_order(jsonb_build_object('table_id', (select id from public.dining_tables where name = '1')));
insert into t_results select '4 same order', ((select v->>'id' from t_vars where k='o') = (select v->>'id' from t_vars where k='o_again'))::text;
select public.add_order_items(jsonb_build_object('order_id', (select v->>'id' from t_vars where k='o'), 'items', jsonb_build_array(
  jsonb_build_object('product_id', pg_temp.v('kafe'), 'quantity', 2, 'modifiers', '[{"group":"Qumështi","name":"Bajame"},{"group":"Sheqeri","name":"Pa sheqer"}]'::jsonb),
  jsonb_build_object('product_id', pg_temp.v('kafe'), 'quantity', 1),
  jsonb_build_object('product_id', pg_temp.v('burger'), 'quantity', 1, 'note', 'pa qepë'),
  jsonb_build_object('product_id', pg_temp.v('uje'), 'quantity', 2))));
insert into t_vars select 'o2', public.add_order_items(jsonb_build_object('order_id', (select v->>'id' from t_vars where k='o'), 'items', jsonb_build_array(
  jsonb_build_object('product_id', pg_temp.v('kafe'), 'quantity', 1))));
insert into t_results select '5 lines', (select string_agg(x->>'name' || ' x' || (x->>'quantity')::numeric || ' €' || (x->>'unit_price') || coalesce(' [' || (select string_agg(m->>'name', ',') from jsonb_array_elements(x->'modifiers') m) || ']', ''), ' | ') from t_vars, jsonb_array_elements(v->'items') x where k='o2');
select pg_temp.try('5b bad modifier', format($$select public.add_order_items('{"order_id":"%s","items":[{"product_id":"%s","modifiers":[{"group":"Qumështi","name":"Soje"}]}]}'::jsonb)$$, (select v->>'id' from t_vars where k='o'), pg_temp.v('kafe')));
insert into t_vars select 'sent', public.send_order(jsonb_build_object('order_id', (select v->>'id' from t_vars where k='o')));
insert into t_results select '6 tickets', (select string_agg(t->>'station' || ':' || jsonb_array_length(t->'items'), ',' order by t->>'station') from t_vars, jsonb_array_elements(v->'tickets') t where k='sent');
insert into t_results select '6b statuses', (select string_agg(distinct x->>'status', ',') from t_vars, jsonb_array_elements(v->'order'->'items') x where k='sent');
select pg_temp.try('7 edit sent', format($$select public.set_order_item('{"item_id":"%s","quantity":5}'::jsonb)$$, (select id from public.order_items where name='Burger')));
select pg_temp.try('7b cancel sent no pin', format($$select public.cancel_order_item('{"item_id":"%s","quantity":1,"reason":"x"}'::jsonb)$$, (select id from public.order_items where name='Ujë 0.5')));
select pg_temp.try('8 done ticket', format($$select to_jsonb(public.set_ticket('{"ticket_id":"%s","done":true}'::jsonb)) $$, (select id from public.kitchen_tickets where station='kitchen')));
insert into t_results select '8b burger status', (select status from public.order_items where name='Burger');
-- split: pay 2 makiato with almond milk (+ add-on lines) and the burger
insert into t_vars select 's1', public.create_sale(jsonb_build_object('client_id','11111111-0000-0000-0000-0000000000d1','order_id',(select v->>'id' from t_vars where k='o'),
  'items', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.v('kafe'), 'quantity', 2, 'order_item_id', (select id from public.order_items where name='Makiato' and modifiers <> '[]'::jsonb)),
    jsonb_build_object('product_id', (select id from public.products where addon_of = pg_temp.v('kafe')::uuid), 'quantity', 2, 'order_item_id', (select id from public.order_items where name='Makiato' and modifiers <> '[]'::jsonb), 'addon', true),
    jsonb_build_object('product_id', pg_temp.v('burger'), 'quantity', 1, 'order_item_id', (select id from public.order_items where name='Burger'))),
  'payment', '{"method":"card"}'::jsonb));
insert into t_results select '9 sale 1', (v->>'total') || ' lines ' || jsonb_array_length(v->'items') from t_vars where k='s1';
insert into t_results select '9b ingredients', (select string_agg(name || '=' || stock, ', ' order by name) from public.products where name in ('Bukë burgeri','Mish i grirë','Burger'));
insert into t_results select '9c burger cost', (select pc.purchase_price::text from public.product_costs pc where pc.product_id = pg_temp.v('burger')::uuid);
select pg_temp.try('9d pay again', format($$select public.create_sale('{"client_id":"11111111-0000-0000-0000-0000000000d9","order_id":"%s","items":[{"product_id":"%s","quantity":1,"order_item_id":"%s"}],"payment":{"method":"card"}}'::jsonb)->'total'$$,
  (select v->>'id' from t_vars where k='o'), pg_temp.v('burger'), (select id from public.order_items where name='Burger')));
-- replay of the same sale (offline) does not count twice
select public.create_sale(jsonb_build_object('client_id','11111111-0000-0000-0000-0000000000d1','order_id',(select v->>'id' from t_vars where k='o'),
  'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.v('burger'), 'quantity', 1, 'order_item_id', (select id from public.order_items where name='Burger'))),
  'payment', '{"method":"card"}'::jsonb));
insert into t_results select '9e paid after replay', (select string_agg(name || ' ' || paid_qty || '/' || quantity, ', ' order by name, quantity) from public.order_items where order_id = (select (v->>'id')::uuid from t_vars where k='o'));
-- move to table 2 (free), then a new order on table 1 merges into it
select pg_temp.try('10 move', format($$select public.move_order('{"order_id":"%s","table_id":"%s"}'::jsonb)->'table_name'$$, (select v->>'id' from t_vars where k='o'), (select id from public.dining_tables where name='2')));
insert into t_vars select 'o3', public.open_order(jsonb_build_object('table_id', (select id from public.dining_tables where name = '1')));
select public.add_order_items(jsonb_build_object('order_id', (select v->>'id' from t_vars where k='o3'), 'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.v('uje'), 'quantity', 1))));
insert into t_vars select 'merged', public.move_order(jsonb_build_object('order_id', (select v->>'id' from t_vars where k='o3'), 'table_id', (select id from public.dining_tables where name='2')));
insert into t_results select '10b merged', ((select v->>'id' from t_vars where k='merged') = (select v->>'id' from t_vars where k='o'))::text || ' items ' || (select jsonb_array_length(v->'items') from t_vars where k='merged') || ' src ' || (select status from public.orders where id = (select (v->>'id')::uuid from t_vars where k='o3'));
-- pay the rest → order closes
insert into t_vars select 'rest', jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity - paid_qty, 'order_item_id', id))
  from public.order_items where order_id = (select (v->>'id')::uuid from t_vars where k='o') and status <> 'cancelled' and quantity > paid_qty;
insert into t_vars select 's2', public.create_sale(jsonb_build_object('client_id','11111111-0000-0000-0000-0000000000d2','order_id',(select v->>'id' from t_vars where k='o'),
  'items', (select v from t_vars where k='rest'), 'payment', '{"method":"cash","tendered":10}'::jsonb));
insert into t_results select '11 sale 2', (v->>'total') from t_vars where k='s2';
insert into t_results select '11b order', (select status from public.orders where id = (select (v->>'id')::uuid from t_vars where k='o'));
insert into t_results select '11c water stock', (select stock::text from public.products where name='Ujë 0.5');
-- an empty order opened by mistake can be cancelled
insert into t_vars select 'o4', public.open_order(jsonb_build_object('table_id', (select id from public.dining_tables where name = 'T1')));
select pg_temp.try('12 cancel empty', format($$select to_jsonb(public.cancel_order('{"order_id":"%s"}'::jsonb))$$, (select v->>'id' from t_vars where k='o4')));
insert into t_results select '12b', (select status from public.orders where id = (select (v->>'id')::uuid from t_vars where k='o4'));
-- a normal sale (no order) still works
select pg_temp.try('13 plain sale', format($$select public.create_sale('{"client_id":"11111111-0000-0000-0000-0000000000d3","items":[{"product_id":"%s","quantity":1}],"payment":{"method":"card"}}'::jsonb)->'total'$$, pg_temp.v('uje')));
reset role;
do $$ begin raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n' order by k) from t_results); end $$;
