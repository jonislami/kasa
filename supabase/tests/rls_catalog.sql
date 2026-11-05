-- Catalog test (0001). Run after the migration inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-ownera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','t-workera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','t-ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type) values
 ('aaaaaaaa-0000-0000-0000-000000000000','T Market A','market'),
 ('bbbbbbbb-0000-0000-0000-000000000000','T Sallon B','salon');
insert into public.profiles (id, business_id, role, full_name) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner A'),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','worker','Worker A'),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B');

create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create temp table t_vars (k text primary key, v text);
grant all on t_vars to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
begin
  execute p_sql;
  insert into t_results values (p_key, 'ok');
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || sqlerrm);
end $f$;

insert into t_results select 'check digit 200000000020', public.ean13_check_digit('200000000020')::text;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into public.categories (name) values ('Bulmet');
insert into t_vars select 'cat', id::text from public.categories where name = 'Bulmet';
insert into t_vars select 'bc', public.next_internal_barcode();
insert into t_results select 'barcode', v from t_vars where k = 'bc';
insert into t_vars select 'p1', public.save_product(jsonb_build_object(
  'name','Qumësht 1L','barcode','3870001000124','category_id',(select v from t_vars where k='cat'),
  'unit','cope','sale_price',0.95,'purchase_price',0.72,'vat_code','D','min_stock',24,'initial_stock',64))::text;
insert into t_results select 'p1 stock/min/vat', stock::text || '/' || min_stock::text || '/' || vat_code from public.products where id = (select v from t_vars where k='p1')::uuid;
insert into t_results select 'p1 cost', purchase_price::text from public.product_costs where product_id = (select v from t_vars where k='p1')::uuid;
insert into t_results select 'p1 movements', count(*)::text from public.stock_movements;
select pg_temp.try('dup barcode', $$select public.save_product('{"name":"X","barcode":"3870001000124","sale_price":1}'::jsonb)$$);
select pg_temp.try('update price', format($$select public.save_product('{"id":"%s","name":"Qumësht 1L","barcode":"3870001000124","sale_price":0.99,"purchase_price":0.75,"vat_code":"D"}'::jsonb)$$, (select v from t_vars where k='p1')));
insert into t_results select 'p1 stock after update', stock::text from public.products where id = (select v from t_vars where k='p1')::uuid;
insert into t_results select 'audit price_change', count(*)::text from public.audit_log where action = 'price_change';
insert into t_results select 'import', public.import_products('[
  {"name":"Qumësht 1L","barcode":"3870001000124","sale_price":1.05,"purchase_price":0.80,"category":"bulmet"},
  {"name":"Domate","unit":"kg","sale_price":0.85,"category":"Pemë & Perime","stock":12.5,"vat_code":"D"},
  {"name":"Larje flokësh","kind":"service","sale_price":5,"duration_min":30,"stock":9}
]'::jsonb)::text;
insert into t_results select 'categories', string_agg(name, ',' order by name) from public.categories;
insert into t_results select 'domate stock', stock::text from public.products where name = 'Domate';
insert into t_results select 'service stock/unit/dur', stock::text || '/' || unit || '/' || duration_min::text from public.products where kind = 'service';
select pg_temp.try('owner direct insert product', $$insert into public.products (name, sale_price) values ('Hack', 1)$$);
select pg_temp.try('owner direct update stock', $$update public.products set stock = 999$$);
select pg_temp.try('archive p1', format($$select public.set_product_active('%s', false)$$, (select v from t_vars where k='p1')));
select pg_temp.try('reuse barcode after archive', $$select public.save_product('{"name":"Qumësht i ri","barcode":"3870001000124","sale_price":1}'::jsonb)$$);
select pg_temp.try('restore p1 (barcode taken)', format($$select public.set_product_active('%s', true)$$, (select v from t_vars where k='p1')));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
insert into t_results select 'worker products', count(*)::text from public.products;
insert into t_results select 'worker costs', count(*)::text from public.product_costs;
insert into t_results select 'worker movements', count(*)::text from public.stock_movements;
select pg_temp.try('worker save_product', $$select public.save_product('{"name":"W","sale_price":1}'::jsonb)$$);
select pg_temp.try('worker barcode', $$select public.next_internal_barcode()$$);
select pg_temp.try('worker add category', $$insert into public.categories (name) values ('W')$$);
select pg_temp.try('worker import', $$select public.import_products('[{"name":"W","sale_price":1}]'::jsonb)$$);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t_results select 'B products', count(*)::text from public.products;
insert into t_results select 'B categories', count(*)::text from public.categories;
select pg_temp.try('B save with A category', format($$select public.save_product('{"name":"Y","sale_price":1,"category_id":"%s"}'::jsonb)$$, (select v from t_vars where k='cat')));

reset role;
do $$ begin
  raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results);
end $$;
