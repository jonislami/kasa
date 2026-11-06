-- Users & devices test (0005). Run after migrations 0001–0005 inside a transaction; ends with an
-- exception (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-ownera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','pin-x@pin.kasa.app','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b3','t-mgra@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b4','t-mgra2@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','t-ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type) values
 ('aaaaaaaa-0000-0000-0000-000000000000','T Market A','market'),
 ('bbbbbbbb-0000-0000-0000-000000000000','T Market B','market');
insert into public.profiles (id, business_id, role, full_name, login_kind) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner A','email'),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','worker','Worker A','pin'),
 ('00000000-0000-0000-0000-0000000000b3','aaaaaaaa-0000-0000-0000-000000000000','manager','Manager A','email'),
 ('00000000-0000-0000-0000-0000000000b4','aaaaaaaa-0000-0000-0000-000000000000','manager','Manager A2','email'),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B','email');
insert into public.registers (id, business_id, name) values ('aaaaaaaa-1111-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000000','Arka 1');

create temp table t_results (k text, v text);
grant all on t_results to authenticated, service_role;
create temp table t_vars (k text primary key, v jsonb);
grant all on t_vars to authenticated, service_role;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 220), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || sqlerrm);
end $f$;

set local role authenticated;

-- owner
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'users', (select string_agg(full_name || ':' || role || ':' || login_kind || ':' || can_manage::text || ':' || coalesce(email, '-'), ', ') from public.business_users());
select pg_temp.try('owner pin worker', $$select to_jsonb(public.set_user_pin('00000000-0000-0000-0000-0000000000b2', '2580'))$$);
select pg_temp.try('weak pin', $$select to_jsonb(public.set_user_pin('00000000-0000-0000-0000-0000000000b2', '1234'))$$);
select pg_temp.try('owner edit worker', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b2","full_name":"Liridona","commission_pct":2.5}'::jsonb))$$);
select pg_temp.try('owner worker→manager (pin only)', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b2","role":"manager"}'::jsonb))$$);
select pg_temp.try('owner edit self', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b1","full_name":"X"}'::jsonb))$$);
select pg_temp.try('owner make admin', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b3","role":"admin"}'::jsonb))$$);
select pg_temp.try('owner bad commission', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b2","commission_pct":150}'::jsonb))$$);
insert into t_vars select 'link', public.link_device('{"device_id":"dddddddd-0000-0000-0000-000000000001","name":"Arka e parë","platform":"web","app_version":"0.1.0","register_id":"aaaaaaaa-1111-0000-0000-000000000000"}'::jsonb);
insert into t_results select 'link secret len', length(v->>'secret')::text from t_vars where k='link';
insert into t_results select 'devices', (select string_agg(name || ' ' || platform || ' ' || coalesce(register_id::text, '-'), ', ') from public.devices);
select pg_temp.try('read secret_hash', $$select to_jsonb(secret_hash) from public.devices$$);
select pg_temp.try('read pin_hash', $$select to_jsonb(pin_hash) from public.profiles limit 1$$);
select pg_temp.try('heartbeat', $$select public.device_heartbeat('{"device_id":"dddddddd-0000-0000-0000-000000000001","app_version":"0.2.0"}'::jsonb)$$);
select pg_temp.try('owner pin_check direct', $$select public.pin_check('dddddddd-0000-0000-0000-000000000001', 'x', '00000000-0000-0000-0000-0000000000b2', '2580')$$);

-- manager
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
insert into t_results select 'mgr can_manage', (select string_agg(full_name || ':' || can_manage::text, ', ') from public.business_users());
select pg_temp.try('mgr edit worker', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b2","phone":"044"}'::jsonb))$$);
select pg_temp.try('mgr edit other mgr', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b4","full_name":"Y"}'::jsonb))$$);
select pg_temp.try('mgr pin owner', $$select to_jsonb(public.set_user_pin('00000000-0000-0000-0000-0000000000b1', '2580'))$$);
select pg_temp.try('mgr own pin', $$select to_jsonb(public.set_user_pin('00000000-0000-0000-0000-0000000000b3', '3690'))$$);
select pg_temp.try('mgr deactivate worker', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b2","active":false}'::jsonb))$$);
select pg_temp.try('mgr reactivate worker', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b2","active":true}'::jsonb))$$);

-- worker
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select pg_temp.try('worker list', $$select to_jsonb(count(*)) from public.business_users()$$);
select pg_temp.try('worker link', $$select public.link_device('{"device_id":"dddddddd-0000-0000-0000-000000000009"}'::jsonb)$$);
select pg_temp.try('worker edit', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b2","commission_pct":50}'::jsonb))$$);
select pg_temp.try('worker sees devices', $$select to_jsonb(count(*)) from public.devices$$);
insert into t_results select 'worker context', (public.my_context()->'profile'->>'login_kind') || ' ' || coalesce(public.my_context()->'business'->>'phone', 'no-phone');

-- the Edge Function (service_role)
reset role;
set local role service_role;
insert into t_results select 'workers via device', (select string_agg((w->>'full_name') || ':' || (w->>'has_pin'), ', ') from jsonb_array_elements(public.pin_device_workers('dddddddd-0000-0000-0000-000000000001', (select v->>'secret' from t_vars where k='link'))->'workers') w);
insert into t_results select 'workers bad secret', coalesce(public.pin_device_workers('dddddddd-0000-0000-0000-000000000001', 'nope')::text, 'null');
insert into t_results select 'login ok', public.pin_check('dddddddd-0000-0000-0000-000000000001', (select v->>'secret' from t_vars where k='link'), '00000000-0000-0000-0000-0000000000b2', '2580')::text;
insert into t_results select 'wrong 1', public.pin_check('dddddddd-0000-0000-0000-000000000001', (select v->>'secret' from t_vars where k='link'), '00000000-0000-0000-0000-0000000000b2', '9999')::text;
select public.pin_check('dddddddd-0000-0000-0000-000000000001', (select v->>'secret' from t_vars where k='link'), '00000000-0000-0000-0000-0000000000b2', '9999') from generate_series(1, 3);
insert into t_results select 'wrong 5', (public.pin_check('dddddddd-0000-0000-0000-000000000001', (select v->>'secret' from t_vars where k='link'), '00000000-0000-0000-0000-0000000000b2', '9999'))->>'error';
insert into t_results select 'right while locked', (public.pin_check('dddddddd-0000-0000-0000-000000000001', (select v->>'secret' from t_vars where k='link'), '00000000-0000-0000-0000-0000000000b2', '2580'))->>'error';
insert into t_results select 'no pin user', (public.pin_check('dddddddd-0000-0000-0000-000000000001', (select v->>'secret' from t_vars where k='link'), '00000000-0000-0000-0000-0000000000b4', '2580'))->>'error';
insert into t_results select 'other business user', (public.pin_check('dddddddd-0000-0000-0000-000000000001', (select v->>'secret' from t_vars where k='link'), '00000000-0000-0000-0000-0000000000c1', '2580'))->>'error';
reset role;
set local role authenticated;

-- owner unlocks by setting a new PIN, then blocks the device
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'locked flag', (select pin_locked::text from public.business_users() where id = '00000000-0000-0000-0000-0000000000b2');
select public.set_user_pin('00000000-0000-0000-0000-0000000000b2', '3690');
insert into t_results select 'after reset', (select pin_locked::text from public.business_users() where id = '00000000-0000-0000-0000-0000000000b2');
select pg_temp.try('block device', $$select to_jsonb(public.update_device('{"device_id":"dddddddd-0000-0000-0000-000000000001","active":false}'::jsonb))$$);
reset role;
set local role service_role;
insert into t_results select 'blocked device', (public.pin_check('dddddddd-0000-0000-0000-000000000001', (select v->>'secret' from t_vars where k='link'), '00000000-0000-0000-0000-0000000000b2', '3690'))->>'error';
reset role;
set local role authenticated;

-- other business
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t_results select 'B users', (select string_agg(full_name, ', ') from public.business_users());
select pg_temp.try('B edit A worker', $$select to_jsonb(public.update_business_user('{"id":"00000000-0000-0000-0000-0000000000b2","full_name":"Z"}'::jsonb))$$);
select pg_temp.try('B pin A worker', $$select to_jsonb(public.set_user_pin('00000000-0000-0000-0000-0000000000b2', '2580'))$$);
select pg_temp.try('B update A device', $$select to_jsonb(public.update_device('{"device_id":"dddddddd-0000-0000-0000-000000000001","active":true}'::jsonb))$$);
insert into t_vars select 'linkB', public.link_device('{"device_id":"dddddddd-0000-0000-0000-000000000001"}'::jsonb);
insert into t_results select 'device moved to B', (select string_agg(business_id::text, ',') from public.devices);

reset role;
insert into t_results select 'audit A', (select string_agg(action, ',' order by id) from public.audit_log where business_id = 'aaaaaaaa-0000-0000-0000-000000000000');
do $$ begin
  raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results);
end $$;
