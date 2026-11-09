-- Accountant test (0012). Run after migrations 0001–0012 inside a transaction; ends with an exception
-- (forcing rollback) whose message holds the results.
insert into auth.users (id, email, instance_id, aud, role) values
 ('00000000-0000-0000-0000-0000000000b1','t-ownera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000b2','t-workera@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','t-ownerb@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000d1','t-acc@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.businesses (id, name, type, nui, vat_number) values
 ('aaaaaaaa-0000-0000-0000-000000000000','T Market A','market','811111111','330111111'),
 ('bbbbbbbb-0000-0000-0000-000000000000','T Market B','market',null,null);
insert into public.profiles (id, business_id, role, full_name) values
 ('00000000-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','admin','Owner A'),
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','worker','Worker A'),
 ('00000000-0000-0000-0000-0000000000c1','bbbbbbbb-0000-0000-0000-000000000000','admin','Owner B');
insert into public.registers (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000','Arka 1');
insert into public.products (id, business_id, name, unit, sale_price, vat_code, stock) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Qumësht 1L','cope',1.08,'D',100),
 ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Ujë 1.5L','cope',1.18,'E',100),
 ('bbbbbbbb-2222-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000000','Bukë','cope',0.50,'D',10);
insert into public.product_costs (product_id, business_id, purchase_price) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',0.54),
 ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000',0.59);
insert into public.suppliers (id, business_id, name) values ('aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Furnitori A');

create temp table t_results (k text, v text);
grant all on t_results to authenticated;
create or replace function pg_temp.try(p_key text, p_sql text) returns void language plpgsql as $f$
declare r jsonb;
begin
  execute p_sql into r;
  insert into t_results values (p_key, coalesce(left(r::text, 400), 'ok'));
exception when others then
  insert into t_results values (p_key, 'ERR ' || sqlstate || ' ' || left(sqlerrm, 90));
end $f$;

-- service role side of the invitation
select pg_temp.try('invite by worker', $$select public._link_accountant('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b2','t-acc@test.local','Kont Abilisti')$$);
select pg_temp.try('invite other business owner', $$select public._link_accountant('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c1','t-acc@test.local','Kont Abilisti')$$);
select pg_temp.try('invite unknown email', $$select public._link_accountant('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','nobody@test.local','X')$$);
select pg_temp.try('invite staff email', $$select public._link_accountant('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','T-OwnerB@test.local','X')$$);
select pg_temp.try('invite ok', $$select public._link_accountant('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1',' T-Acc@test.local ','Kont Abilisti') - 'user_id'$$);

set local role authenticated;

-- worker A sells: 10 milk (D) + 5 water (E) cash
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000001",
  "items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":10},{"product_id":"aaaaaaaa-2222-0000-0000-000000000002","quantity":5}],
  "payment":{"method":"cash","tendered":20}}'::jsonb);
select pg_temp.try('worker summary', $$select public.accounting_summary(current_date, current_date)$$);
select pg_temp.try('worker accountants', $$select public.business_accountants()$$);
select pg_temp.try('worker revoke', $$select to_jsonb(public.revoke_accountant('00000000-0000-0000-0000-0000000000d1'))$$);
select pg_temp.try('worker expense', $$select to_jsonb(public.save_expense('{"expense_date":"2026-01-05","total":10,"category":"rent"}'::jsonb))$$);
select pg_temp.try('worker link fn', $$select public._link_accountant('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','t-acc@test.local','X')$$);

-- owner B sells in his own business
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select public.create_sale('{"client_id":"22222222-0000-0000-0000-000000000001","items":[{"product_id":"bbbbbbbb-2222-0000-0000-000000000001","quantity":2}],"payment":{"method":"cash"}}'::jsonb);

-- accountant: invited, not yet accepted
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
insert into t_results select 'ctx invited', (public.my_context() - 'user_id')::text;
insert into t_results select 'clients invited', (select string_agg((x->>'name') || ':' || (x->>'status') || ':' || coalesce(x->>'sales_total', 'no-figures'), ', ') from jsonb_array_elements(public.my_clients(current_date)) x);
select pg_temp.try('open before accept', $$select to_jsonb(public.set_active_business('aaaaaaaa-0000-0000-0000-000000000000'))$$);
select pg_temp.try('sales before accept', $$select to_jsonb(count(*)) from public.sales$$);
select pg_temp.try('accept B (no invite)', $$select to_jsonb(public.respond_invitation('bbbbbbbb-0000-0000-0000-000000000000', true))$$);
select pg_temp.try('accept A', $$select to_jsonb(public.respond_invitation('aaaaaaaa-0000-0000-0000-000000000000', true))$$);
select pg_temp.try('sales before open', $$select to_jsonb(count(*)) from public.sales$$);
select pg_temp.try('open B', $$select to_jsonb(public.set_active_business('bbbbbbbb-0000-0000-0000-000000000000'))$$);
select pg_temp.try('open A', $$select to_jsonb(public.set_active_business('aaaaaaaa-0000-0000-0000-000000000000'))$$);
insert into t_results select 'ctx open', (public.my_context()->'profile'->>'role') || ' @ ' || (public.my_context()->'business'->>'name') || ' clients ' || (public.my_context()->'accountant'->>'clients');

-- reads
select pg_temp.try('acc businesses', $$select to_jsonb(string_agg(name, ',')) from public.businesses$$);
select pg_temp.try('acc sales', $$select to_jsonb(count(*) || ' total ' || sum(total)) from public.sales$$);
select pg_temp.try('acc sale_items', $$select to_jsonb(count(*)) from public.sale_items$$);
select pg_temp.try('acc sale_item_costs', $$select to_jsonb(count(*)) from public.sale_item_costs$$);
select pg_temp.try('acc products', $$select to_jsonb(count(*)) from public.products$$);
select pg_temp.try('acc product_costs', $$select to_jsonb(count(*)) from public.product_costs$$);
select pg_temp.try('acc suppliers', $$select to_jsonb(count(*)) from public.suppliers$$);
select pg_temp.try('acc stock_movements', $$select to_jsonb(count(*)) from public.stock_movements$$);
select pg_temp.try('acc profiles', $$select to_jsonb(count(*)) from public.profiles$$);
select pg_temp.try('acc pin_hash', $$select to_jsonb(count(pin_hash)) from public.profiles$$);
select pg_temp.try('acc registers', $$select to_jsonb(count(*)) from public.registers$$);
select pg_temp.try('acc devices', $$select to_jsonb(count(*)) from public.devices$$);
select pg_temp.try('acc settings', $$select to_jsonb(count(*)) from public.business_settings$$);
select pg_temp.try('acc audit_log', $$select to_jsonb(count(*)) from public.audit_log$$);
select pg_temp.try('acc shifts', $$select to_jsonb(count(*)) from public.shifts$$);
select pg_temp.try('acc members table', $$select to_jsonb(count(*)) from public.business_members$$);
select pg_temp.try('acc business_users', $$select to_jsonb(count(*)) from public.business_users()$$);
select pg_temp.try('acc report_summary', $$select public.report_summary(current_date, current_date)$$);

-- writes that must fail
select pg_temp.try('acc create_sale', $$select public.create_sale('{"client_id":"11111111-0000-0000-0000-000000000009","items":[{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":1}],"payment":{"method":"cash"}}'::jsonb)$$);
select pg_temp.try('acc save_product', $$select to_jsonb(public.save_product('{"name":"X","sale_price":1}'::jsonb))$$);
select pg_temp.try('acc update price', $$with u as (update public.products set sale_price = 0.01 returning 1) select to_jsonb(count(*)) from u$$);
select pg_temp.try('acc adjust_stock', $$select to_jsonb(public.adjust_stock('{"product_id":"aaaaaaaa-2222-0000-0000-000000000001","quantity":-1,"reason":"loss"}'::jsonb))$$);
select pg_temp.try('acc insert expense direct', $$with i as (insert into public.expenses (business_id, expense_date, category, total, net_total, vat_total) values ('aaaaaaaa-0000-0000-0000-000000000000', current_date, 'rent', 1, 1, 0) returning 1) select to_jsonb(count(*)) from i$$);
select pg_temp.try('acc insert supplier', $$with i as (insert into public.suppliers (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'X') returning 1) select to_jsonb(count(*)) from i$$);
select pg_temp.try('acc revoke self', $$select to_jsonb(public.revoke_accountant('00000000-0000-0000-0000-0000000000d1'))$$);

-- the accountant's own records
select pg_temp.try('acc expense rent', $$select to_jsonb(public.save_expense(jsonb_build_object('expense_date', current_date, 'total', 300, 'category', 'rent', 'vat_code', 'A', 'payment', 'bank')) is not null)$$);
select pg_temp.try('acc expense power 18%', $$select to_jsonb(public.save_expense(jsonb_build_object('expense_date', current_date, 'total', 118, 'category', 'utilities', 'vat_code', 'E', 'vendor', 'KESCO')) is not null)$$);
select pg_temp.try('acc expense bad', $$select to_jsonb(public.save_expense(jsonb_build_object('expense_date', current_date, 'total', 0, 'category', 'rent')))$$);
select pg_temp.try('acc expense bad category', $$select to_jsonb(public.save_expense(jsonb_build_object('expense_date', current_date, 'total', 5, 'category', 'party')))$$);
select pg_temp.try('acc expenses', $$select to_jsonb(count(*) || ' vat ' || sum(vat_total)) from public.expenses$$);
select pg_temp.try('acc period filed', $$select to_jsonb(public.set_period_status(current_date, 'filed', 'Deklaruar në EDI'))$$);
select pg_temp.try('acc period bad', $$select to_jsonb(public.set_period_status(current_date, 'paid'))$$);
select pg_temp.try('acc note', $$select to_jsonb(public.set_client_note('aaaaaaaa-0000-0000-0000-000000000000', 'Klient mujor'))$$);
select pg_temp.try('acc note B', $$select to_jsonb(public.set_client_note('bbbbbbbb-0000-0000-0000-000000000000', 'x'))$$);
insert into t_results select 'acc summary sales', (public.accounting_summary(current_date, current_date)->'sales')::text;
insert into t_results select 'acc summary vat_out', (public.accounting_summary(current_date, current_date)->'vat_out')::text;
insert into t_results select 'acc summary expenses', (public.accounting_summary(current_date, current_date)->'expenses')::text || ' ' || (public.accounting_summary(current_date, current_date)->'expense_vat')::text;
insert into t_results select 'acc summary cogs/stock', (public.accounting_summary(current_date, current_date)->'cogs')::text || ' ' || (public.accounting_summary(current_date, current_date)->'stock')::text;
insert into t_results select 'acc summary daily', (public.accounting_summary(current_date, current_date)->'daily')::text;
insert into t_results select 'acc summary misc', (public.accounting_summary(current_date, current_date)->'registers')::text || ' ' || (public.accounting_summary(current_date, current_date)->'periods'->0->>'vat_status') || ' vatreg ' || (public.accounting_summary(current_date, current_date)->'business'->>'vat_registered');
insert into t_results select 'clients active', (select string_agg((x->>'name') || ':' || (x->>'status') || ' sales ' || (x->>'sales_total') || ' vat ' || (x->>'vat_out') || '/' || (x->>'vat_in') || ' ' || (x->>'vat_status') || ' note ' || (x->>'note'), ', ') from jsonb_array_elements(public.my_clients(current_date)) x);

-- owner A: sees the accountant, shares the books, revokes
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'owner accountants', (select string_agg((x->>'full_name') || ' ' || (x->>'email') || ' ' || (x->>'status') || ' opened ' || ((x->>'last_opened_at') is not null), ', ') from jsonb_array_elements(public.business_accountants()) x);
insert into t_results select 'owner summary', (public.accounting_summary(current_date, current_date)->'sales'->>'gross') || ' exp ' || (public.accounting_summary(current_date, current_date)->'expenses'->>'gross');
select pg_temp.try('owner expenses', $$select to_jsonb(count(*)) from public.expenses$$);
select pg_temp.try('owner ctx', $$select to_jsonb((public.my_context()->'profile'->>'role') || ' acc ' || coalesce(public.my_context()->>'accountant', 'null'))$$);
select pg_temp.try('owner open as accountant', $$select to_jsonb(public.set_active_business('aaaaaaaa-0000-0000-0000-000000000000'))$$);
select pg_temp.try('owner revoke', $$select to_jsonb(public.revoke_accountant('00000000-0000-0000-0000-0000000000d1'))$$);
select pg_temp.try('owner revoke again', $$select to_jsonb(public.revoke_accountant('00000000-0000-0000-0000-0000000000d1'))$$);
insert into t_results select 'audit', (select string_agg(action || ' x' || c, ', ' order by action) from (select action, count(*) c from public.audit_log where action like 'accountant%' or action like 'expense%' or action = 'period_status' group by action) a);

-- owner B: nothing of A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select pg_temp.try('B expenses', $$select to_jsonb(count(*)) from public.expenses$$);
select pg_temp.try('B periods', $$select to_jsonb(count(*)) from public.accounting_periods$$);
select pg_temp.try('B accountants', $$select public.business_accountants()$$);

-- accountant after revoke
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select pg_temp.try('revoked sales', $$select to_jsonb(count(*)) from public.sales$$);
select pg_temp.try('revoked expenses', $$select to_jsonb(count(*)) from public.expenses$$);
select pg_temp.try('revoked summary', $$select public.accounting_summary(current_date, current_date)$$);
select pg_temp.try('revoked open', $$select to_jsonb(public.set_active_business('aaaaaaaa-0000-0000-0000-000000000000'))$$);
insert into t_results select 'revoked ctx', coalesce(public.my_context()->>'profile', 'null') || ' clients ' || (public.my_context()->'accountant'->>'clients');
insert into t_results select 'revoked clients', jsonb_array_length(public.my_clients(current_date))::text;

reset role;
-- invited again after a revoke
select pg_temp.try('re-invite', $$select public._link_accountant('aaaaaaaa-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','t-acc@test.local','Other Name') - 'user_id'$$);
do $$ begin
  raise exception E'RESULTS\n%', (select string_agg(k || ' = ' || v, E'\n') from t_results);
end $$;
