-- =====================================================================
-- 0025 – Kasa Kontabilist, phase K8 (part 1): archive, backup, security, office logo.
--
-- * Archive: acc_files get a category (invoice, contract, declaration, bank, payroll, correspondence, other),
--   a title, the period it belongs to, a note and "shared" (the client sees it in the portal).
--   Files can be added without an invoice; search over all clients by name, number, partner, note.
-- * Backup: acc_client_backup(client) returns every row of a client (books, payroll, files' list, office work)
--   as one JSON; the program saves it per client or for the whole office.
-- * Security: sign-ins are written to the history (acc_log_login, once per session); active sessions of the
--   office (device, IP, last use) with sign-out of a session; deleting a company only by an office admin.
-- * Office logo (small image, data URL) for the office's invoices, the program and the portal.
-- Nothing existing changes shape.
-- =====================================================================

alter table public.acc_files add column if not exists category text not null default 'invoice';
do $$ begin
  alter table public.acc_files add constraint acc_files_category_check
    check (category in ('invoice', 'contract', 'declaration', 'bank', 'payroll', 'correspondence', 'other'));
exception when duplicate_object then null; end $$;
alter table public.acc_files add column if not exists title text;
alter table public.acc_files add column if not exists period date;
alter table public.acc_files add column if not exists note text;
alter table public.acc_files add column if not exists shared boolean not null default false;
create index if not exists acc_files_client_idx on public.acc_files (client_id, created_at desc);

alter table public.accountants add column if not exists office_logo text;
do $$ begin
  alter table public.accountants add constraint accountants_logo_check
    check (office_logo is null or (office_logo like 'data:image/%' and length(office_logo) <= 300000));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Archive
-- ---------------------------------------------------------------------
-- New file (p.path already uploaded to the client folder) or new details of an existing one (p.id).
-- p = {id?, client_id, path?, file_name?, mime?, size_bytes?, doc_id?, category?, title?, period?, note?, shared?}
create or replace function public.acc_archive_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  c public.acc_clients;
  f public.acc_files;
  v_cat text := coalesce(nullif(p->>'category', ''), 'other');
begin
  if v_cat not in ('invoice', 'contract', 'declaration', 'bank', 'payroll', 'correspondence', 'other') then
    raise exception 'Kategoria nuk vlen' using errcode = '22023';
  end if;
  if v_id is not null then
    select * into f from public.acc_files where id = v_id;
    if not found then raise exception 'Skedari nuk u gjet' using errcode = 'P0002'; end if;
    perform public._own_client(f.client_id);
    update public.acc_files
       set category = v_cat, title = nullif(trim(p->>'title'), ''), period = nullif(p->>'period', '')::date,
           note = nullif(trim(p->>'note'), ''), shared = coalesce((p->>'shared')::boolean, shared)
     where id = v_id;
    return v_id;
  end if;
  c := public._own_client((p->>'client_id')::uuid);
  if coalesce(p->>'path', '') = '' or split_part(p->>'path', '/', 1) <> c.id::text then
    raise exception 'Skedari nuk është në dosjen e klientit' using errcode = '22023';
  end if;
  if nullif(p->>'doc_id', '') is not null and not exists (select 1 from public.acc_documents where id = (p->>'doc_id')::uuid and client_id = c.id) then
    raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
  end if;
  insert into public.acc_files (client_id, doc_id, path, file_name, mime, size_bytes, uploaded_by, category, title, period, note, shared)
  values (c.id, nullif(p->>'doc_id', '')::uuid, p->>'path', left(coalesce(nullif(p->>'file_name', ''), 'skedar'), 200), left(p->>'mime', 100),
          (p->>'size_bytes')::bigint, auth.uid(), v_cat, nullif(trim(p->>'title'), ''), nullif(p->>'period', '')::date,
          nullif(trim(p->>'note'), ''), coalesce((p->>'shared')::boolean, false))
  returning id into v_id;
  return v_id;
end $$;

-- All files of the office (or of one client), newest period first.
create or replace function public.acc_archive_list(p_client uuid default null, p_category text default null, p_year int default null, p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if p_client is not null then perform public._own_client(p_client); end if;
  return coalesce((
    select jsonb_agg(x order by x.sort_date desc, x.created_at desc)
    from (
      select f.id, f.client_id, c.name as client_name, f.doc_id, f.path, f.file_name, f.mime, f.size_bytes, f.created_at,
             f.category, f.title, f.period, f.note, f.shared,
             d.doc_no, d.doc_date, d.kind as doc_kind, coalesce(pt.name, d.partner_name) as partner_name,
             coalesce(f.period, d.doc_date, f.created_at::date) as sort_date,
             coalesce(a.full_name, pu.full_name, u.email) as uploaded_by_name
      from public.acc_files f
      join public.acc_clients c on c.id = f.client_id
      left join public.acc_documents d on d.id = f.doc_id
      left join public.acc_partners pt on pt.id = d.partner_id
      left join public.accountants a on a.user_id = f.uploaded_by
      left join public.acc_portal_users pu on pu.user_id = f.uploaded_by and pu.client_id = f.client_id
      left join auth.users u on u.id = f.uploaded_by
      where c.accountant_id = v_office and public._acc_client_visible(c.id)
        and (p_client is null or f.client_id = p_client)
        and (p_category is null or f.category = p_category)
        and (p_year is null or extract(year from coalesce(f.period, d.doc_date, f.created_at::date)) = p_year)
        and (v_q is null or concat_ws(' ', f.file_name, f.title, f.note, d.doc_no, d.partner_name, pt.name, c.name) ilike '%' || v_q || '%')
      order by coalesce(f.period, d.doc_date, f.created_at::date) desc, f.created_at desc
      limit 500
    ) x
  ), '[]'::jsonb);
end $$;

-- Deleting a file: only a member who sees the client (0022); returns the path for the storage.
create or replace function public.acc_delete_file(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.acc_files;
begin
  select * into f from public.acc_files where id = p_id;
  if not found then raise exception 'Skedari nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(f.client_id);
  delete from public.acc_files where id = p_id;
  return f.path;
end $$;

-- Files the office shared with the client (portal).
create or replace function public.portal_files(p_client uuid)
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
    select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'file_name', f.file_name, 'mime', f.mime, 'category', f.category,
                                        'title', f.title, 'period', f.period, 'note', f.note, 'created_at', f.created_at)
                     order by coalesce(f.period, f.created_at::date) desc)
    from public.acc_files f where f.client_id = c.id and f.shared
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Backup of one client (everything the office keeps for it)
-- ---------------------------------------------------------------------
create or replace function public.acc_client_backup(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if public._acc_role() = 'assistant' then
    raise exception 'Backup-in e shkarkon kontabilisti ose administratori' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'format', 'kasa-kontabilist-backup', 'version', 1, 'created_at', now(),
    'client', to_jsonb(c) - 'accountant_id',
    'partners', (select coalesce(jsonb_agg(to_jsonb(x) - 'accountant_id'), '[]'::jsonb) from public.acc_partners x where x.client_id = c.id),
    'documents', (select coalesce(jsonb_agg(to_jsonb(x) - 'accountant_id' order by x.doc_date), '[]'::jsonb) from public.acc_documents x where x.client_id = c.id),
    'document_lines', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.acc_document_lines l join public.acc_documents d on d.id = l.doc_id where d.client_id = c.id),
    'payments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_payments x where x.client_id = c.id),
    'money_accounts', (select coalesce(jsonb_agg(to_jsonb(x) - 'accountant_id'), '[]'::jsonb) from public.acc_money_accounts x where x.client_id = c.id),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_transactions x where x.client_id = c.id),
    'bank_lines', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_bank_lines x where x.client_id = c.id),
    'loans', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_loans x where x.client_id = c.id),
    'periods', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_periods x where x.client_id = c.id),
    'vat_returns', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_vat_returns x where x.client_id = c.id),
    'tax_filings', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_tax_filings x where x.client_id = c.id),
    'chart_of_accounts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_coa x where x.client_id = c.id),
    'journal_entries', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_journal_entries x where x.client_id = c.id),
    'journal_lines', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.acc_journal_lines l join public.acc_journal_entries e on e.id = l.entry_id where e.client_id = c.id),
    'assets', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_assets x where x.client_id = c.id),
    'employees', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_employees x where x.client_id = c.id),
    'leaves', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_leaves x where x.client_id = c.id),
    'payroll_runs', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_payroll_runs x where x.client_id = c.id),
    'payroll_lines', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.acc_payroll_lines l join public.acc_payroll_runs r on r.id = l.run_id where r.client_id = c.id),
    'files', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.acc_files x where x.client_id = c.id),
    'scans', (select coalesce(jsonb_agg(to_jsonb(x) - 'accountant_id'), '[]'::jsonb) from public.acc_scans x where x.client_id = c.id),
    'contract', (select to_jsonb(x) - 'office_id' from public.acc_contracts x where x.client_id = c.id),
    'office_invoices', case when public._acc_role() = 'admin' then
                         (select coalesce(jsonb_agg(to_jsonb(x) - 'office_id'), '[]'::jsonb) from public.acc_office_invoices x where x.client_id = c.id) end,
    'tasks', (select coalesce(jsonb_agg(to_jsonb(x) - 'office_id'), '[]'::jsonb) from public.acc_tasks x where x.client_id = c.id),
    'doc_requests', (select coalesce(jsonb_agg(to_jsonb(x) - 'office_id'), '[]'::jsonb) from public.acc_doc_requests x where x.client_id = c.id),
    'notes', (select coalesce(jsonb_agg(to_jsonb(x) - 'office_id'), '[]'::jsonb) from public.acc_client_notes x where x.client_id = c.id),
    'messages', (select coalesce(jsonb_agg(to_jsonb(x) - 'office_id' order by x.id), '[]'::jsonb) from public.acc_messages x where x.client_id = c.id)
  );
end $$;

-- ---------------------------------------------------------------------
-- Sign-ins and sessions
-- ---------------------------------------------------------------------
-- Called by the program once a session is open; written once per session.
create or replace function public.acc_log_login(p_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._office_id();
  v_session text := auth.jwt() ->> 'session_id';
begin
  if v_office is null or not public.is_accountant() then return; end if;
  if exists (select 1 from public.acc_activity where office_id = v_office and user_id = auth.uid() and entity = 'login'
             and entity_id is not distinct from v_session) then
    return;
  end if;
  insert into public.acc_activity (office_id, user_id, entity, entity_id, action, label)
  values (v_office, auth.uid(), 'login', v_session, 'insert', left(coalesce(p_agent, 'hyrje'), 200));
end $$;

-- Open sessions: an admin sees the whole office, the others their own.
create or replace function public.acc_sessions_list()
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
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'user_id', s.user_id, 'user_name', a.full_name, 'created_at', s.created_at,
      'last_used', greatest(s.updated_at, s.refreshed_at::timestamptz), 'user_agent', s.user_agent, 'ip', host(s.ip),
      'aal', s.aal::text, 'current', s.id::text = (auth.jwt() ->> 'session_id')
    ) order by greatest(s.updated_at, s.refreshed_at::timestamptz) desc nulls last)
    from auth.sessions s
    join public.accountants a on a.user_id = s.user_id
    where coalesce(a.office_id, a.user_id) = v_office
      and (v_admin or s.user_id = auth.uid())
      and (s.not_after is null or s.not_after > now())
  ), '[]'::jsonb);
end $$;

-- Ends a session (its refresh token stops working; the open page is signed out within the hour at most).
create or replace function public.acc_session_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  v_user uuid;
begin
  select s.user_id into v_user
  from auth.sessions s join public.accountants a on a.user_id = s.user_id
  where s.id = p_id and coalesce(a.office_id, a.user_id) = v_office;
  if v_user is null then raise exception 'Seanca nuk u gjet' using errcode = 'P0002'; end if;
  if v_user <> auth.uid() and public._acc_role() <> 'admin' then
    raise exception 'Vetëm administratori i zyrës' using errcode = '42501';
  end if;
  delete from auth.sessions where id = p_id;
  insert into public.acc_activity (office_id, user_id, entity, entity_id, action, label)
  values (v_office, auth.uid(), 'session', p_id::text, 'delete',
          'Seanca u mbyll' || case when v_user <> auth.uid() then ' për ' || coalesce((select full_name from public.accountants where user_id = v_user), '') else '' end);
end $$;

-- ---------------------------------------------------------------------
-- Roles (0022): deleting a company only by an office admin; an assistant creates none.
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
  if v_role is null then return coalesce(new, old); end if;

  if tg_table_name = 'acc_clients' then
    v_block := (tg_op = 'DELETE' and v_role <> 'admin') or (tg_op = 'INSERT' and v_role = 'assistant');
    if v_block then
      raise exception '%', case when tg_op = 'DELETE' then 'Kompaninë e fshin vetëm administratori i zyrës' else 'Ky veprim kërkon kontabilistin ose administratorin e zyrës' end
        using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if v_role <> 'assistant' then return coalesce(new, old); end if;

  if tg_table_name = 'acc_periods' then
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

-- ---------------------------------------------------------------------
-- Office profile (0023) + logo
-- ---------------------------------------------------------------------
create or replace function public.acc_office_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._require_accountant();
  o public.accountants;
begin
  select * into o from public.accountants where user_id = v_office;
  return jsonb_build_object('office_name', o.office_name, 'nui', o.office_nui, 'vat_no', o.office_vat_no, 'address', o.office_address,
                            'city', o.office_city, 'email', o.office_email, 'phone', o.office_phone, 'bank', o.office_bank, 'iban', o.office_iban,
                            'logo', o.office_logo);
end $$;

create or replace function public.acc_office_profile_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
begin
  update public.accountants
     set office_name    = case when p ? 'office_name' then nullif(trim(p->>'office_name'), '') else office_name end,
         office_nui     = case when p ? 'nui' then nullif(regexp_replace(p->>'nui', '\D', '', 'g'), '') else office_nui end,
         office_vat_no  = case when p ? 'vat_no' then nullif(trim(p->>'vat_no'), '') else office_vat_no end,
         office_address = case when p ? 'address' then nullif(trim(p->>'address'), '') else office_address end,
         office_city    = case when p ? 'city' then nullif(trim(p->>'city'), '') else office_city end,
         office_email   = case when p ? 'email' then nullif(trim(p->>'email'), '') else office_email end,
         office_phone   = case when p ? 'phone' then nullif(trim(p->>'phone'), '') else office_phone end,
         office_bank    = case when p ? 'bank' then nullif(trim(p->>'bank'), '') else office_bank end,
         office_iban    = case when p ? 'iban' then nullif(upper(regexp_replace(p->>'iban', '\s', '', 'g')), '') else office_iban end,
         office_logo    = case when p ? 'logo' then nullif(p->>'logo', '') else office_logo end
   where user_id = v_office;
end $$;

-- The portal (0024) shows the office logo next to the company.
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
        'office_logo', o.office_logo,
        'unread', (select count(*) from public.acc_messages m where m.client_id = c.id and not m.from_client and m.read_at is null),
        'open_requests', (select count(*) from public.acc_doc_requests r where r.client_id = c.id and r.status = 'requested'),
        'shared_files', (select count(*) from public.acc_files f where f.client_id = c.id and f.shared)
      ) order by c.name)
      from public.acc_clients c
      join public.accountants o on o.user_id = c.accountant_id
      where c.id in (select public._portal_clients())
    ), '[]'::jsonb));
end $$;

revoke execute on function public.acc_archive_save(jsonb), public.acc_archive_list(uuid, text, int, text), public.portal_files(uuid),
  public.acc_client_backup(uuid), public.acc_log_login(text), public.acc_sessions_list(), public.acc_session_revoke(uuid) from public, anon;
grant execute on function public.acc_archive_save(jsonb), public.acc_archive_list(uuid, text, int, text), public.portal_files(uuid),
  public.acc_client_backup(uuid), public.acc_log_login(text), public.acc_sessions_list(), public.acc_session_revoke(uuid),
  public.acc_delete_file(uuid), public.acc_office_profile(), public.acc_office_profile_save(jsonb), public.portal_me() to authenticated;
revoke execute on function public._acc_role_guard() from public, anon, authenticated;
