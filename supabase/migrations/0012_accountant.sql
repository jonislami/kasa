-- =====================================================================
-- 0012 – Accountant (phase 6b): an outside person invited by the owner.
-- One account, many businesses; read-only on the books; keeps the
-- accounting records (VAT period status, expenses, notes).
--
-- * accountants: the person (name, e-mail). No profile, no PIN, not a worker.
-- * business_members: user × business, status invited / active / revoked.
-- * user_active_business: the client the accountant has open right now.
-- * accountant_business_id(): that client, only while the membership is active
--   and the business is active. current_business_id() is NOT changed, so every
--   existing policy and RPC (sales, stock, prices, users, registers, devices,
--   settings) stays closed to the accountant by default.
-- * Read access is added table by table with separate SELECT policies
--   (sales, lines, costs, catalog, suppliers, stock entries, movements, inventory).
--   Nothing for profiles, registers, devices, business_settings, audit_log, shifts.
-- * books_business_id(): manager's own business or the accountant's open client –
--   used by the accounting screens, shared by the owner and the accountant.
-- * accounting_periods (VAT status per month) and expenses are the only things an
--   accountant writes, through RPCs; every change goes to audit_log.
-- * The role is stored as text on the membership ('accountant'); profiles.role and
--   the user_role enum are untouched, so nothing changes for today's users.
-- Older clients keep working: my_context only gains the "accountant" key.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.accountants (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  email      text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.business_members (
  user_id        uuid not null references auth.users (id) on delete cascade,
  business_id    uuid not null references public.businesses (id) on delete cascade,
  role           text not null default 'accountant' check (role in ('accountant')),
  status         text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  invited_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),   -- when invited (last time)
  responded_at   timestamptz,
  revoked_at     timestamptz,
  last_opened_at timestamptz,
  note           text,                                  -- the accountant's own note about this client
  primary key (user_id, business_id)
);
create index if not exists business_members_business_idx on public.business_members (business_id);

create table if not exists public.user_active_business (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  updated_at  timestamptz not null default now()
);

create table if not exists public.accounting_periods (
  business_id uuid not null references public.businesses (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  vat_status  text not null default 'open' check (vat_status in ('open', 'filed')),
  note        text,
  closed_by   uuid references auth.users (id) on delete set null,
  closed_at   timestamptz,
  primary key (business_id, month)
);

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  expense_date date not null,
  category     text not null check (category in ('rent', 'utilities', 'wages', 'contributions', 'taxes', 'telecom',
                                                  'transport', 'maintenance', 'marketing', 'bank', 'services', 'other')),
  description  text,
  vendor       text,
  doc_no       text,
  vat_code     char(1) not null default 'A' check (vat_code in ('E', 'D', 'C', 'A')),
  total        numeric(12, 2) not null check (total > 0),     -- VAT included
  net_total    numeric(12, 2) not null,
  vat_total    numeric(12, 2) not null,
  payment      text not null default 'cash' check (payment in ('cash', 'bank', 'due')),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists expenses_business_idx on public.expenses (business_id, expense_date);

alter table public.accountants          enable row level security;
alter table public.business_members     enable row level security;
alter table public.user_active_business enable row level security;
alter table public.accounting_periods   enable row level security;
alter table public.expenses             enable row level security;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- The client an accountant has open. Null for staff (they have a profile), for a revoked or
-- only-invited membership and for a deactivated business.
create or replace function public.accountant_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
  from public.user_active_business a
  join public.business_members m on m.user_id = a.user_id and m.business_id = a.business_id
  join public.businesses b on b.id = m.business_id
  where a.user_id = auth.uid()
    and m.status = 'active'
    and m.role = 'accountant'
    and b.active
    and not exists (select 1 from public.profiles p where p.id = auth.uid())
$$;

-- Whose books the caller may read: a manager's own business, or the accountant's open client.
create or replace function public.books_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_manager() then public.current_business_id() else public.accountant_business_id() end
$$;

create or replace function public._require_books()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v uuid := public.books_business_id();
begin
  if v is null then
    raise exception 'Vetëm pronari, menaxheri ose kontabilisti' using errcode = '42501';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- RLS: what the accountant reads (SELECT only, the open client only)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['sales', 'sale_items', 'sale_item_costs', 'products', 'product_costs', 'categories',
                           'suppliers', 'stock_entries', 'stock_entry_items', 'stock_movements',
                           'inventory_counts', 'inventory_count_items']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_accountant', t);
    execute format('create policy %I on public.%I for select to authenticated using (business_id = public.accountant_business_id())',
                   t || '_accountant', t);
  end loop;
end $$;

drop policy if exists businesses_accountant on public.businesses;
create policy businesses_accountant on public.businesses
  for select to authenticated using (id = public.accountant_business_id());

drop policy if exists accountants_self on public.accountants;
create policy accountants_self on public.accountants
  for select to authenticated using (user_id = auth.uid());

drop policy if exists accounting_periods_select on public.accounting_periods;
create policy accounting_periods_select on public.accounting_periods
  for select to authenticated using (business_id = public.books_business_id());

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated using (business_id = public.books_business_id());

-- Memberships and the open client are reached only through the RPCs below.
revoke all on public.accountants, public.business_members, public.user_active_business,
              public.accounting_periods, public.expenses from anon, authenticated;
grant select on public.accountants, public.accounting_periods, public.expenses to authenticated;

-- ---------------------------------------------------------------------
-- Session context: staff as before; an accountant gets the open client as "business"
-- and a profile-shaped object with role 'accountant'.
-- ---------------------------------------------------------------------
create or replace function public.my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
  v_business jsonb;
  v_accountant jsonb;
  v_acc public.accountants%rowtype;
  v_open uuid;
begin
  select jsonb_build_object(
           'id', p.id, 'business_id', p.business_id, 'role', p.role,
           'full_name', p.full_name, 'email', p.email, 'active', p.active, 'login_kind', p.login_kind)
    into v_profile
  from public.profiles p where p.id = auth.uid();

  if v_profile is not null then
    select jsonb_build_object(
             'id', b.id, 'name', b.name, 'type', b.type, 'active', b.active,
             'city', b.city, 'address', b.address, 'phone', b.phone, 'nui', b.nui,
             'vat_number', b.vat_number, 'fiscal_number', b.fiscal_number)
      into v_business
    from public.businesses b where b.id = (v_profile->>'business_id')::uuid;
  else
    select * into v_acc from public.accountants where user_id = auth.uid();
    if found then
      v_accountant := jsonb_build_object(
        'full_name', v_acc.full_name, 'email', v_acc.email,
        'clients', (select count(*) from public.business_members m join public.businesses b on b.id = m.business_id
                    where m.user_id = auth.uid() and m.status = 'active' and b.active),
        'invited', (select count(*) from public.business_members m join public.businesses b on b.id = m.business_id
                    where m.user_id = auth.uid() and m.status = 'invited' and b.active));
      v_open := public.accountant_business_id();
      if v_open is not null then
        v_profile := jsonb_build_object(
          'id', auth.uid(), 'business_id', v_open, 'role', 'accountant',
          'full_name', v_acc.full_name, 'email', v_acc.email, 'active', true, 'login_kind', 'email');
        select jsonb_build_object(
                 'id', b.id, 'name', b.name, 'type', b.type, 'active', b.active,
                 'city', b.city, 'address', b.address, 'phone', b.phone, 'nui', b.nui,
                 'vat_number', b.vat_number, 'fiscal_number', b.fiscal_number)
          into v_business
        from public.businesses b where b.id = v_open;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'user_id', auth.uid(),
    'is_platform_admin', public.is_platform_admin(),
    'profile', v_profile,
    'business', v_business,
    'accountant', v_accountant
  );
end $$;

-- ---------------------------------------------------------------------
-- Invitation (called by the Edge Function invite-accountant with the service role,
-- after it has made sure the auth user exists).
-- ---------------------------------------------------------------------
create or replace function public._link_accountant(p_business uuid, p_inviter uuid, p_email text, p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_full_name, ''));
  v_user uuid;
  v_status text;
begin
  if not exists (
    select 1 from public.profiles p join public.businesses b on b.id = p.business_id
    where p.id = p_inviter and p.business_id = p_business and p.role = 'admin' and p.active and b.active
  ) then
    raise exception 'Vetëm pronari e fton kontabilistin' using errcode = '42501';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email limit 1;
  if v_user is null then
    raise exception 'Llogaria nuk ekziston' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles where id = v_user)
     or exists (select 1 from public.platform_admins where user_id = v_user) then
    raise exception 'Ky email përdoret nga një llogari biznesi në Kasa. Kontabilisti duhet të ketë një email tjetër.'
      using errcode = '23505';
  end if;

  insert into public.accountants (user_id, full_name, email)
  values (v_user, v_name, v_email)
  on conflict (user_id) do update
    set full_name = case when public.accountants.full_name = '' then excluded.full_name else public.accountants.full_name end;

  insert into public.business_members (user_id, business_id, role, status, invited_by)
  values (v_user, p_business, 'accountant', 'invited', p_inviter)
  on conflict (user_id, business_id) do update
    set status = case when public.business_members.status = 'active' then 'active' else 'invited' end,
        invited_by = excluded.invited_by,
        created_at = case when public.business_members.status = 'active' then public.business_members.created_at else now() end,
        responded_at = case when public.business_members.status = 'active' then public.business_members.responded_at else null end,
        revoked_at = null
  returning status into v_status;

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (p_business, p_inviter, 'accountant_invite', 'accountant', v_user::text,
          jsonb_build_object('email', v_email, 'name', (select full_name from public.accountants where user_id = v_user)));

  return jsonb_build_object('user_id', v_user, 'status', v_status,
                            'full_name', (select full_name from public.accountants where user_id = v_user));
end $$;

-- Accountants of the caller's business (Cilësimet → Kontabilisti).
create or replace function public.business_accountants()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_manager();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', m.user_id, 'full_name', a.full_name, 'email', a.email, 'status', m.status,
             'invited_at', m.created_at, 'responded_at', m.responded_at, 'revoked_at', m.revoked_at,
             'last_opened_at', m.last_opened_at)
           order by case m.status when 'active' then 0 when 'invited' then 1 else 2 end, m.created_at desc), '[]'::jsonb)
    from public.business_members m
    join public.accountants a on a.user_id = m.user_id
    where m.business_id = v_business
  );
end $$;

-- The owner takes the access away (any time).
create or replace function public.revoke_accountant(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  update public.business_members
     set status = 'revoked', revoked_at = now()
   where user_id = p_user and business_id = v_business and status <> 'revoked';
  if not found then
    raise exception 'Kontabilisti nuk u gjet' using errcode = 'P0002';
  end if;
  delete from public.user_active_business where user_id = p_user and business_id = v_business;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'accountant_revoke', 'accountant', p_user::text,
          jsonb_build_object('email', (select email from public.accountants where user_id = p_user),
                             'name', (select full_name from public.accountants where user_id = p_user)));
end $$;

-- The accountant accepts or declines an invitation.
create or replace function public.respond_invitation(p_business uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Kjo llogari është e një biznesi' using errcode = '42501';
  end if;
  update public.business_members
     set status = case when p_accept then 'active' else 'revoked' end,
         responded_at = now(),
         revoked_at = case when p_accept then null else now() end
   where user_id = auth.uid() and business_id = p_business and status = 'invited';
  if not found then
    raise exception 'Ftesa nuk u gjet' using errcode = 'P0002';
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (p_business, auth.uid(), case when p_accept then 'accountant_accept' else 'accountant_decline' end,
          'accountant', auth.uid()::text,
          jsonb_build_object('email', (select email from public.accountants where user_id = auth.uid()),
                             'name', (select full_name from public.accountants where user_id = auth.uid())));
end $$;

-- Open a client (null = close it and go back to the list).
create or replace function public.set_active_business(p_business uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Nuk je i kyçur' using errcode = '42501';
  end if;
  if p_business is null then
    delete from public.user_active_business where user_id = auth.uid();
    return;
  end if;
  select m.last_opened_at into v_last
  from public.business_members m
  join public.businesses b on b.id = m.business_id
  where m.user_id = auth.uid() and m.business_id = p_business and m.status = 'active' and b.active
    and not exists (select 1 from public.profiles p where p.id = auth.uid());
  if not found then
    raise exception 'Nuk ke qasje në këtë biznes' using errcode = '42501';
  end if;
  insert into public.user_active_business (user_id, business_id)
  values (auth.uid(), p_business)
  on conflict (user_id) do update set business_id = excluded.business_id, updated_at = now();
  update public.business_members set last_opened_at = now() where user_id = auth.uid() and business_id = p_business;
  if v_last is null or v_last < now() - interval '30 minutes' then
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (p_business, auth.uid(), 'accountant_open', 'accountant', auth.uid()::text,
            jsonb_build_object('name', (select full_name from public.accountants where user_id = auth.uid())));
  end if;
end $$;

create or replace function public.set_client_note(p_business uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.business_members
     set note = nullif(trim(left(coalesce(p_note, ''), 500)), '')
   where user_id = auth.uid() and business_id = p_business and status = 'active';
  if not found then
    raise exception 'Nuk ke qasje në këtë biznes' using errcode = '42501';
  end if;
end $$;

-- "Klientët e mi": every business of the accountant with the month's figures.
create or replace function public.my_clients(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := date_trunc('month', coalesce(p_month, public._local_date()))::date;
  v_to date := (date_trunc('month', coalesce(p_month, public._local_date())) + interval '1 month - 1 day')::date;
begin
  if auth.uid() is null or exists (select 1 from public.profiles where id = auth.uid()) then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(x.j order by x.ord, x.name), '[]'::jsonb)
    from (
      select
        b.name,
        case m.status when 'invited' then 0 else 1 end as ord,
        jsonb_build_object(
          'business_id', b.id, 'name', b.name, 'type', b.type, 'city', b.city, 'nui', b.nui,
          'vat_number', b.vat_number, 'business_active', b.active, 'owner_name', b.owner_name,
          'role', m.role, 'status', m.status, 'invited_at', m.created_at,
          'last_opened_at', m.last_opened_at, 'note', m.note
        ) || case when m.status = 'active' and b.active then jsonb_build_object(
          'last_activity', (select max(s.created_at) from public.sales s where s.business_id = b.id),
          'sales_total', coalesce(st.total, 0),
          'docs', coalesce(st.docs, 0),
          'corrections', coalesce(st.corrections, 0),
          'offline', coalesce(st.offline, 0),
          'vat_out', coalesce(st.vat, 0),
          'vat_in', coalesce((select sum(e.vat_total) from public.stock_entries e
                              where e.business_id = b.id and e.status = 'confirmed' and e.entry_date between v_from and v_to), 0)
                    + coalesce((select sum(x.vat_total) from public.expenses x
                                where x.business_id = b.id and x.expense_date between v_from and v_to), 0),
          'vat_status', case when nullif(trim(coalesce(b.vat_number, '')), '') is null then 'na'
                             else coalesce((select p.vat_status from public.accounting_periods p
                                            where p.business_id = b.id and p.month = v_from), 'open') end
        ) else '{}'::jsonb end as j
      from public.business_members m
      join public.businesses b on b.id = m.business_id
      left join lateral (
        select sum(s.total) as total, sum(s.vat_total) as vat,
               count(*) filter (where s.kind = 'sale') as docs,
               count(*) filter (where s.kind <> 'sale') as corrections,
               count(*) filter (where s.offline) as offline
        from public.sales s
        where s.business_id = b.id and s.sale_date between v_from and v_to and m.status = 'active' and b.active
      ) st on true
      where m.user_id = auth.uid() and m.status in ('invited', 'active')
    ) x
  );
end $$;

-- ---------------------------------------------------------------------
-- The books of one business for a period (owner / manager / accountant).
-- ---------------------------------------------------------------------
create or replace function public.accounting_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_books();
  v_manager boolean := public.is_manager();
  v_biz jsonb;
  v_sales jsonb;
  v_vat_out jsonb;
  v_purchases jsonb;
  v_vat_in jsonb;
  v_expenses jsonb;
  v_exp_cat jsonb;
  v_exp_vat jsonb;
  v_cogs jsonb;
  v_stock jsonb;
  v_adjust jsonb;
  v_daily jsonb;
  v_shifts jsonb;
  v_registers jsonb;
  v_period jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Periudha nuk është e saktë (deri në 400 ditë)' using errcode = '22023';
  end if;

  select jsonb_build_object('id', b.id, 'name', b.name, 'type', b.type, 'city', b.city, 'address', b.address,
                            'nui', b.nui, 'vat_number', b.vat_number, 'fiscal_number', b.fiscal_number,
                            'vat_registered', nullif(trim(coalesce(b.vat_number, '')), '') is not null)
    into v_biz from public.businesses b where b.id = v_business;

  select jsonb_build_object(
    'gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_total), 0), 'vat', coalesce(sum(vat_total), 0),
    'docs', count(*) filter (where kind = 'sale'),
    'voids', count(*) filter (where kind = 'void'), 'void_total', coalesce(sum(total) filter (where kind = 'void'), 0),
    'refunds', count(*) filter (where kind = 'refund'), 'refund_total', coalesce(sum(total) filter (where kind = 'refund'), 0),
    'cash', coalesce(sum(cash_amount), 0), 'card', coalesce(sum(card_amount), 0),
    'discounts', coalesce(sum(discount_total), 0),
    'offline', count(*) filter (where offline),
    'first_no', min(invoice_no), 'last_no', max(invoice_no)
  ) into v_sales
  from public.sales where business_id = v_business and sale_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'gross', gross, 'net', net, 'vat', vat) order by code), '[]'::jsonb)
    into v_vat_out
  from (
    select l->>'code' as code, sum((l->>'gross')::numeric) as gross, sum((l->>'net')::numeric) as net, sum((l->>'vat')::numeric) as vat
    from public.sales s, jsonb_array_elements(s.vat_lines) l
    where s.business_id = v_business and s.sale_date between p_from and p_to
    group by 1
  ) t;

  select jsonb_build_object(
    'gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_total), 0), 'vat', coalesce(sum(vat_total), 0),
    'docs', count(*),
    'due', coalesce(sum(total) filter (where payment = 'due'), 0),
    'cash', coalesce(sum(total) filter (where payment = 'cash'), 0),
    'bank', coalesce(sum(total) filter (where payment = 'bank'), 0)
  ) into v_purchases
  from public.stock_entries
  where business_id = v_business and status = 'confirmed' and entry_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'gross', gross, 'net', net, 'vat', vat) order by code), '[]'::jsonb)
    into v_vat_in
  from (
    select l->>'code' as code, sum((l->>'gross')::numeric) as gross, sum((l->>'net')::numeric) as net, sum((l->>'vat')::numeric) as vat
    from public.stock_entries e, jsonb_array_elements(e.vat_lines) l
    where e.business_id = v_business and e.status = 'confirmed' and e.entry_date between p_from and p_to
    group by 1
  ) t;

  select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_total), 0),
                            'vat', coalesce(sum(vat_total), 0), 'docs', count(*),
                            'due', coalesce(sum(total) filter (where payment = 'due'), 0))
    into v_expenses
  from public.expenses where business_id = v_business and expense_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'gross', gross, 'net', net, 'vat', vat) order by gross desc), '[]'::jsonb)
    into v_exp_cat
  from (
    select category, sum(total) as gross, sum(net_total) as net, sum(vat_total) as vat
    from public.expenses where business_id = v_business and expense_date between p_from and p_to
    group by category
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'gross', gross, 'net', net, 'vat', vat) order by code), '[]'::jsonb)
    into v_exp_vat
  from (
    select vat_code::text as code, sum(total) as gross, sum(net_total) as net, sum(vat_total) as vat
    from public.expenses where business_id = v_business and expense_date between p_from and p_to
    group by vat_code
  ) t;

  -- Cost of goods sold from the purchase prices stored at sale time (VAT included → also without VAT).
  select jsonb_build_object(
    'gross', coalesce(round(sum(i.quantity * coalesce(c.purchase_price, 0)), 2), 0),
    'net', coalesce(round(sum(i.quantity * coalesce(c.purchase_price, 0) / (1 + i.vat_rate)), 2), 0)
  ) into v_cogs
  from public.sale_items i
  join public.sales s on s.id = i.sale_id
  left join public.sale_item_costs c on c.sale_item_id = i.id
  where s.business_id = v_business and s.sale_date between p_from and p_to;

  -- Stock on hand today, at purchase price.
  select jsonb_build_object(
    'items', count(*) filter (where p.stock > 0),
    'gross', coalesce(round(sum(p.stock * coalesce(c.purchase_price, 0)) filter (where p.stock > 0), 2), 0),
    'net', coalesce(round(sum(p.stock * coalesce(c.purchase_price, 0) / (1 + public._vat_rate(p.vat_code))) filter (where p.stock > 0), 2), 0),
    'sale_value', coalesce(round(sum(p.stock * p.sale_price) filter (where p.stock > 0), 2), 0)
  ) into v_stock
  from public.products p
  left join public.product_costs c on c.product_id = p.id
  where p.business_id = v_business and p.kind = 'product' and p.active;

  -- Write-offs and inventory differences in the period, at today's purchase price.
  select jsonb_build_object(
    'writeoffs', coalesce(round(sum(m.quantity * coalesce(c.purchase_price, 0)) filter (where m.kind = 'adjustment'), 2), 0),
    'inventory', coalesce(round(sum(m.quantity * coalesce(c.purchase_price, 0)) filter (where m.kind = 'inventory'), 2), 0)
  ) into v_adjust
  from public.stock_movements m
  left join public.product_costs c on c.product_id = m.product_id
  where m.business_id = v_business and m.kind in ('adjustment', 'inventory')
    and m.created_at >= public._day_start(p_from) and m.created_at < public._day_start(p_to + 1);

  -- Daily sales book (the day's totals per VAT rate, as on the daily report of the till).
  select coalesce(jsonb_agg(d order by d->>'date'), '[]'::jsonb) into v_daily
  from (
    select jsonb_build_object(
      'date', s.sale_date, 'docs', count(*) filter (where s.kind = 'sale'),
      'corrections', count(*) filter (where s.kind <> 'sale'),
      'first_no', min(s.invoice_no), 'last_no', max(s.invoice_no),
      'gross', sum(s.total), 'net', sum(s.net_total), 'vat', sum(s.vat_total),
      'cash', sum(s.cash_amount), 'card', sum(s.card_amount),
      'rates', (
        select coalesce(jsonb_object_agg(code, jsonb_build_object('gross', gross, 'net', net, 'vat', vat)), '{}'::jsonb)
        from (
          select l->>'code' as code, sum((l->>'gross')::numeric) as gross, sum((l->>'net')::numeric) as net, sum((l->>'vat')::numeric) as vat
          from public.sales s2, jsonb_array_elements(s2.vat_lines) l
          where s2.business_id = v_business and s2.sale_date = s.sale_date
          group by 1
        ) r
      )
    ) as d
    from public.sales s
    where s.business_id = v_business and s.sale_date between p_from and p_to
    group by s.sale_date
  ) t;

  -- Cash reconciliation per closed shift: opening + cash sales of that shift vs. counted cash.
  select coalesce(jsonb_agg(x order by x->>'started_at' desc), '[]'::jsonb) into v_shifts
  from (
    select jsonb_build_object(
      'id', h.id, 'started_at', h.started_at, 'ended_at', h.ended_at,
      'register', (select r.name from public.registers r where r.id = h.register_id),
      'worker', case when v_manager then (select nullif(pr.full_name, '') from public.profiles pr where pr.id = h.worker_id) end,
      'opening', h.opening_cash, 'counted', h.closing_cash,
      'cash_sales', coalesce(cs.cash, 0), 'card_sales', coalesce(cs.card, 0), 'docs', coalesce(cs.docs, 0)
    ) as x
    from public.shifts h
    left join lateral (
      select sum(s.cash_amount) as cash, sum(s.card_amount) as card, count(*) filter (where s.kind = 'sale') as docs
      from public.sales s
      where s.business_id = v_business and s.worker_id = h.worker_id
        and s.created_at >= h.started_at and s.created_at < coalesce(h.ended_at, now())
    ) cs on true
    where h.business_id = v_business
      and h.started_at >= public._day_start(p_from) and h.started_at < public._day_start(p_to + 1)
    order by h.started_at desc
    limit 500
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name), '[]'::jsonb)
    into v_registers from public.registers r where r.business_id = v_business;

  select coalesce(jsonb_agg(jsonb_build_object('month', p.month, 'vat_status', p.vat_status, 'note', p.note, 'closed_at', p.closed_at) order by p.month), '[]'::jsonb)
    into v_period
  from public.accounting_periods p
  where p.business_id = v_business and p.month between date_trunc('month', p_from)::date and p_to;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'business', v_biz,
    'sales', v_sales, 'vat_out', v_vat_out,
    'purchases', v_purchases, 'vat_in', v_vat_in,
    'expenses', v_expenses, 'expense_categories', v_exp_cat, 'expense_vat', v_exp_vat,
    'cogs', v_cogs, 'stock', v_stock, 'adjustments', v_adjust,
    'daily', v_daily, 'shifts', v_shifts, 'registers', v_registers, 'periods', v_period
  );
end $$;

-- VAT status of a month ("E dorëzuar" / "Për t'u bërë") + note.
create or replace function public.set_period_status(p_month date, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_books();
  v_month date := date_trunc('month', p_month)::date;
begin
  if p_month is null or p_status not in ('open', 'filed') then
    raise exception 'Statusi nuk njihet' using errcode = '22023';
  end if;
  insert into public.accounting_periods (business_id, month, vat_status, note, closed_by, closed_at)
  values (v_business, v_month, p_status, nullif(trim(coalesce(p_note, '')), ''),
          case when p_status = 'filed' then auth.uid() end, case when p_status = 'filed' then now() end)
  on conflict (business_id, month) do update
    set vat_status = excluded.vat_status,
        note = coalesce(excluded.note, public.accounting_periods.note),
        closed_by = excluded.closed_by, closed_at = excluded.closed_at;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'period_status', 'accounting_period', v_month::text,
          jsonb_build_object('month', v_month, 'vat_status', p_status));
end $$;

-- Expenses (rent, utilities, wages…): kept by the accountant or the manager.
create or replace function public.save_expense(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_books();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_date date := (p->>'expense_date')::date;
  v_total numeric := round((p->>'total')::numeric, 2);
  v_code text := coalesce(nullif(p->>'vat_code', ''), 'A');
  v_net numeric;
begin
  if v_date is null or v_date > public._local_date() + 31 or v_date < date '2000-01-01' then
    raise exception 'Data nuk është e saktë' using errcode = '22023';
  end if;
  if v_total is null or v_total <= 0 or v_total > 100000000 then
    raise exception 'Shuma duhet të jetë më e madhe se zero' using errcode = '22023';
  end if;
  if v_code not in ('E', 'D', 'C', 'A') then
    raise exception 'Norma e TVSH-së nuk njihet' using errcode = '22023';
  end if;
  v_net := round(v_total / (1 + public._vat_rate(v_code)), 2);

  if v_id is null then
    insert into public.expenses (business_id, expense_date, category, description, vendor, doc_no, vat_code,
                                 total, net_total, vat_total, payment, created_by)
    values (v_business, v_date, coalesce(nullif(p->>'category', ''), 'other'),
            nullif(trim(left(coalesce(p->>'description', ''), 300)), ''),
            nullif(trim(left(coalesce(p->>'vendor', ''), 200)), ''),
            nullif(trim(left(coalesce(p->>'doc_no', ''), 60)), ''),
            v_code, v_total, v_net, v_total - v_net, coalesce(nullif(p->>'payment', ''), 'cash'), auth.uid())
    returning id into v_id;
  else
    update public.expenses set
      expense_date = v_date,
      category = coalesce(nullif(p->>'category', ''), 'other'),
      description = nullif(trim(left(coalesce(p->>'description', ''), 300)), ''),
      vendor = nullif(trim(left(coalesce(p->>'vendor', ''), 200)), ''),
      doc_no = nullif(trim(left(coalesce(p->>'doc_no', ''), 60)), ''),
      vat_code = v_code, total = v_total, net_total = v_net, vat_total = v_total - v_net,
      payment = coalesce(nullif(p->>'payment', ''), 'cash'),
      updated_at = now()
    where id = v_id and business_id = v_business;
    if not found then
      raise exception 'Shpenzimi nuk u gjet' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'expense_save', 'expense', v_id::text,
          jsonb_build_object('date', v_date, 'category', coalesce(nullif(p->>'category', ''), 'other'), 'total', v_total));
  return v_id;
end $$;

create or replace function public.delete_expense(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._require_books();
  v_row public.expenses%rowtype;
begin
  delete from public.expenses where id = p_id and business_id = v_business returning * into v_row;
  if not found then
    raise exception 'Shpenzimi nuk u gjet' using errcode = 'P0002';
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'expense_delete', 'expense', p_id::text,
          jsonb_build_object('date', v_row.expense_date, 'category', v_row.category, 'total', v_row.total));
end $$;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.accountant_business_id(), public.books_business_id(), public._require_books(),
  public._link_accountant(uuid, uuid, text, text), public.business_accountants(), public.revoke_accountant(uuid),
  public.respond_invitation(uuid, boolean), public.set_active_business(uuid), public.set_client_note(uuid, text),
  public.my_clients(date), public.accounting_summary(date, date), public.set_period_status(date, text, text),
  public.save_expense(jsonb), public.delete_expense(uuid), public.my_context() from public, anon;
grant execute on function public.accountant_business_id(), public.books_business_id(), public._require_books(),
  public.business_accountants(), public.revoke_accountant(uuid),
  public.respond_invitation(uuid, boolean), public.set_active_business(uuid), public.set_client_note(uuid, text),
  public.my_clients(date), public.accounting_summary(date, date), public.set_period_status(date, text, text),
  public.save_expense(jsonb), public.delete_expense(uuid), public.my_context() to authenticated;
-- Only the Edge Function (service role) links an accountant.
revoke execute on function public._link_accountant(uuid, uuid, text, text) from authenticated;
grant execute on function public._link_accountant(uuid, uuid, text, text) to service_role;
