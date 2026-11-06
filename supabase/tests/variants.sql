-- Variants test (0009). Run after migrations 0001–0009 inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-owner@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','t-worker@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type) values ('aaaaaaaa-0000-0000-0000-000000000000','T Butik','boutique');
insert into public.profiles (id, business_id, role, full_name) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner'),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','worker','Worker');
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
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_vars select 'm', to_jsonb(public.save_product('{"name":"Xhinse slim fit","sale_price":45,"purchase_price":20,"vat_code":"E","unit":"cope"}'::jsonb));
insert into t_vars select 'v', public.save_variants(jsonb_build_object('product_id', (select v#>>'{}' from t_vars where k='m'),
  'sizes', '["28/32","29/32","30/32","29/32"]'::jsonb, 'colors', '[{"name":"Blu e errët","hex":"#1E3A5F"},{"name":"E zezë","hex":"#111111"}]'::jsonb));
insert into t_results select 'variants', jsonb_array_length(v)::text from t_vars where k='v';
insert into t_results select 'names', (select string_agg(name, ' | ' order by name) from public.products where parent_id = (select (v#>>'{}')::uuid from t_vars where k='m') and active);
insert into t_results select 'barcodes ok', (select count(*)::text from public.products where parent_id = (select (v#>>'{}')::uuid from t_vars where k='m') and barcode ~ '^20\d{11}$');
insert into t_results select 'child cost', (select string_agg(distinct pc.purchase_price::text, ',') from public.product_costs pc join public.products c on c.id = pc.product_id where c.parent_id = (select (v#>>'{}')::uuid from t_vars where k='m'));
select public.save_product(jsonb_build_object('id', (select v#>>'{}' from t_vars where k='m'), 'name','Xhinse Slim','sale_price',49,'purchase_price',22,'vat_code','E','unit','cope'));
insert into t_results select 'after model change', (select string_agg(distinct sale_price::text || '/' || split_part(name, ' · ', 1), ',') from public.products where parent_id = (select (v#>>'{}')::uuid from t_vars where k='m'));
insert into t_results select 'child cost after', (select string_agg(distinct pc.purchase_price::text, ',') from public.product_costs pc join public.products c on c.id = pc.product_id where c.parent_id = (select (v#>>'{}')::uuid from t_vars where k='m'));
insert into t_vars select 'v1', to_jsonb((select id from public.products where parent_id = (select (v#>>'{}')::uuid from t_vars where k='m') and variant_size = '30/32' and variant_color = 'E zezë'));
select public.confirm_stock_entry(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', (select v#>>'{}' from t_vars where k='v1'), 'quantity', 3, 'unit_cost', 22))));
select pg_temp.try('entry on model', format($$select to_jsonb(public.save_stock_entry('{"items":[{"product_id":"%s","quantity":1,"unit_cost":1}]}'::jsonb))$$, (select v#>>'{}' from t_vars where k='m')));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select pg_temp.try('sell variant', format($$select to_jsonb(public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000001","items":[{"product_id":"%s","quantity":1}],"payment":{"method":"card"}}'::jsonb)->'items'->0->>'name')$$, (select v#>>'{}' from t_vars where k='v1')));
select pg_temp.try('sell model', format($$select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000002","items":[{"product_id":"%s","quantity":1}],"payment":{"method":"card"}}'::jsonb)$$, (select v#>>'{}' from t_vars where k='m')));
insert into t_results select 'variant stock', (select stock::text from public.products where id = (select (v#>>'{}')::uuid from t_vars where k='v1'));
select pg_temp.try('worker save variants', format($$select public.save_variants('{"product_id":"%s","sizes":["XS"]}'::jsonb)$$, (select v#>>'{}' from t_vars where k='m')));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_vars select 'v2', public.save_variants(jsonb_build_object('product_id', (select v#>>'{}' from t_vars where k='m'), 'sizes', '["29/32","30/32"]'::jsonb, 'colors', '[{"name":"Blu e errët"},{"name":"E zezë"}]'::jsonb));
insert into t_results select 'after removing 28/32', jsonb_array_length(v)::text || ' active, archived ' || (select count(*)::text from public.products where parent_id = (select (v#>>'{}')::uuid from t_vars where k='m') and not active) from t_vars where k='v2';
select pg_temp.try('variants of a variant', format($$select public.save_variants('{"product_id":"%s","sizes":["S"]}'::jsonb)$$, (select v#>>'{}' from t_vars where k='v1')));
select public.save_product('{"name":"Rrip","sale_price":10,"initial_stock":5}'::jsonb);
select pg_temp.try('model with stock', $$select public.save_variants(jsonb_build_object('product_id', (select id from public.products where name = 'Rrip'), 'sizes', '["S"]'::jsonb))$$);
reset role;
do $$ begin raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results); end $$;
