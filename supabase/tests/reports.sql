-- Reports test (0004). Run after migrations 0001–0004 inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-ownera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','t-workera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b3','t-workerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','t-ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type) values
 ('aaaaaaaa-0000-0000-0000-000000000000','T Market A','market'),
 ('bbbbbbbb-0000-0000-0000-000000000000','T Market B','market');
insert into public.profiles (id, business_id, role, full_name, commission_pct) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner A',0),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','worker','Worker A',2),
 ('00000000-0000-0000-0000-0000000000b3','aaaaaaaa-0000-0000-0000-000000000000','worker','Worker A2',0),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B',0);
insert into public.products (id, business_id, name, unit, sale_price, vat_code, stock) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Qumësht 1L','cope',1.08,'D',100),
 ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Ujë 1.5L','cope',1.18,'E',100);
insert into public.product_costs (product_id, business_id, purchase_price) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',0.80),
 ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000',0.50);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select public.set_own_pin('2580');

create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create temp table t_vars (k text primary key, v jsonb);
grant all on t_vars to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 300), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || sqlerrm);
end $f$;

set local role authenticated;

-- worker A: shift + 2 sales, refund 1 water (approved by owner)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
insert into t_results select 'no shift', coalesce(public.my_open_shift()::text, 'null');
insert into t_results select 'start', (public.start_shift('{"opening_cash":50}'::jsonb)->>'opening_cash');
insert into t_results select 'start again same', (select count(*)::text from public.shifts) || ' ' || (public.start_shift('{}'::jsonb)->>'opening_cash');
insert into t_vars select 's1', public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000001",
  "items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":10},{"product_id":"aaaaaaaa-2222-0000-0000-000000000002","quantity":5}],
  "payment":{"method":"cash","tendered":20}}'::jsonb);
insert into t_vars select 's2', public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000002",
  "items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000002","quantity":2}],"payment":{"method":"card"}}'::jsonb);
insert into t_vars select 'water_item', to_jsonb(x->>'id') from t_vars, jsonb_array_elements(v->'items') x where k='s1' and x->>'name' like 'Ujë%';
select public.refund_sale(jsonb_build_object('client_id','33333333-0000-0000-0000-000000000001','sale_id',(select v->>'id' from t_vars where k='s1'),
  'items', jsonb_build_array(jsonb_build_object('sale_item_id',(select v#>>'{}' from t_vars where k='water_item'),'quantity',1)),
  'reason','x','method','cash','approver_id','00000000-0000-0000-0000-0000000000b1','pin','2580'));
select pg_temp.try('worker report', $$select public.report_summary(current_date, current_date)$$);
select pg_temp.try('worker series', $$select public.sales_series(current_date, current_date, 'day')$$);
select pg_temp.try('worker comparison', $$select public.workers_comparison(current_date, current_date)$$);
select pg_temp.try('worker other', $$select public.work_summary('00000000-0000-0000-0000-0000000000b3')$$);
select pg_temp.try('worker own', $$select (public.work_summary(null, '2020-01-01', '2030-01-01') - 'events' - 'open_shift' - 'worker')$$);
insert into t_results select 'worker events', (select string_agg(e->>'type' || coalesce('#' || (e->>'invoice_no'), '') || ':' || coalesce(e->>'total', ''), ', ') from jsonb_array_elements(public.work_summary()->'events') e);
select pg_temp.try('worker sees shifts', $$select to_jsonb(count(*)) from public.shifts$$);
select pg_temp.try('worker update shift', $$update public.shifts set opening_cash = 0 returning to_jsonb(id)$$);
insert into t_results select 'end', (public.end_shift('{"closing_cash":75.5}'::jsonb)->>'closing_cash');
insert into t_results select 'end again', coalesce(public.end_shift('{}'::jsonb)::text, 'null');

-- worker A2: one sale
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000003","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":1}],"payment":{"method":"cash"}}'::jsonb);

-- owner
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_vars select 'r', public.report_summary(current_date, current_date);
insert into t_results select 'totals', (v->'totals')::text from t_vars where k='r';
insert into t_results select 'prev', (v->'prev')::text || ' ' || (v->>'prev_from') from t_vars where k='r';
insert into t_results select 'vat', (v->'vat')::text from t_vars where k='r';
insert into t_results select 'top', (select string_agg((x->>'name') || ' ' || (x->>'quantity') || ' ' || (x->>'total') || ' p' || (x->>'profit'), ', ') from t_vars, jsonb_array_elements(v->'top') x where k='r');
insert into t_results select 'workers', (select string_agg((x->>'name') || ' ' || (x->>'invoices') || ' ' || (x->>'total') || ' ' || (x->>'cash') || '/' || (x->>'card'), ', ') from t_vars, jsonb_array_elements(v->'workers') x where k='r');
insert into t_results select 'daily', (v->'daily')::text from t_vars where k='r';
insert into t_results select 'series 7', jsonb_array_length(public.sales_series(current_date - 6, current_date, 'day'))::text;
insert into t_results select 'series year', jsonb_array_length(public.sales_series(current_date - 364, current_date, 'month'))::text;
insert into t_results select 'compare', (select string_agg((x->>'name') || ' ' || (x->>'invoices') || ' ' || (x->>'total') || ' c' || (x->>'commission') || ' m' || (x->>'minutes'), ', ') from jsonb_array_elements(public.workers_comparison(current_date, current_date)) x);
insert into t_results select 'owner work A', (public.work_summary('00000000-0000-0000-0000-0000000000b2', current_date - 7, current_date) -> 'totals')::text || ' comm ' || (public.work_summary('00000000-0000-0000-0000-0000000000b2', current_date - 7, current_date) ->> 'commission');
select pg_temp.try('bad period', $$select public.report_summary(current_date, current_date - 1)$$);

-- other business
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t_results select 'B totals', (public.report_summary(current_date, current_date)->'totals'->>'invoices');
select pg_temp.try('B work of A', $$select public.work_summary('00000000-0000-0000-0000-0000000000b2')$$);
insert into t_results select 'B sees shifts', (select count(*)::text from public.shifts);

reset role;
do $$ begin
  raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results);
end $$;
