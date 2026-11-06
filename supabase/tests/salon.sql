-- Salon test (0008). Run after migrations 0001–0008 inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-owner@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','t-arta@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b3','t-dren@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','t-ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type) values
 ('aaaaaaaa-0000-0000-0000-000000000000','T Sallon','salon'),
 ('bbbbbbbb-0000-0000-0000-000000000000','T Market B','market');
insert into public.profiles (id, business_id, role, full_name, commission_pct) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner',0),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','worker','Arta',40),
 ('00000000-0000-0000-0000-0000000000b3','aaaaaaaa-0000-0000-0000-000000000000','worker','Dren',45),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B',0);
insert into public.products (id, business_id, kind, name, unit, sale_price, vat_code, duration_min, stock) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','service','Prerje & fen','cope',15,'E',45,0),
 ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','service','Prerje meshkuj','cope',6,'E',30,0),
 ('aaaaaaaa-2222-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000000','product','Shampo','cope',8.5,'E',null,14);
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
  insert into t_results values (p_key, coalesce(left(r::text, 200), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || sqlerrm);
end $f$;

set local role authenticated;

-- worker Arta books for herself, then tries Dren's calendar
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
insert into t_vars select 'a1', public.save_appointment(jsonb_build_object('customer_name','Donika Shala','customer_phone','049552107',
  'product_id','aaaaaaaa-2222-0000-0000-000000000001','starts_at', (current_date + time '11:00')::timestamptz));
insert into t_results select 'a1', (v->>'service_name') || ' ' || (v->>'price') || ' ' || (v->>'duration_min') || ' ' || (v->>'status') from t_vars where k='a1';
select pg_temp.try('overlap', format($$select public.save_appointment('{"customer_name":"X","product_id":"aaaaaaaa-2222-0000-0000-000000000002","starts_at":"%s"}'::jsonb)$$, (current_date + time '11:30')::timestamptz));
select pg_temp.try('book for Dren', format($$select public.save_appointment('{"staff_id":"00000000-0000-0000-0000-0000000000b3","customer_name":"X","product_id":"aaaaaaaa-2222-0000-0000-000000000002","starts_at":"%s"}'::jsonb)$$, (current_date + time '12:00')::timestamptz));

-- owner books for Dren
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_vars select 'a2', public.save_appointment(jsonb_build_object('staff_id','00000000-0000-0000-0000-0000000000b3','customer_name','Ardit Gashi',
  'product_id','aaaaaaaa-2222-0000-0000-000000000002','starts_at', (current_date + time '09:00')::timestamptz));
select pg_temp.try('no show', format($$select public.set_appointment_status('%s', 'no_show')->'status'$$, (select v->>'id' from t_vars where k='a2')));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
insert into t_results select 'Arta sees appts', count(*)::text from public.appointments;
select pg_temp.try('Arta changes Dren appt', format($$select public.set_appointment_status('%s', 'cancelled')$$, (select v->>'id' from t_vars where k='a2')));
select pg_temp.try('arrived', format($$select public.set_appointment_status('%s', 'arrived')->'status'$$, (select v->>'id' from t_vars where k='a1')));

-- Arta takes the payment: service by Arta, eyebrows by Dren, shampoo by Arta; from the appointment
insert into t_vars select 's1', public.create_sale(jsonb_build_object('client_id','11111111-0000-0000-0000-000000000001',
  'appointment_id', (select v->>'id' from t_vars where k='a1'),
  'items', jsonb_build_array(
    jsonb_build_object('product_id','aaaaaaaa-2222-0000-0000-000000000001','quantity',1,'staff_id','00000000-0000-0000-0000-0000000000b2'),
    jsonb_build_object('product_id','aaaaaaaa-2222-0000-0000-000000000002','quantity',1,'staff_id','00000000-0000-0000-0000-0000000000b3'),
    jsonb_build_object('product_id','aaaaaaaa-2222-0000-0000-000000000003','quantity',1)),
  'payment', jsonb_build_object('method','cash','tendered',50)));
insert into t_results select 's1 total', v->>'total' from t_vars where k='s1';
insert into t_results select 'lines staff', (select string_agg(i.name || '→' || p.full_name, ', ' order by i.position) from public.sale_items i join public.profiles p on p.id = i.staff_id where i.sale_id = (select (v->>'id')::uuid from t_vars where k='s1'));
insert into t_results select 'appt after pay', status || ' ' || (sale_id is not null)::text from public.appointments where id = (select (v->>'id')::uuid from t_vars where k='a1');
insert into t_results select 'stock shampoo', (select stock::text from public.products where id = 'aaaaaaaa-2222-0000-0000-000000000003');
select pg_temp.try('foreign staff ignored', $$select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000002","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000002","quantity":1,"staff_id":"00000000-0000-0000-0000-0000000000c1"}],"payment":{"method":"card"}}'::jsonb)->'total'$$);
insert into t_results select 'foreign staff → seller', (select string_agg(p.full_name, ',') from public.sale_items i join public.profiles p on p.id = i.staff_id join public.sales s on s.id = i.sale_id where s.client_id = '11111111-0000-0000-0000-000000000002');
insert into t_results select 'Arta commission (own)', (public.work_summary()->>'performed_value') || ' → ' || (public.work_summary()->>'commission');

-- refund Dren's line (approved by owner PIN) → his value goes down
insert into t_vars select 'dren_item', to_jsonb(x->>'id') from t_vars, jsonb_array_elements(v->'items') x where k='s1' and x->>'name' = 'Prerje meshkuj';
select pg_temp.try('refund Dren line', format($$select public.refund_sale('{"client_id":"33333333-0000-0000-0000-000000000001","sale_id":"%s","items":[{"sale_item_id":"%s","quantity":1}],"reason":"x","method":"cash","approver_id":"00000000-0000-0000-0000-0000000000b1","pin":"2580"}'::jsonb)->'sale'->'total'$$, (select v->>'id' from t_vars where k='s1'), (select v#>>'{}' from t_vars where k='dren_item')));

-- owner: commission report + comparison
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'commission', (select string_agg((x->>'name') || ' s' || (x->>'services') || ' v' || (x->>'value') || ' c' || (x->>'commission'), ', ') from jsonb_array_elements(public.commission_report(current_date, current_date)) x);
insert into t_results select 'compare commission', (select string_agg((x->>'name') || ' c' || (x->>'commission'), ', ') from jsonb_array_elements(public.workers_comparison(current_date, current_date)) x);
insert into t_results select 'owner sees appts', count(*)::text from public.appointments;
select pg_temp.try('specialty', $$select to_jsonb(public.set_user_specialty('00000000-0000-0000-0000-0000000000b2', 'Flokë, ngjyrosje'))$$);
select pg_temp.try('edit paid appt', format($$select public.set_appointment_status('%s', 'cancelled')$$, (select v->>'id' from t_vars where k='a1')));

-- worker cannot call the core directly
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select pg_temp.try('core direct', $$select public._create_sale_core('{"client_id":"11111111-0000-0000-0000-000000000009","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000002","quantity":1}],"payment":{"method":"card"}}'::jsonb)->'total'$$);
select pg_temp.try('commission report as worker', $$select public.commission_report(current_date, current_date)$$);

-- other business
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t_results select 'B sees appts', count(*)::text from public.appointments;
select pg_temp.try('B books A worker', format($$select public.save_appointment('{"staff_id":"00000000-0000-0000-0000-0000000000b2","customer_name":"X","service_name":"Y","starts_at":"%s"}'::jsonb)$$, now()));

reset role;
do $$ begin
  raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results);
end $$;
