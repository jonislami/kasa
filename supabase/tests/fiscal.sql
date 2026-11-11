-- Fiscal data test (0015). Run after migrations 0001–0015 inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-ownera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','t-mgra@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b3','t-wrka@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','t-ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type, city) values
 ('aaaaaaaa-0000-0000-0000-000000000000','T Market A','market','Prishtinë'),
 ('bbbbbbbb-0000-0000-0000-000000000000','T Market B','market',null);
insert into public.profiles (id, business_id, role, full_name) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner A'),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','manager','Mgr A'),
 ('00000000-0000-0000-0000-0000000000b3','aaaaaaaa-0000-0000-0000-000000000000','worker','Wrk A'),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B');
insert into public.registers (id, business_id, name) values
 ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Arka 1'),
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Arka 2');
insert into public.products (id, business_id, name, unit, sale_price, vat_code, stock) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Bukë','cope',0.80,'D',100);

create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create temp table t_vars (k text primary key, v text);
grant all on t_vars to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 260), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || left(sqlerrm, 90));
end $f$;

set local role authenticated;

-- worker sells (to have a sale)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
insert into t_vars select 'sale', (public.create_sale('{"client_id":"11111111-0000-0000-0000-0000000000f1","register_id":"aaaaaaaa-1111-0000-0000-000000000001","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":4}],"payment":{"method":"cash"}}'::jsonb) ->> 'id');
select pg_temp.try('worker context before', $$select public.fiscal_context('aaaaaaaa-1111-0000-0000-000000000001') - 'unit_saved_at'$$);
select pg_temp.try('worker save unit', $$select to_jsonb(public.fiscal_save_unit('{"nui":"811111111","fiscal_number":"F1","branch_id":"1"}'::jsonb))$$);
select pg_temp.try('worker registers', $$select to_jsonb(jsonb_array_length(public.fiscal_registers()))$$);
select pg_temp.try('worker writes coupon', $$insert into public.fiscal_coupons (sale_id, business_id, register_id, env, coupon_type, coupon_id, coupon_seq, branch_id, pos_id, verification_no, issued_at, details, signature, qr) values ((select v from t_vars where k='sale')::uuid, 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000001', 'test', 1, 1, 1, 1, 1, 'X', now(), 'd', 's', 'q') returning to_jsonb(coupon_id)$$);

-- manager
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select pg_temp.try('manager pos id', $$select to_jsonb(public.fiscal_set_pos_id('aaaaaaaa-1111-0000-0000-000000000001', '1'))$$);
select pg_temp.try('manager direct pos id', $$update public.registers set atk_pos_id = '7' where id = 'aaaaaaaa-1111-0000-0000-000000000001' returning to_jsonb(atk_pos_id)$$);
select pg_temp.try('manager rename register', $$update public.registers set name = 'Arka Kryesore' where id = 'aaaaaaaa-1111-0000-0000-000000000001' returning to_jsonb(name)$$);
select pg_temp.try('manager registers', $$select to_jsonb(jsonb_array_length(public.fiscal_registers()))$$);

-- owner
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select pg_temp.try('unit bad nui', $$select to_jsonb(public.fiscal_save_unit('{"nui":"123","fiscal_number":"F1","branch_id":"1"}'::jsonb))$$);
select pg_temp.try('unit no branch', $$select to_jsonb(public.fiscal_save_unit('{"nui":"811111111","fiscal_number":"F1"}'::jsonb))$$);
select pg_temp.try('unit prod uncertified', $$select to_jsonb(public.fiscal_save_unit('{"nui":"811111111","fiscal_number":"F1","branch_id":"1","env":"prod"}'::jsonb))$$);
select pg_temp.try('unit ok', $$select to_jsonb(public.fiscal_save_unit('{"nui":"811 111 111","fiscal_number":"EDI-55","branch_id":"3"}'::jsonb))$$);
select pg_temp.try('pos id bad', $$select to_jsonb(public.fiscal_set_pos_id('aaaaaaaa-1111-0000-0000-000000000001', 'abc'))$$);
select pg_temp.try('pos id 1', $$select to_jsonb(public.fiscal_set_pos_id('aaaaaaaa-1111-0000-0000-000000000001', '1'))$$);
select pg_temp.try('pos id dup', $$select to_jsonb(public.fiscal_set_pos_id('aaaaaaaa-1111-0000-0000-000000000002', '1'))$$);
select pg_temp.try('pos id 2', $$select to_jsonb(public.fiscal_set_pos_id('aaaaaaaa-1111-0000-0000-000000000002', '2'))$$);
select pg_temp.try('owner direct seq', $$update public.registers set coupon_seq = 99 where id = 'aaaaaaaa-1111-0000-0000-000000000001' returning to_jsonb(coupon_seq)$$);
select pg_temp.try('service fn from client', $$select to_jsonb(public._fiscal_store('{}'::jsonb))$$);

-- the relay (service role) registers Arka 1 and stores two coupons
reset role;
select public._fiscal_registered('aaaaaaaa-1111-0000-0000-000000000001', 'dev-1', 'web', 'PUBKEY', '-----CERT-----', 'test', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.try('store offline', $$select to_jsonb(public._fiscal_store(jsonb_build_object('sale_id', (select v from t_vars where k='sale'), 'business_id', 'aaaaaaaa-0000-0000-0000-000000000000', 'register_id', 'aaaaaaaa-1111-0000-0000-000000000001', 'env', 'test', 'coupon_type', 1, 'coupon_id', 3000100000001, 'coupon_seq', 1, 'branch_id', 3, 'pos_id', 1, 'verification_no', 'ABCD2345EFGH6789', 'issued_at', now(), 'details', 'CAE=', 'signature', 'MEUC', 'qr', 'CAE=|MEUC', 'offline', true, 'status', 'failed', 'error', 'timeout'))) - 'created_at' - 'updated_at' - 'issued_at' - 'sale_id'$$);
select pg_temp.try('store sent', $$select jsonb_build_object('status', f.status, 'tx', f.transaction_no, 'attempts', f.attempts, 'error', f.error) from public._fiscal_store(jsonb_build_object('sale_id', (select v from t_vars where k='sale'), 'status', 'sent', 'transaction_no', 987654)) f$$);
select pg_temp.try('register seq', $$select jsonb_build_object('seq', coupon_seq, 'status', fiscal_status, 'sent', fiscal_last_sent_at is not null) from public.registers where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$);
select pg_temp.try('duplicate coupon id', $$select to_jsonb((public._fiscal_store(jsonb_build_object('sale_id', gen_random_uuid(), 'business_id', 'aaaaaaaa-0000-0000-0000-000000000000', 'register_id', 'aaaaaaaa-1111-0000-0000-000000000001', 'env', 'test', 'coupon_type', 1, 'coupon_id', 3000100000001, 'coupon_seq', 2, 'branch_id', 3, 'pos_id', 1, 'verification_no', 'ZZZZ2345EFGH6789', 'issued_at', now(), 'details', 'x', 'signature', 'y', 'qr', 'z'))).coupon_id)$$);

set local role authenticated;
-- worker reads its receipt data and the context
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
select pg_temp.try('sale_fiscal', $$select public.sale_fiscal((select v from t_vars where k='sale')::uuid) - 'issued_at'$$);
select pg_temp.try('context', $$select jsonb_build_object('nui', c->>'nui', 'branch', c->>'branch_id', 'env', c->>'env', 'loc', c->>'location', 'app', c->'application_id', 'reg', (c->'register') - 'registered_at' - 'last_sent_at' - 'oldest_pending') from public.fiscal_context('aaaaaaaa-1111-0000-0000-000000000001') c$$);
select pg_temp.try('worker sees log', $$select to_jsonb(count(*)) from public.fiscal_log$$);
-- other business sees nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select pg_temp.try('B sees coupons', $$select to_jsonb(count(*)) from public.fiscal_coupons$$);
select pg_temp.try('B sale_fiscal', $$select coalesce(public.sale_fiscal((select v from t_vars where k='sale')::uuid), '"none"')$$);
-- owner A: unit change while registered, then unregister (seq kept)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select pg_temp.try('unit change while registered', $$select to_jsonb(public.fiscal_save_unit('{"nui":"811111111","fiscal_number":"EDI-55","branch_id":"4"}'::jsonb))$$);
select pg_temp.try('unit same while registered', $$select to_jsonb(public.fiscal_save_unit('{"nui":"811111111","fiscal_number":"EDI-56","branch_id":"3"}'::jsonb))$$);
select pg_temp.try('pos change while registered', $$select to_jsonb(public.fiscal_set_pos_id('aaaaaaaa-1111-0000-0000-000000000001', '5'))$$);
select pg_temp.try('unregister', $$select to_jsonb(public.fiscal_unregister('aaaaaaaa-1111-0000-0000-000000000001'))$$);
select pg_temp.try('after unregister', $$select jsonb_build_object('seq', coupon_seq, 'status', fiscal_status, 'cert', fiscal_certificate) from public.registers where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$);
select pg_temp.try('registers list', $$select jsonb_agg(jsonb_build_object('n', x->>'name', 'pos', x->>'pos_id', 's', x->>'status', 'sent', x->'sent')) from jsonb_array_elements(public.fiscal_registers()) x$$);

reset role;
select pg_temp.try('audit', $$select jsonb_agg(action order by id) from public.audit_log where action like 'fiscal%' and business_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$);

do $$ begin raise exception 'RESULTS %', (select string_agg(k || ' => ' || v, E'\n') from t_results); end $$;
