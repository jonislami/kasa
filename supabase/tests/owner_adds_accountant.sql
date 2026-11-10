-- Owner adds the accountant by email (0014). Run after migrations 0001–0014 inside a transaction; ends with an
-- exception (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-ownera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','t-mgra@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','t-ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000d1','t-acc@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000d2','t-acc2@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type, nui, vat_number, city) values
 ('aaaaaaaa-0000-0000-0000-000000000000','T Market A','market','811111111','330111111','Prishtinë'),
 ('bbbbbbbb-0000-0000-0000-000000000000','T Market B','market','822222222',null,null);
insert into public.profiles (id, business_id, role, full_name) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner A'),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','manager','Mgr A'),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B');
insert into public.products (id, business_id, name, unit, sale_price, vat_code, stock) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Qumësht 1L','cope',1.08,'D',100);
insert into public.accountants (user_id, full_name, email, office_name, active) values
 ('00000000-0000-0000-0000-0000000000d1','Kont Abilisti','T-Acc@test.local','Zyra K', true),
 ('00000000-0000-0000-0000-0000000000d2','Joaktiv','t-acc2@test.local','Zyra T', false);
-- accountant 1 already has Market B as a manual client (same NUI)
insert into public.acc_clients (id, accountant_id, name, nui) values
 ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','Market B (manual)','822222222');

create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 300), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || left(sqlerrm, 90));
end $f$;

set local role authenticated;

-- accountant cannot see A yet, cannot add itself
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select pg_temp.try('acc clients before', $$select to_jsonb(count(*)) from public.acc_clients$$);
select pg_temp.try('acc adds itself', $$select public.add_accountant_by_email('t-acc@test.local')$$);

-- manager A: not allowed
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select pg_temp.try('manager add', $$select public.add_accountant_by_email('t-acc@test.local')$$);

-- owner A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select pg_temp.try('bad email', $$select public.add_accountant_by_email('abc')$$);
select pg_temp.try('unknown email', $$select public.add_accountant_by_email('nobody@test.local')$$);
select pg_temp.try('inactive acc', $$select public.add_accountant_by_email('t-acc2@test.local')$$);
select pg_temp.try('add A', $$select public.add_accountant_by_email('  t-acc@TEST.local ') - 'client_id'$$);
select pg_temp.try('add A again', $$select public.add_accountant_by_email('t-acc@test.local') - 'client_id'$$);
select pg_temp.try('owner list', $$select jsonb_agg(jsonb_build_object('s', x->>'status', 'n', x->>'full_name')) from jsonb_array_elements(public.business_accountants()) x$$);

-- owner B: links the existing manual client with the same NUI
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select pg_temp.try('add B', $$select to_jsonb(public.add_accountant_by_email('t-acc@test.local') ->> 'client_id')$$);

-- accountant sees both, and A's products after opening
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select pg_temp.try('acc clients after', $$select jsonb_agg(jsonb_build_object('n', name, 's', link_status, 'city', city) order by name) from public.acc_clients$$);
select pg_temp.try('open A', $$select to_jsonb(public.set_active_business('aaaaaaaa-0000-0000-0000-000000000000'))$$);
select pg_temp.try('products A', $$select to_jsonb(count(*)) from public.products$$);

-- owner A revokes → nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select pg_temp.try('revoke', $$select to_jsonb(public.revoke_accountant('00000000-0000-0000-0000-0000000000d1'))$$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select pg_temp.try('products after revoke', $$select to_jsonb(count(*)) from public.products$$);
-- owner A adds again → access back, no duplicate client
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select pg_temp.try('re-add', $$select public.add_accountant_by_email('t-acc@test.local') - 'client_id'$$);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select pg_temp.try('open A again', $$select to_jsonb(public.set_active_business('aaaaaaaa-0000-0000-0000-000000000000'))$$);
select pg_temp.try('products re-add', $$select to_jsonb(count(*)) from public.products$$);
select pg_temp.try('clients count', $$select to_jsonb(count(*)) from public.acc_clients$$);

reset role;
select pg_temp.try('audit', $$select jsonb_agg(action order by created_at, action) from public.audit_log where action like 'accountant%'$$);

do $$ begin raise exception 'RESULTS %', (select string_agg(k || ' => ' || v, E'\n') from t_results); end $$;
