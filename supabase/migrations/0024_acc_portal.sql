-- =====================================================================
-- 0024 – Kasa Kontabilist, phase K7 (part 3): the client portal.
--
-- * acc_portal_users: people of a client company who may open the portal (same program, route /portal).
--   Created by the office (Edge Function acc-office, action create_portal_user); an existing account
--   (e.g. the owner who uses Kasa) is linked by e-mail instead of getting a new password.
-- * Portal (read-only on the books): overview of the month and the year, invoices with what is open,
--   declarations (VAT, payroll, other taxes), the office's invoices to the client, document requests.
-- * The client uploads photos / PDFs of invoices: they land in acc_scans (source 'portal'), where the
--   office reads them with AI (K6); an upload for a document request marks it received.
-- * acc_messages: one conversation per client between the office and the client.
-- * Storage: a portal user reads and uploads only in the folder of its own client(s).
-- Nothing existing changes shape; the office side sees uploads and unread messages in its counters.
-- =====================================================================

create table if not exists public.acc_portal_users (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references public.accountants (user_id) on delete cascade,
  client_id    uuid not null references public.acc_clients (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  full_name    text not null,
  email        text not null,
  active       boolean not null default true,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (client_id, user_id)
);
create index if not exists acc_portal_users_user_idx on public.acc_portal_users (user_id);

create table if not exists public.acc_messages (
  id          bigint generated always as identity primary key,
  office_id   uuid not null references public.accountants (user_id) on delete cascade,
  client_id   uuid not null references public.acc_clients (id) on delete cascade,
  sender_id   uuid references auth.users (id) on delete set null,
  from_client boolean not null,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now(),
  read_at     timestamptz                     -- read by the other side
);
create index if not exists acc_messages_client_idx on public.acc_messages (client_id, id desc);

alter table public.acc_scans add column if not exists source text not null default 'office';
do $$ begin
  alter table public.acc_scans add constraint acc_scans_source_check check (source in ('office', 'portal'));
exception when duplicate_object then null; end $$;
alter table public.acc_scans add column if not exists request_id uuid references public.acc_doc_requests (id) on delete set null;
alter table public.acc_scans add column if not exists note text;

-- ---------------------------------------------------------------------
-- Who is a portal user of which client
-- ---------------------------------------------------------------------
create or replace function public._portal_client(p_client uuid)
returns public.acc_clients
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients;
begin
  select c2.* into c
  from public.acc_portal_users pu
  join public.acc_clients c2 on c2.id = pu.client_id
  join public.accountants o on o.user_id = c2.accountant_id
  where pu.user_id = auth.uid() and pu.client_id = p_client and pu.active and c2.active and o.active;
  if not found then
    raise exception 'Nuk ke qasje në këtë kompani' using errcode = '42501';
  end if;
  return c;
end $$;

create or replace function public._portal_clients()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pu.client_id
  from public.acc_portal_users pu
  join public.acc_clients c on c.id = pu.client_id
  join public.accountants o on o.user_id = c.accountant_id
  where pu.user_id = auth.uid() and pu.active and c.active and o.active
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.acc_portal_users enable row level security;
alter table public.acc_messages enable row level security;
drop policy if exists acc_portal_users_own on public.acc_portal_users;
create policy acc_portal_users_own on public.acc_portal_users for select to authenticated
  using (user_id = auth.uid() or public._acc_client_visible(client_id));
drop policy if exists acc_messages_own on public.acc_messages;
create policy acc_messages_own on public.acc_messages for select to authenticated
  using (public._acc_client_visible(client_id) or client_id in (select public._portal_clients()));
revoke all on public.acc_portal_users, public.acc_messages from anon, authenticated;
grant select on public.acc_portal_users, public.acc_messages to authenticated;

drop policy if exists acc_files_portal_read on storage.objects;
create policy acc_files_portal_read on storage.objects for select to authenticated
  using (bucket_id = 'acc-files' and (storage.foldername(name))[1] in (select c::text from public._portal_clients() c));
drop policy if exists acc_files_portal_write on storage.objects;
create policy acc_files_portal_write on storage.objects for insert to authenticated
  with check (bucket_id = 'acc-files' and (storage.foldername(name))[1] in (select c::text from public._portal_clients() c)
              and name like '%/portal-%');

-- Used by the Edge Function acc-office (service role only): an existing account with this e-mail.
create or replace function public._auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;
revoke execute on function public._auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public._auth_user_id_by_email(text) to service_role;

-- ---------------------------------------------------------------------
-- Office side
-- ---------------------------------------------------------------------
create or replace function public.acc_portal_users_list(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', pu.id, 'user_id', pu.user_id, 'full_name', pu.full_name, 'email', pu.email, 'active', pu.active,
                                        'created_at', pu.created_at, 'last_seen_at', pu.last_seen_at,
                                        'kasa_owner', exists (select 1 from public.profiles p where p.id = pu.user_id)) order by pu.full_name)
    from public.acc_portal_users pu where pu.client_id = c.id
  ), '[]'::jsonb);
end $$;

create or replace function public.acc_portal_user_set(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pu public.acc_portal_users;
begin
  select * into pu from public.acc_portal_users where id = p_id;
  if not found then raise exception 'Përdoruesi nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(pu.client_id);
  if public._acc_role() = 'assistant' then
    raise exception 'Ky veprim kërkon kontabilistin ose administratorin e zyrës' using errcode = '42501';
  end if;
  update public.acc_portal_users set active = p_active where id = p_id;
end $$;

-- Conversation with a client; reading marks the client's messages as read.
create or replace function public.acc_messages_list(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  update public.acc_messages set read_at = now() where client_id = c.id and from_client and read_at is null;
  return coalesce((
    select jsonb_agg(x order by x.id)
    from (
      select m.id, m.from_client, m.body, m.created_at, m.read_at,
             coalesce(a.full_name, pu.full_name, u.email) as sender_name
      from public.acc_messages m
      left join public.accountants a on a.user_id = m.sender_id
      left join public.acc_portal_users pu on pu.user_id = m.sender_id and pu.client_id = m.client_id
      left join auth.users u on u.id = m.sender_id
      where m.client_id = c.id
      order by m.id desc
      limit 300
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.acc_message_send(p_client uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if coalesce(trim(p_body), '') = '' then raise exception 'Shkruaj mesazhin' using errcode = '22023'; end if;
  insert into public.acc_messages (office_id, client_id, sender_id, from_client, body)
  values (c.accountant_id, c.id, auth.uid(), false, left(trim(p_body), 4000));
end $$;

-- Clients with unread messages or new uploads from the portal.
create or replace function public.acc_portal_inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
begin
  return coalesce((
    select jsonb_agg(x order by x.last_at desc)
    from (
      select c.id as client_id, c.name as client_name,
             (select count(*) from public.acc_messages m where m.client_id = c.id and m.from_client and m.read_at is null) as unread,
             (select count(*) from public.acc_scans s where s.client_id = c.id and s.source = 'portal' and s.status in ('pending', 'read', 'failed')) as uploads,
             greatest((select max(m.created_at) from public.acc_messages m where m.client_id = c.id and m.from_client and m.read_at is null),
                      (select max(s.created_at) from public.acc_scans s where s.client_id = c.id and s.source = 'portal' and s.status in ('pending', 'read', 'failed'))) as last_at
      from public.acc_clients c
      where c.accountant_id = v_office and public._acc_client_visible(c.id)
    ) x
    where x.unread > 0 or x.uploads > 0
  ), '[]'::jsonb);
end $$;

-- Counters of the program header (0023) + portal.
create or replace function public.acc_work_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  v_today date := public._local_date();
begin
  return jsonb_build_object(
    'my_tasks', (select count(*) from public.acc_tasks t where t.office_id = v_office and t.status <> 'done'
                   and (t.assigned_to = auth.uid() or (t.assigned_to is null and t.created_by = auth.uid()))
                   and (t.client_id is null or public._acc_client_visible(t.client_id))),
    'overdue_tasks', (select count(*) from public.acc_tasks t where t.office_id = v_office and t.status <> 'done' and t.due_date < v_today
                        and (t.client_id is null or public._acc_client_visible(t.client_id))),
    'open_requests', (select count(*) from public.acc_doc_requests r where r.office_id = v_office and r.status = 'requested'
                        and public._acc_client_visible(r.client_id)),
    'overdue_requests', (select count(*) from public.acc_doc_requests r where r.office_id = v_office and r.status = 'requested'
                           and r.due_date < v_today and public._acc_client_visible(r.client_id)),
    'unpaid', case when public._acc_role() = 'admin' then
                (select coalesce(sum(i.total - i.paid), 0) from public.acc_office_invoices i where i.office_id = v_office and i.status = 'open') end,
    'unread_messages', (select count(*) from public.acc_messages m where m.office_id = v_office and m.from_client and m.read_at is null
                          and public._acc_client_visible(m.client_id)),
    'portal_uploads', (select count(*) from public.acc_scans s join public.acc_clients c on c.id = s.client_id
                         where c.accountant_id = v_office and s.source = 'portal' and s.status in ('pending', 'read', 'failed')
                           and public._acc_client_visible(s.client_id))
  );
end $$;

-- Scans list (0021) + where the file came from.
create or replace function public.acc_scans_list(p_client uuid, p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'path', s.path, 'file_name', s.file_name, 'mime', s.mime, 'size_bytes', s.size_bytes,
      'status', s.status, 'extracted', s.extracted, 'suggest', s.suggest, 'error', s.error, 'model', s.model,
      'doc_id', s.doc_id, 'doc_no', d.doc_no, 'created_at', s.created_at, 'read_at', s.read_at, 'confirmed_at', s.confirmed_at,
      'scanned_by_name', coalesce(ps.full_name, pu.full_name, us.email), 'confirmed_by_name', coalesce(pc.full_name, uc.email),
      'source', s.source, 'note', s.note, 'request_title', r.title
    ) order by s.created_at desc)
    from public.acc_scans s
    left join public.acc_documents d on d.id = s.doc_id
    left join auth.users us on us.id = s.scanned_by
    left join public.accountants ps on ps.user_id = s.scanned_by
    left join public.acc_portal_users pu on pu.user_id = s.scanned_by and pu.client_id = s.client_id
    left join auth.users uc on uc.id = s.confirmed_by
    left join public.accountants pc on pc.user_id = s.confirmed_by
    left join public.acc_doc_requests r on r.id = s.request_id
    where s.client_id = c.id and (p_status is null or s.status = p_status)
  ), '[]'::jsonb);
end $$;

-- Session info (0022) + how many companies the user can open in the portal.
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
    'has_business', exists (select 1 from public.profiles p where p.id = auth.uid()),
    'portal_clients', (select count(*) from public._portal_clients())
  )
$$;

-- ---------------------------------------------------------------------
-- Portal (the client's side)
-- ---------------------------------------------------------------------
create or replace function public.portal_me()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.acc_portal_users set last_seen_at = now()
  where user_id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '10 minutes');
  return jsonb_build_object(
    'user_id', auth.uid(),
    'full_name', (select pu.full_name from public.acc_portal_users pu where pu.user_id = auth.uid() order by pu.created_at limit 1),
    'email', (select email from auth.users where id = auth.uid()),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', c.id, 'name', c.name, 'nui', c.nui, 'vat_registered', c.vat_registered,
        'office_name', o.office_name, 'office_email', coalesce(o.office_email, o.email), 'office_phone', coalesce(o.office_phone, o.phone),
        'unread', (select count(*) from public.acc_messages m where m.client_id = c.id and not m.from_client and m.read_at is null),
        'open_requests', (select count(*) from public.acc_doc_requests r where r.client_id = c.id and r.status = 'requested')
      ) order by c.name)
      from public.acc_clients c
      join public.accountants o on o.user_id = c.accountant_id
      where c.id in (select public._portal_clients())
    ), '[]'::jsonb));
end $$;

create or replace function public.portal_overview(p_client uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._portal_client(p_client);
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_year date := date_trunc('year', p_month)::date;
begin
  return jsonb_build_object(
    'month', v_from,
    'sales', (select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_e + net_d + amt_c + amt_a), 0),
                                        'vat', coalesce(sum(vat_e + vat_d), 0), 'docs', count(*))
              from public.acc_documents where client_id = c.id and kind = 'sale' and doc_date between v_from and v_to),
    'purchases', (select jsonb_build_object('gross', coalesce(sum(total), 0), 'net', coalesce(sum(net_e + net_d + amt_c + amt_a + vat_nd), 0),
                                            'vat', coalesce(sum(vat_e + vat_d), 0), 'docs', count(*))
                  from public.acc_documents where client_id = c.id and kind = 'purchase' and doc_date between v_from and v_to),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', m.mo, 'sales', m.s, 'purchases', m.p) order by m.mo), '[]'::jsonb)
               from (select gs.mo::date as mo,
                            coalesce((select sum(net_e + net_d + amt_c + amt_a) from public.acc_documents d
                                      where d.client_id = c.id and d.kind = 'sale' and date_trunc('month', d.doc_date) = gs.mo), 0) as s,
                            coalesce((select sum(net_e + net_d + amt_c + amt_a + vat_nd) from public.acc_documents d
                                      where d.client_id = c.id and d.kind = 'purchase' and date_trunc('month', d.doc_date) = gs.mo), 0) as p
                     from generate_series(v_year, v_from, interval '1 month') gs(mo)) m),
    'receivable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = c.id and b.kind = 'sale'),
    'payable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = c.id and b.kind = 'purchase'),
    'vat_return', (select jsonb_build_object('month', r.month, 'status', r.status, 'amount', coalesce((r.boxes->>'72')::numeric, 0),
                                             'credit', coalesce((r.boxes->>'71')::numeric, 0), 'filed_at', r.filed_at, 'paid_at', r.paid_at)
                   from public.acc_vat_returns r where r.client_id = c.id order by r.month desc limit 1),
    'office_open', (select coalesce(sum(i.total - i.paid), 0) from public.acc_office_invoices i where i.client_id = c.id and i.status = 'open'),
    'open_requests', (select count(*) from public.acc_doc_requests r where r.client_id = c.id and r.status = 'requested'),
    'unread', (select count(*) from public.acc_messages m where m.client_id = c.id and not m.from_client and m.read_at is null),
    'kasa_linked', c.kasa_business_id is not null and c.link_status = 'approved'
  );
end $$;

create or replace function public.portal_documents(p_client uuid, p_kind text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._portal_client(p_client);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'doc_type', d.doc_type, 'doc_no', d.doc_no, 'doc_date', d.doc_date,
                                        'due_date', d.due_date, 'partner_name', coalesce(pt.name, d.partner_name), 'description', d.description,
                                        'net', d.net_e + d.net_d + d.amt_c + d.amt_a, 'vat', d.vat_e + d.vat_d, 'total', d.total, 'open', b.open,
                                        'files', (select count(*) from public.acc_files f where f.doc_id = d.id))
                     order by d.doc_date desc, d.created_at desc)
    from public.acc_documents d
    left join public.acc_partners pt on pt.id = d.partner_id
    left join public.acc_doc_balances b on b.id = d.id
    where d.client_id = c.id and d.kind = p_kind and d.doc_date between p_from and p_to
  ), '[]'::jsonb);
end $$;

create or replace function public.portal_declarations(p_client uuid, p_year int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._portal_client(p_client);
  v_from date := make_date(p_year, 1, 1);
  v_to date := make_date(p_year, 12, 31);
begin
  return jsonb_build_object(
    'vat', (select coalesce(jsonb_agg(jsonb_build_object('month', r.month, 'status', r.status, 'amount', coalesce((r.boxes->>'72')::numeric, 0),
                                                         'credit', coalesce((r.boxes->>'71')::numeric, 0), 'filed_at', r.filed_at,
                                                         'reference', r.reference, 'paid_at', r.paid_at) order by r.month), '[]'::jsonb)
            from public.acc_vat_returns r where r.client_id = c.id and r.month between v_from and v_to),
    'payroll', (select coalesce(jsonb_agg(jsonb_build_object('month', r.month, 'status', r.status, 'filed_at', r.filed_at,
                                                             'employees', (select count(*) from public.acc_payroll_lines l where l.run_id = r.id),
                                                             'gross', (select coalesce(sum(l.gross), 0) from public.acc_payroll_lines l where l.run_id = r.id),
                                                             'net', (select coalesce(sum(l.net), 0) from public.acc_payroll_lines l where l.run_id = r.id),
                                                             'to_pay', (select coalesce(sum(l.tax + l.emp_contrib + l.er_contrib), 0) from public.acc_payroll_lines l where l.run_id = r.id))
                                          order by r.month), '[]'::jsonb)
                from public.acc_payroll_runs r where r.client_id = c.id and r.month between v_from and v_to and r.status <> 'draft'),
    'other', (select coalesce(jsonb_agg(jsonb_build_object('kind', f.kind, 'period', f.period, 'amount', f.amount, 'status', f.status,
                                                           'filed_at', f.filed_at, 'paid_at', f.paid_at, 'reference', f.reference) order by f.period), '[]'::jsonb)
              from public.acc_tax_filings f where f.client_id = c.id and f.period between v_from and v_to)
  );
end $$;

create or replace function public.portal_office_invoices(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._portal_client(p_client);
  o public.accountants;
begin
  select * into o from public.accountants where user_id = c.accountant_id;
  return jsonb_build_object(
    'office', jsonb_build_object('name', o.office_name, 'nui', o.office_nui, 'bank', o.office_bank, 'iban', o.office_iban,
                                 'address', o.office_address, 'city', o.office_city, 'email', coalesce(o.office_email, o.email), 'phone', coalesce(o.office_phone, o.phone)),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'inv_no', i.inv_no, 'issue_date', i.issue_date, 'due_date', i.due_date,
                                                              'description', i.description, 'vat_rate', i.vat_rate, 'net', i.net, 'vat', i.vat,
                                                              'total', i.total, 'paid', i.paid, 'status', i.status) order by i.issue_date desc), '[]'::jsonb)
                 from public.acc_office_invoices i where i.client_id = c.id and i.status <> 'cancelled'));
end $$;

create or replace function public.portal_requests(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._portal_client(p_client);
begin
  return jsonb_build_object(
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'period', r.period, 'due_date', r.due_date,
                                                              'status', r.status, 'note', r.note, 'created_at', r.created_at, 'received_at', r.received_at)
                                           order by (r.status <> 'requested'), r.due_date nulls last, r.created_at desc), '[]'::jsonb)
                 from public.acc_doc_requests r
                 where r.client_id = c.id and (r.status = 'requested' or r.received_at > now() - interval '60 days')),
    'uploads', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'file_name', s.file_name, 'path', s.path, 'mime', s.mime,
                                                             'status', s.status, 'created_at', s.created_at, 'note', s.note,
                                                             'request_title', r.title) order by s.created_at desc), '[]'::jsonb)
                from public.acc_scans s left join public.acc_doc_requests r on r.id = s.request_id
                where s.client_id = c.id and s.source = 'portal' and s.created_at > now() - interval '120 days')
  );
end $$;

-- p = {client_id, path, file_name, mime, size_bytes, request_id?, note?}
create or replace function public.portal_upload(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._portal_client((p->>'client_id')::uuid);
  v_path text := p->>'path';
  v_req uuid := nullif(p->>'request_id', '')::uuid;
  v_id uuid;
begin
  if v_path is null or split_part(v_path, '/', 1) <> c.id::text or v_path not like '%/portal-%' then
    raise exception 'Skedari nuk është në dosjen e kompanisë' using errcode = '22023';
  end if;
  if v_req is not null and not exists (select 1 from public.acc_doc_requests where id = v_req and client_id = c.id) then
    v_req := null;
  end if;
  insert into public.acc_scans (client_id, accountant_id, path, file_name, mime, size_bytes, scanned_by, source, request_id, note)
  values (c.id, c.accountant_id, v_path, left(coalesce(nullif(p->>'file_name', ''), 'dokument'), 200), left(p->>'mime', 100),
          (p->>'size_bytes')::bigint, auth.uid(), 'portal', v_req, nullif(left(trim(p->>'note'), 500), ''))
  returning id into v_id;
  if v_req is not null then
    update public.acc_doc_requests set status = 'received', received_at = now() where id = v_req and status = 'requested';
  end if;
  return v_id;
end $$;

create or replace function public.portal_messages(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._portal_client(p_client);
begin
  update public.acc_messages set read_at = now() where client_id = c.id and not from_client and read_at is null;
  return coalesce((
    select jsonb_agg(x order by x.id)
    from (
      select m.id, m.from_client, m.body, m.created_at, m.read_at,
             case when m.from_client then coalesce(pu.full_name, u.email) else coalesce(a.full_name, 'Zyra') end as sender_name
      from public.acc_messages m
      left join public.accountants a on a.user_id = m.sender_id
      left join public.acc_portal_users pu on pu.user_id = m.sender_id and pu.client_id = m.client_id
      left join auth.users u on u.id = m.sender_id
      where m.client_id = c.id
      order by m.id desc
      limit 300
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.portal_send(p_client uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._portal_client(p_client);
begin
  if coalesce(trim(p_body), '') = '' then raise exception 'Shkruaj mesazhin' using errcode = '22023'; end if;
  insert into public.acc_messages (office_id, client_id, sender_id, from_client, body)
  values (c.accountant_id, c.id, auth.uid(), true, left(trim(p_body), 4000));
end $$;

revoke execute on function public._portal_client(uuid) from public, anon, authenticated;
revoke execute on function public._portal_clients() from public, anon;
grant execute on function public._portal_clients() to authenticated;   -- used by RLS / storage policies
revoke execute on function public.acc_portal_users_list(uuid), public.acc_portal_user_set(uuid, boolean), public.acc_messages_list(uuid),
  public.acc_message_send(uuid, text), public.acc_portal_inbox(), public.portal_me(), public.portal_overview(uuid, date),
  public.portal_documents(uuid, text, date, date), public.portal_declarations(uuid, int), public.portal_office_invoices(uuid),
  public.portal_requests(uuid), public.portal_upload(jsonb), public.portal_messages(uuid), public.portal_send(uuid, text) from public, anon;
grant execute on function public.acc_portal_users_list(uuid), public.acc_portal_user_set(uuid, boolean), public.acc_messages_list(uuid),
  public.acc_message_send(uuid, text), public.acc_portal_inbox(), public.portal_me(), public.portal_overview(uuid, date),
  public.portal_documents(uuid, text, date, date), public.portal_declarations(uuid, int), public.portal_office_invoices(uuid),
  public.portal_requests(uuid), public.portal_upload(jsonb), public.portal_messages(uuid), public.portal_send(uuid, text),
  public.acc_work_summary(), public.acc_scans_list(uuid, text), public.acc_me() to authenticated;
