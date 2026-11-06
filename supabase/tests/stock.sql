-- Stock test (0003). Run after migrations 0001–0003 inside a transaction; ends with an exception
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
insert into public.products (id, business_id, kind, name, unit, sale_price, vat_code, stock, min_stock) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','product','Qumësht 1L','cope',0.95,'D',64,20),
 ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','product','Ujë 1.5L','cope',0.45,'E',100,0),
 ('aaaaaaaa-2222-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000000','product','Domate','kg',1.20,'D',20,0),
 ('aaaaaaaa-2222-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000000','service','Paketim','cope',0.50,'E',0,0);
insert into public.product_costs (product_id, business_id, purchase_price) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',0.70),
 ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000',0.30);

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

set local role authenticated;

-- ---------- worker: no access ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select pg_temp.try('worker add supplier', $$insert into public.suppliers (name) values ('X') returning to_jsonb(id)$$);
select pg_temp.try('worker save entry', $$select to_jsonb(public.save_stock_entry('{"items":[]}'::jsonb))$$);
select pg_temp.try('worker adjust', $$select to_jsonb(public.adjust_stock('{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":-1,"reason":"damage"}'::jsonb))$$);
select pg_temp.try('worker inventory', $$select public.confirm_inventory('{"items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","counted":1}]}'::jsonb)$$);
insert into t_results select 'worker sees movements', count(*)::text from public.stock_movements;

-- ---------- owner A ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into public.suppliers (id, name, nui) values ('aaaaaaaa-3333-0000-0000-000000000001', 'Furnitori Demo SH.P.K.', '811111111');
select pg_temp.try('duplicate supplier', $$insert into public.suppliers (name) values ('furnitori demo sh.p.k.') returning to_jsonb(id)$$);
select pg_temp.try('delete supplier', $$delete from public.suppliers returning to_jsonb(id)$$);

-- draft
insert into t_vars select 'e1', to_jsonb(public.save_stock_entry('{
  "supplier_id":"aaaaaaaa-3333-0000-0000-000000000001","invoice_no":"F-2026/1184","entry_date":"2026-11-02",
  "payment":"due","due_days":30,
  "items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":48,"unit_cost":0.72},
           {"product_id":"aaaaaaaa-2222-0000-0000-000000000003","quantity":12.3456,"unit_cost":0.80}]}'::jsonb));
insert into t_results select 'draft totals', status || ' items ' || items_count || ' units ' || units_total || ' total ' || total || ' net ' || net_total || ' vat ' || vat_total || ' no ' || coalesce(entry_no::text, '-')
  from public.stock_entries where id = (select (v#>>'{}')::uuid from t_vars where k='e1');
insert into t_results select 'stock untouched by draft', (select stock::text from public.products where id = 'aaaaaaaa-2222-0000-0000-000000000001');
select pg_temp.try('service in entry', $$select to_jsonb(public.save_stock_entry('{"items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000004","quantity":1,"unit_cost":1}]}'::jsonb))$$);
select pg_temp.try('zero qty', $$select to_jsonb(public.save_stock_entry('{"items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":0.4,"unit_cost":1}]}'::jsonb))$$);
select pg_temp.try('direct update entry', $$update public.stock_entries set total = 1 returning to_jsonb(id)$$);

-- confirm the draft (with an edited line)
insert into t_vars select 'c1', to_jsonb(public.confirm_stock_entry(jsonb_build_object(
  'id', (select v#>>'{}' from t_vars where k='e1'),
  'supplier_id','aaaaaaaa-3333-0000-0000-000000000001','invoice_no','F-2026/1184','entry_date','2026-11-02','payment','due','due_days',30,
  'items', '[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":48,"unit_cost":0.72},
             {"product_id":"aaaaaaaa-2222-0000-0000-000000000002","quantity":24,"unit_cost":0.30}]'::jsonb)));
insert into t_results select 'confirmed', status || ' no ' || entry_no || ' items ' || items_count || ' total ' || total || ' vat ' || vat_lines::text
  from public.stock_entries where id = (select (v#>>'{}')::uuid from t_vars where k='c1');
insert into t_results select 'stock after entry', (select string_agg(name || '=' || stock::text, ', ' order by name) from public.products where kind = 'product');
insert into t_results select 'costs after entry', (select string_agg(pr.name || '=' || pc.purchase_price::text, ', ' order by pr.name) from public.product_costs pc join public.products pr on pr.id = pc.product_id);
select pg_temp.try('confirm again', format($$select to_jsonb(public.confirm_stock_entry('{"id":"%s","items":[]}'::jsonb))$$, (select v#>>'{}' from t_vars where k='c1')));
select pg_temp.try('delete confirmed', format($$select to_jsonb(public.delete_stock_entry('%s'))$$, (select v#>>'{}' from t_vars where k='c1')));
select pg_temp.try('empty confirm', $$select to_jsonb(public.confirm_stock_entry('{"items":[]}'::jsonb))$$);

-- second draft, then delete it
insert into t_vars select 'e2', to_jsonb(public.save_stock_entry('{"items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000002","quantity":1,"unit_cost":0.3}]}'::jsonb));
select pg_temp.try('delete draft', format($$select to_jsonb(public.delete_stock_entry('%s'))$$, (select v#>>'{}' from t_vars where k='e2')));
insert into t_results select 'entries left', count(*)::text from public.stock_entries;

-- write-offs
select pg_temp.try('write-off 6 milk', $$select to_jsonb(public.adjust_stock('{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":-6,"reason":"expired","note":"skadim"}'::jsonb))$$);
select pg_temp.try('write-off positive', $$select to_jsonb(public.adjust_stock('{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":5,"reason":"damage"}'::jsonb))$$);
select pg_temp.try('correction +2', $$select to_jsonb(public.adjust_stock('{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":2,"reason":"correction"}'::jsonb))$$);
select pg_temp.try('adjust service', $$select to_jsonb(public.adjust_stock('{"product_id":"aaaaaaaa-2222-0000-0000-000000000004","quantity":-1,"reason":"loss"}'::jsonb))$$);

-- inventory
select pg_temp.try('inventory', $$select public.confirm_inventory('{"title":"Pije","items":[
  {"product_id":"aaaaaaaa-2222-0000-0000-000000000001","counted":105},
  {"product_id":"aaaaaaaa-2222-0000-0000-000000000002","counted":124},
  {"product_id":"aaaaaaaa-2222-0000-0000-000000000003","counted":19.5}]}'::jsonb)$$);
select pg_temp.try('inventory duplicate', $$select public.confirm_inventory('{"items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","counted":1},{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","counted":2}]}'::jsonb)$$);
select pg_temp.try('inventory service', $$select public.confirm_inventory('{"items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000004","counted":1}]}'::jsonb)$$);
select pg_temp.try('inventory negative', $$select public.confirm_inventory('{"items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","counted":-1}]}'::jsonb)$$);
insert into t_results select 'inventory items', (select string_agg(name || ' ' || expected || '→' || counted || ' (' || diff || ')', ', ' order by name) from public.inventory_count_items);
select pg_temp.try('update inventory', $$update public.inventory_counts set note = 'x' returning to_jsonb(id)$$);

insert into t_results select 'stock final', (select string_agg(name || '=' || stock::text, ', ' order by name) from public.products where kind = 'product');
insert into t_results select 'movements', (select string_agg(kind || coalesce('/' || reason, '') || ':' || quantity::text || '→' || stock_after::text, ', ' order by id) from public.stock_movements);
insert into t_results select 'audit', (select string_agg(action, ',' order by id) from public.audit_log where business_id = 'aaaaaaaa-0000-0000-0000-000000000000');

-- ---------- other business ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t_results select 'B sees', (select count(*) from public.suppliers) || '/' || (select count(*) from public.stock_entries) || '/' || (select count(*) from public.inventory_counts) || '/' || (select count(*) from public.stock_movements);
select pg_temp.try('B entry with A product', $$select to_jsonb(public.save_stock_entry('{"items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":1,"unit_cost":1}]}'::jsonb))$$);
select pg_temp.try('B adjust A product', $$select to_jsonb(public.adjust_stock('{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":-1,"reason":"loss"}'::jsonb))$$);
select pg_temp.try('B inventory A product', $$select public.confirm_inventory('{"items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","counted":0}]}'::jsonb)$$);
select pg_temp.try('B delete A draft', format($$select to_jsonb(public.delete_stock_entry('%s'))$$, (select v#>>'{}' from t_vars where k='c1')));

reset role;
do $$ begin
  raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results);
end $$;
