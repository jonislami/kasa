-- RLS test for phase 1. Run AFTER schema.sql inside a transaction; it always ends with
-- an exception (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000a1','pa@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b1','ownera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','workera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.businesses (id, name, type) values
 ('aaaaaaaa-0000-0000-0000-000000000000','Market A','market'),
 ('bbbbbbbb-0000-0000-0000-000000000000','Sallon B','salon');
insert into public.profiles (id, business_id, role, full_name, pin_hash) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner A',null),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','worker','Worker A','secret'),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B',null);
insert into public.business_settings (business_id) values ('aaaaaaaa-0000-0000-0000-000000000000'),('bbbbbbbb-0000-0000-0000-000000000000');
insert into public.registers (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000','Arka 1'),('bbbbbbbb-0000-0000-0000-000000000000','Arka 1');

create temp table t_results (k text, v text);
grant all on t_results to authenticated, anon;

create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
begin
  execute p_sql;
  insert into t_results values (p_key, 'ok');
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate);
end $f$;

-- ---------- owner A ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'A.owner businesses', count(*)::text from public.businesses;
insert into t_results select 'A.owner profiles', count(*)::text from public.profiles;
insert into t_results select 'A.owner registers', count(*)::text from public.registers;
insert into t_results select 'A.owner ctx type', public.my_context()->'business'->>'type';
select pg_temp.try('A.owner rename', $$update public.businesses set name='Market A2' where id='aaaaaaaa-0000-0000-0000-000000000000'$$);
select pg_temp.try('A.owner change type', $$update public.businesses set type='salon' where id='aaaaaaaa-0000-0000-0000-000000000000'$$);
select pg_temp.try('A.owner change active', $$update public.businesses set active=false where id='aaaaaaaa-0000-0000-0000-000000000000'$$);
select pg_temp.try('A.owner change counter', $$update public.businesses set invoice_counter=99$$);
select pg_temp.try('A.owner add register', $$insert into public.registers (name) values ('Arka 2')$$);
select pg_temp.try('A.owner read pin_hash', $$select pin_hash from public.profiles$$);
select pg_temp.try('A.owner platform rpc', $$select * from public.platform_businesses()$$);
select pg_temp.try('A.owner log_action', $$select public.log_action('test')$$);
insert into t_results select 'A.owner audit rows', count(*)::text from public.audit_log;
select pg_temp.try('A.owner audit delete', $$delete from public.audit_log$$);

-- ---------- worker A ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
insert into t_results select 'A.worker profiles', count(*)::text from public.profiles;
insert into t_results select 'A.worker audit rows', count(*)::text from public.audit_log;
with u as (update public.registers set name='X' returning 1) insert into t_results select 'A.worker updated registers', count(*)::text from u;
with u as (update public.businesses set name='X' returning 1) insert into t_results select 'A.worker updated business', count(*)::text from u;
select pg_temp.try('A.worker add register', $$insert into public.registers (name) values ('Arka 3')$$);
insert into t_results select 'A.worker is_manager', public.is_manager()::text;

-- ---------- owner B ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t_results select 'B.owner registers', count(*)::text from public.registers;
insert into t_results select 'B.owner profiles', count(*)::text from public.profiles;
select pg_temp.try('B.owner insert register into A', $$insert into public.registers (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000','hack')$$);

-- ---------- platform admin ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
insert into t_results select 'PA businesses table', count(*)::text from public.businesses;
insert into t_results select 'PA platform rows', count(*)::text from public.platform_businesses();
insert into t_results select 'PA registers table', count(*)::text from public.registers;
select pg_temp.try('PA deactivate B', $$select public.platform_set_business_active('bbbbbbbb-0000-0000-0000-000000000000', false)$$);

-- ---------- owner B after deactivation ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t_results select 'B.owner after deactivate registers', count(*)::text from public.registers;
insert into t_results select 'B.owner after deactivate bid', coalesce(public.current_business_id()::text,'null');

-- ---------- anon ----------
set local role anon;
select pg_temp.try('anon read businesses', $$select * from public.businesses$$);

reset role;
do $$ begin
  raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results);
end $$;
