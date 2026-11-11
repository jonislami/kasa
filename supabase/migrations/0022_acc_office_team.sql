-- =====================================================================
-- 0022 – Kasa Kontabilist, phase K7 (part 1): the office team.
--
-- * An office = the accountant account created by the platform admin (the owner). The owner (and other
--   office admins) add team members: accountants.office_id = owner, role admin / accountant / assistant.
--   Members are created by the Edge Function "acc-office" (auth users need the service role).
-- * Everything the office owns stays under acc_clients.accountant_id = owner. _require_accountant() now
--   returns the OFFICE id (owner) for every member, so all existing RPCs work for the whole team.
-- * Access to clients: admins see all; others all, or only the clients given to them (acc_member_clients).
--   Enforced in _own_client(), in every RLS policy (_acc_client_visible) and in the storage policies.
-- * Roles: an assistant cannot create / delete clients, lock months, file VAT / other taxes, confirm payroll
--   (triggers, so no existing function had to be rewritten). Team management only for admins.
-- * Two-factor login (TOTP, Supabase Auth MFA): the office can require it; without aal2 the member
--   is not an accountant for the database (is_accountant), and acc_me tells the program to ask for the code.
-- * acc_activity: history of actions (who, client, what) filled by triggers on the main tables.
-- * Linked Kasa businesses (read-only books, Arka / Stoku) work for members through the office's link.
-- Older clients keep working: a single accountant is simply an office of one admin.
-- =====================================================================

alter table public.accountants add column if not exists office_id uuid references public.accountants (user_id) on delete cascade;
alter table public.accountants add column if not exists role text not null default 'admin';
alter table public.accountants add column if not exists all_clients boolean not null default true;
alter table public.accountants add column if not exists require_mfa boolean not null default false;
do $$ begin
  alter table public.accountants add constraint accountants_role_check check (role in ('admin', 'accountant', 'assistant'));
exception when duplicate_object then null; end $$;
create index if not exists accountants_office_idx on public.accountants (office_id);

create table if not exists public.acc_member_clients (
  member_id uuid not null references public.accountants (user_id) on delete cascade,
  client_id uuid not null references public.acc_clients (id) on delete cascade,
  primary key (member_id, client_id)
);
alter table public.acc_member_clients enable row level security;

-- ---------------------------------------------------------------------
-- Who am I in the office
-- ---------------------------------------------------------------------
create or replace function public._office_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(a.office_id, a.user_id) from public.accountants a where a.user_id = auth.uid() and a.active
$$;

create or replace function public._acc_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when a.office_id is null then 'admin' else a.role end
  from public.accountants a where a.user_id = auth.uid() and a.active
$$;

-- Active account, office (owner) active, two-factor done when the office requires it, not a business user.
create or replace function public.is_accountant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.accountants a
    join public.accountants o on o.user_id = coalesce(a.office_id, a.user_id)
    where a.user_id = auth.uid() and a.active and o.active
      and (not o.require_mfa or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  )
  and not exists (select 1 from public.profiles p where p.id = auth.uid())
$$;

create or replace function public._require_accountant()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_accountant() then
    raise exception 'Vetëm për kontabilistin' using errcode = '42501';
  end if;
  return public._office_id();
end $$;

-- Can the current member see this client?
create or replace function public._acc_client_visible(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_accountant() and exists (
    select 1
    from public.acc_clients c
    join public.accountants a on a.user_id = auth.uid()
    where c.id = p_client
      and c.accountant_id = coalesce(a.office_id, a.user_id)
      and (a.office_id is null or a.role = 'admin' or a.all_clients
           or exists (select 1 from public.acc_member_clients mc where mc.member_id = a.user_id and mc.client_id = c.id))
  )
$$;

create or replace function public._own_client(p_client uuid)
returns public.acc_clients
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients;
begin
  select * into c from public.acc_clients
  where id = p_client and accountant_id = public._require_accountant() and public._acc_client_visible(id);
  if not found then
    raise exception 'Klienti nuk u gjet' using errcode = 'P0002';
  end if;
  return c;
end $$;

create or replace function public._acc_require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
begin
  if public._acc_role() <> 'admin' then
    raise exception 'Vetëm administratori i zyrës' using errcode = '42501';
  end if;
  return v_office;
end $$;

-- ---------------------------------------------------------------------
-- RLS: every table of the office through _acc_client_visible
-- ---------------------------------------------------------------------
drop policy if exists acc_clients_own on public.acc_clients;
create policy acc_clients_own on public.acc_clients for select to authenticated using (public._acc_client_visible(id));

do $$
declare
  t text;
begin
  foreach t in array array['acc_documents', 'acc_money_accounts', 'acc_partners', 'acc_scans', 'acc_assets', 'acc_bank_lines',
                           'acc_coa', 'acc_employees', 'acc_files', 'acc_journal_entries', 'acc_leaves', 'acc_loans',
                           'acc_payments', 'acc_payroll_runs', 'acc_periods', 'acc_tax_filings', 'acc_transactions', 'acc_vat_returns']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (public._acc_client_visible(client_id))', t || '_own', t);
  end loop;
end $$;

drop policy if exists acc_doc_history_own on public.acc_doc_history;
create policy acc_doc_history_own on public.acc_doc_history for select to authenticated
  using (exists (select 1 from public.acc_documents d where d.id = doc_id and public._acc_client_visible(d.client_id)));
drop policy if exists acc_document_lines_own on public.acc_document_lines;
create policy acc_document_lines_own on public.acc_document_lines for select to authenticated
  using (exists (select 1 from public.acc_documents d where d.id = doc_id and public._acc_client_visible(d.client_id)));
drop policy if exists acc_journal_lines_own on public.acc_journal_lines;
create policy acc_journal_lines_own on public.acc_journal_lines for select to authenticated
  using (exists (select 1 from public.acc_journal_entries e where e.id = entry_id and public._acc_client_visible(e.client_id)));
drop policy if exists acc_payroll_lines_own on public.acc_payroll_lines;
create policy acc_payroll_lines_own on public.acc_payroll_lines for select to authenticated
  using (exists (select 1 from public.acc_payroll_runs r where r.id = run_id and public._acc_client_visible(r.client_id)));

drop policy if exists acc_member_clients_own on public.acc_member_clients;
create policy acc_member_clients_own on public.acc_member_clients for select to authenticated
  using (member_id = auth.uid() or (public._acc_role() = 'admin'
         and exists (select 1 from public.accountants m where m.user_id = member_id and m.office_id = public._office_id())));
revoke all on public.acc_member_clients from anon, authenticated;
grant select on public.acc_member_clients to authenticated;

drop policy if exists acc_files_read on storage.objects;
create policy acc_files_read on storage.objects for select to authenticated
  using (bucket_id = 'acc-files' and public.is_accountant()
         and (storage.foldername(name))[1] in (select c.id::text from public.acc_clients c where public._acc_client_visible(c.id)));
drop policy if exists acc_files_write on storage.objects;
create policy acc_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'acc-files' and public.is_accountant()
              and (storage.foldername(name))[1] in (select c.id::text from public.acc_clients c where public._acc_client_visible(c.id)));
drop policy if exists acc_files_delete on storage.objects;
create policy acc_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'acc-files' and public.is_accountant()
         and (storage.foldername(name))[1] in (select c.id::text from public.acc_clients c where public._acc_client_visible(c.id)));

-- Office-wide lists (all clients of the office) only show the member's clients.
do $$
declare
  f regprocedure;
  def text;
  n int;
begin
  foreach f in array array['public.acc_clients_overview(date)'::regprocedure, 'public.acc_tax_calendar(date, date)'::regprocedure]
  loop
    def := pg_get_functiondef(f);
    if position('_acc_client_visible' in def) > 0 then continue; end if;
    n := (length(def) - length(replace(def, 'c.accountant_id = v_me', ''))) / length('c.accountant_id = v_me');
    if n = 0 then raise exception 'Nuk u gjet filtri i zyrës te %', f; end if;
    execute replace(def, 'c.accountant_id = v_me', 'c.accountant_id = v_me and public._acc_client_visible(c.id)');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Session info for the program
-- ---------------------------------------------------------------------
create or replace function public.acc_me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_accountant', public.is_accountant(),
    'accountant', (select jsonb_build_object('full_name', a.full_name, 'email', a.email,
                                              'office_name', coalesce(o.office_name, a.office_name),
                                              'phone', a.phone, 'active', a.active and o.active,
                                              'role', case when a.office_id is null then 'admin' else a.role end,
                                              'is_owner', a.office_id is null,
                                              'office_id', o.user_id)
                   from public.accountants a join public.accountants o on o.user_id = coalesce(a.office_id, a.user_id)
                   where a.user_id = auth.uid()),
    'mfa_required', coalesce((select o.require_mfa and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
                              from public.accountants a join public.accountants o on o.user_id = coalesce(a.office_id, a.user_id)
                              where a.user_id = auth.uid()), false),
    'has_business', exists (select 1 from public.profiles p where p.id = auth.uid())
  )
$$;

-- ---------------------------------------------------------------------
-- Linked Kasa businesses: members use the office's link (business_members of the owner)
-- ---------------------------------------------------------------------
create or replace function public.accountant_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
  from public.user_active_business a
  join public.accountants ac on ac.user_id = a.user_id and ac.active
  join public.business_members m on m.user_id = coalesce(ac.office_id, ac.user_id) and m.business_id = a.business_id
  join public.businesses b on b.id = m.business_id
  where a.user_id = auth.uid()
    and m.status = 'active'
    and m.role = 'accountant'
    and b.active
    and public.is_accountant()
    and (ac.office_id is null
         or exists (select 1 from public.acc_clients c where c.kasa_business_id = m.business_id and public._acc_client_visible(c.id)))
$$;

create or replace function public.set_active_business(p_business uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
  v_office uuid;
begin
  if auth.uid() is null then
    raise exception 'Nuk je i kyçur' using errcode = '42501';
  end if;
  if p_business is null then
    delete from public.user_active_business where user_id = auth.uid();
    return;
  end if;
  if not public.is_accountant() then
    raise exception 'Nuk ke qasje në këtë biznes' using errcode = '42501';
  end if;
  v_office := public._office_id();
  select m.last_opened_at into v_last
  from public.business_members m
  join public.businesses b on b.id = m.business_id
  where m.user_id = v_office and m.business_id = p_business and m.status = 'active' and b.active;
  if not found or (v_office <> auth.uid()
     and not exists (select 1 from public.acc_clients c where c.kasa_business_id = p_business and public._acc_client_visible(c.id))) then
    raise exception 'Nuk ke qasje në këtë biznes' using errcode = '42501';
  end if;
  insert into public.user_active_business (user_id, business_id)
  values (auth.uid(), p_business)
  on conflict (user_id) do update set business_id = excluded.business_id, updated_at = now();
  update public.business_members set last_opened_at = now() where user_id = v_office and business_id = p_business;
  if v_last is null or v_last < now() - interval '30 minutes' then
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (p_business, auth.uid(), 'accountant_open', 'accountant', auth.uid()::text,
            jsonb_build_object('name', (select full_name from public.accountants where user_id = auth.uid())));
  end if;
end $$;

-- A business owner adding a team member by e-mail links the member's office.
create or replace function public.add_accountant_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_email text := lower(trim(coalesce(p_email, '')));
  a public.accountants;
  b public.businesses;
  v_client uuid;
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Shkruaj email-in e kontabilistit' using errcode = '22023';
  end if;
  select * into a from public.accountants where lower(email) = v_email;
  if not found then
    raise exception 'Nuk ka llogari kontabilisti me këtë email. Kontabilisti duhet ta ketë programin "Kasa Kontabilist" (llogarinë e krijon administratori i platformës).' using errcode = 'P0002';
  end if;
  if a.office_id is not null then
    select * into a from public.accountants where user_id = a.office_id;
  end if;
  if not a.active then
    raise exception 'Llogaria e këtij kontabilisti është e çaktivizuar' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = v_business;

  select id into v_client from public.acc_clients
   where accountant_id = a.user_id and kasa_business_id = v_business
   order by updated_at desc limit 1;
  if v_client is null and b.nui is not null then
    select id into v_client from public.acc_clients
     where accountant_id = a.user_id and kasa_business_id is null and nui = b.nui
     order by updated_at desc limit 1;
  end if;

  if v_client is not null then
    update public.acc_clients
       set kasa_business_id = v_business, link_status = 'approved', active = true,
           link_requested_at = coalesce(link_requested_at, now()), link_responded_at = now(),
           nui = coalesce(nui, b.nui), vat_number = coalesce(vat_number, b.vat_number),
           fiscal_number = coalesce(fiscal_number, b.fiscal_number), updated_at = now()
     where id = v_client;
  else
    insert into public.acc_clients (accountant_id, name, nui, vat_number, fiscal_number, vat_registered, address, city, phone, email,
                                    kasa_business_id, link_status, link_requested_at, link_responded_at)
    values (a.user_id, b.name, b.nui, b.vat_number, b.fiscal_number, b.vat_number is not null, b.address, b.city, b.phone, b.owner_email,
            v_business, 'approved', now(), now())
    returning id into v_client;
  end if;

  insert into public.business_members (user_id, business_id, role, status, invited_by, responded_at)
  values (a.user_id, v_business, 'accountant', 'active', auth.uid(), now())
  on conflict (user_id, business_id) do update
    set status = 'active', invited_by = excluded.invited_by, responded_at = now(), revoked_at = null;

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'accountant_add', 'accountant', a.user_id::text,
          jsonb_build_object('name', a.full_name, 'email', a.email, 'office', a.office_name));

  return jsonb_build_object('client_id', v_client, 'full_name', a.full_name, 'office_name', a.office_name);
end $$;

-- ---------------------------------------------------------------------
-- What an assistant may not do (enforced on the tables, whatever RPC writes them)
-- ---------------------------------------------------------------------
create or replace function public._acc_role_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_block boolean := false;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  v_role := public._acc_role();
  if v_role is null or v_role <> 'assistant' then return coalesce(new, old); end if;

  if tg_table_name = 'acc_clients' then
    v_block := tg_op in ('INSERT', 'DELETE');
  elsif tg_table_name = 'acc_periods' then
    v_block := (tg_op = 'INSERT' and (new.books_locked or new.vat_status = 'filed'))
            or (tg_op = 'UPDATE' and (new.books_locked is distinct from old.books_locked
                                      or (new.vat_status is distinct from old.vat_status and 'filed' in (new.vat_status, old.vat_status))));
  elsif tg_table_name = 'acc_vat_returns' then
    v_block := (tg_op = 'INSERT' and new.status = 'filed')
            or (tg_op = 'UPDATE' and new.status is distinct from old.status)
            or (tg_op = 'DELETE' and old.status = 'filed');
  elsif tg_table_name = 'acc_payroll_runs' then
    v_block := (tg_op = 'UPDATE' and new.status is distinct from old.status) or (tg_op = 'DELETE' and old.status <> 'draft');
  elsif tg_table_name = 'acc_tax_filings' then
    v_block := true;
  end if;

  if v_block then
    raise exception 'Ky veprim kërkon kontabilistin ose administratorin e zyrës' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists acc_role_guard on public.acc_clients;
create trigger acc_role_guard before insert or delete on public.acc_clients for each row execute function public._acc_role_guard();
drop trigger if exists acc_role_guard on public.acc_periods;
create trigger acc_role_guard before insert or update on public.acc_periods for each row execute function public._acc_role_guard();
drop trigger if exists acc_role_guard on public.acc_vat_returns;
create trigger acc_role_guard before insert or update or delete on public.acc_vat_returns for each row execute function public._acc_role_guard();
drop trigger if exists acc_role_guard on public.acc_payroll_runs;
create trigger acc_role_guard before update or delete on public.acc_payroll_runs for each row execute function public._acc_role_guard();
drop trigger if exists acc_role_guard on public.acc_tax_filings;
create trigger acc_role_guard before insert or update or delete on public.acc_tax_filings for each row execute function public._acc_role_guard();

-- A member given only some clients sees the ones they create.
create or replace function public._acc_client_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and auth.uid() <> new.accountant_id then
    insert into public.acc_member_clients (member_id, client_id)
    select a.user_id, new.id from public.accountants a
    where a.user_id = auth.uid() and a.office_id = new.accountant_id and not a.all_clients and a.role <> 'admin'
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists acc_client_grant on public.acc_clients;
create trigger acc_client_grant after insert on public.acc_clients for each row execute function public._acc_client_grant();

-- ---------------------------------------------------------------------
-- History of actions
-- ---------------------------------------------------------------------
create table if not exists public.acc_activity (
  id         bigint generated always as identity primary key,
  office_id  uuid not null references public.accountants (user_id) on delete cascade,
  client_id  uuid,                         -- no FK: history stays after a client is deleted
  user_id    uuid references auth.users (id) on delete set null,
  entity     text not null,
  entity_id  text,
  action     text not null check (action in ('insert', 'update', 'delete')),
  label      text,
  amount     numeric(14, 2),
  created_at timestamptz not null default now()
);
create index if not exists acc_activity_office_idx on public.acc_activity (office_id, created_at desc);
alter table public.acc_activity enable row level security;
drop policy if exists acc_activity_own on public.acc_activity;
create policy acc_activity_own on public.acc_activity for select to authenticated
  using (public.is_accountant() and office_id = public._office_id() and (public._acc_role() = 'admin' or user_id = auth.uid()));
revoke all on public.acc_activity from anon, authenticated;
grant select on public.acc_activity to authenticated;

create or replace function public._acc_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  o jsonb;
  v_client uuid;
  v_office uuid;
  v_label text;
begin
  if auth.uid() is null then return null; end if;
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if (r - 'updated_at' - 'updated_by') = (o - 'updated_at' - 'updated_by') then return null; end if;
  end if;
  if tg_table_name = 'acc_clients' then
    v_client := (r->>'id')::uuid;
    v_office := (r->>'accountant_id')::uuid;
  else
    v_client := (r->>'client_id')::uuid;
    select accountant_id into v_office from public.acc_clients where id = v_client;
  end if;
  if v_office is null then return null; end if;   -- rows removed together with their client
  v_label := coalesce(r->>'doc_no', r->>'name', nullif(trim(coalesce(r->>'first_name', '') || ' ' || coalesce(r->>'last_name', '')), ''),
                      r->>'description', r->>'reference', r->>'file_name', r->>'month', r->>'period');
  if tg_table_name in ('acc_documents', 'acc_payments', 'acc_transactions', 'acc_scans', 'acc_vat_returns', 'acc_payroll_runs', 'acc_periods')
     and r ? 'status' and tg_op = 'UPDATE' and (r->>'status') is distinct from (o->>'status') then
    v_label := concat_ws(' · ', v_label, 'statusi: ' || (r->>'status'));
  end if;
  if tg_table_name = 'acc_periods' and tg_op = 'UPDATE' and (r->>'books_locked') is distinct from (o->>'books_locked') then
    v_label := concat_ws(' · ', v_label, case when (r->>'books_locked')::boolean then 'muaji u mbyll' else 'muaji u hap' end);
  end if;
  insert into public.acc_activity (office_id, client_id, user_id, entity, entity_id, action, label, amount)
  values (v_office, v_client, auth.uid(), tg_table_name, coalesce(r->>'id', r->>'month'), lower(tg_op), left(v_label, 200),
          coalesce(nullif(r->>'total', '')::numeric, nullif(r->>'amount', '')::numeric));
  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['acc_clients', 'acc_documents', 'acc_payments', 'acc_transactions', 'acc_partners', 'acc_employees',
                           'acc_payroll_runs', 'acc_journal_entries', 'acc_assets', 'acc_periods', 'acc_vat_returns',
                           'acc_tax_filings', 'acc_scans', 'acc_loans']
  loop
    execute format('drop trigger if exists acc_log on public.%I', t);
    execute format('create trigger acc_log after insert or update or delete on public.%I for each row execute function public._acc_log()', t);
  end loop;
end $$;

create or replace function public.acc_activity_list(p_from date, p_to date, p_user uuid default null, p_client uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  v_admin boolean := public._acc_role() = 'admin';
begin
  return coalesce((
    select jsonb_agg(x order by x.created_at desc)
    from (
      select a.id, a.created_at, a.entity, a.entity_id, a.action, a.label, a.amount, a.client_id, a.user_id,
             c.name as client_name, coalesce(m.full_name, u.email) as user_name
      from public.acc_activity a
      left join public.acc_clients c on c.id = a.client_id
      left join public.accountants m on m.user_id = a.user_id
      left join auth.users u on u.id = a.user_id
      where a.office_id = v_office
        and a.created_at >= p_from and a.created_at < p_to + 1
        and (v_admin or a.user_id = auth.uid())
        and (p_user is null or a.user_id = p_user)
        and (p_client is null or a.client_id = p_client)
        and (a.client_id is null or c.id is null or public._acc_client_visible(a.client_id))
      order by a.created_at desc
      limit 1000
    ) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Team management (creating the login is done by the Edge Function acc-office)
-- ---------------------------------------------------------------------
create or replace function public.acc_office()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  v_admin boolean := public._acc_role() = 'admin';
  o public.accountants;
begin
  select * into o from public.accountants where user_id = v_office;
  return jsonb_build_object(
    'office_id', o.user_id, 'office_name', o.office_name, 'require_mfa', o.require_mfa, 'is_admin', v_admin,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', a.user_id, 'full_name', a.full_name, 'email', a.email, 'phone', a.phone,
        'role', case when a.office_id is null then 'admin' else a.role end, 'is_owner', a.office_id is null,
        'active', a.active, 'all_clients', a.office_id is null or a.role = 'admin' or a.all_clients, 'created_at', a.created_at,
        'clients', case when v_admin then (select coalesce(jsonb_agg(mc.client_id), '[]'::jsonb) from public.acc_member_clients mc where mc.member_id = a.user_id) end,
        'last_sign_in_at', case when v_admin then u.last_sign_in_at end,
        'mfa', case when v_admin then exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified') end
      ) order by a.office_id nulls first, a.full_name), '[]'::jsonb)
      from public.accountants a
      left join auth.users u on u.id = a.user_id
      where (a.user_id = v_office or a.office_id = v_office) and (v_admin or a.active)
    ));
end $$;

-- p = {user_id, role?, active?, all_clients?, clients?: uuid[], full_name?, phone?}
create or replace function public.acc_office_save_member(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
  m public.accountants;
  v_role text;
begin
  select * into m from public.accountants where user_id = (p->>'user_id')::uuid and office_id = v_office;
  if not found then
    raise exception 'Anëtari nuk u gjet (pronari i zyrës nuk ndryshohet këtu)' using errcode = 'P0002';
  end if;
  if m.user_id = auth.uid() and (coalesce(p->>'role', m.role) <> 'admin' or coalesce((p->>'active')::boolean, true) = false) then
    raise exception 'Nuk mund ta heqësh vetes rolin e administratorit' using errcode = '22023';
  end if;
  v_role := coalesce(p->>'role', m.role);
  if v_role not in ('admin', 'accountant', 'assistant') then
    raise exception 'Roli nuk vlen' using errcode = '22023';
  end if;
  update public.accountants
     set role = v_role,
         active = coalesce((p->>'active')::boolean, active),
         all_clients = coalesce((p->>'all_clients')::boolean, all_clients),
         full_name = coalesce(nullif(trim(p->>'full_name'), ''), full_name),
         phone = case when p ? 'phone' then nullif(trim(p->>'phone'), '') else phone end
   where user_id = m.user_id;
  if p ? 'clients' then
    delete from public.acc_member_clients where member_id = m.user_id;
    insert into public.acc_member_clients (member_id, client_id)
    select m.user_id, c.id from public.acc_clients c
    where c.accountant_id = v_office and c.id in (select (jsonb_array_elements_text(p->'clients'))::uuid);
  end if;
  insert into public.acc_activity (office_id, user_id, entity, entity_id, action, label)
  values (v_office, auth.uid(), 'accountants', m.user_id::text, 'update',
          left(concat_ws(' · ', m.full_name, 'roli: ' || v_role, case when (p->>'active')::boolean = false then 'çaktivizuar' end), 200));
end $$;

-- p = {office_name?, require_mfa?}
create or replace function public.acc_office_settings(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
begin
  update public.accountants
     set office_name = case when p ? 'office_name' then nullif(trim(p->>'office_name'), '') else office_name end,
         require_mfa = coalesce((p->>'require_mfa')::boolean, require_mfa)
   where user_id = v_office;
  insert into public.acc_activity (office_id, user_id, entity, entity_id, action, label)
  values (v_office, auth.uid(), 'office', v_office::text, 'update',
          left(concat_ws(' · ', 'Cilësimet e zyrës', case when p ? 'require_mfa' then 'dy faktorë: ' || (case when (p->>'require_mfa')::boolean then 'i detyrueshëm' else 'opsional' end) end), 200));
end $$;

revoke execute on function public._office_id(), public._acc_role(), public._acc_client_visible(uuid), public._acc_require_admin(),
  public._acc_role_guard(), public._acc_client_grant(), public._acc_log() from public, anon;
grant execute on function public._office_id(), public._acc_role(), public._acc_client_visible(uuid) to authenticated;   -- used by RLS
revoke execute on function public._acc_require_admin(), public._acc_role_guard(), public._acc_client_grant(), public._acc_log() from authenticated;
revoke execute on function public.acc_activity_list(date, date, uuid, uuid), public.acc_office(), public.acc_office_save_member(jsonb),
  public.acc_office_settings(jsonb) from public, anon;
grant execute on function public.acc_activity_list(date, date, uuid, uuid), public.acc_office(), public.acc_office_save_member(jsonb),
  public.acc_office_settings(jsonb), public.acc_me(), public.is_accountant(), public.accountant_business_id(),
  public.set_active_business(uuid), public.add_accountant_by_email(text) to authenticated;
