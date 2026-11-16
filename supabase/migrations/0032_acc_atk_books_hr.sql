-- =====================================================================
-- 0032 – Kasa Kontabilist: AI scanning in four kinds, ATK item categories, books for the whole period,
--        and a fuller human-resources module.
--
-- * acc_scans.scan_kind: purchase / expense / investment / sale. For a sale the document was issued by
--   the client: the Edge Function puts the customer in the supplier_* fields (= the other party), so the
--   suggestions (partner, duplicate, "not this client") work the same way for all four.
-- * ATK categories ("Kategoritë e mallrave dhe shërbimeve") and units ("Njësitë matëse"): fixed official lists
--   in the program (src/lib/atk/catalog.ts).
--   acc_documents.atk_category (main category of the document) and acc_document_lines.category_code;
--   acc_items.category already holds the item category (now the ATK code).
-- * acc_vat_book_range(client, from, to): every sale / purchase of a period with what the official books need.
-- * HR: more on acc_employees (personal and job data, schedule, leave entitlement), more leave kinds with the
--   decision number, attendance (acc_attendance) and the history of changes (acc_employee_history, by trigger).
-- * Kasa products: the ATK category (products.atk_type, sent as CouponItem.Type) is set by itself from the business
--   type when a product has none / the old "TT" – market AU, restaurant UR, pharmacy BM, salon SHZ, boutique TT.
-- Nothing the live program uses changes shape; old calls keep working.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Scanning in four kinds
-- ---------------------------------------------------------------------
alter table public.acc_scans add column if not exists scan_kind text not null default 'purchase';
do $$ begin
  alter table public.acc_scans add constraint acc_scans_kind_check check (scan_kind in ('purchase', 'expense', 'investment', 'sale'));
exception when duplicate_object then null; end $$;

create or replace function public.acc_scan_add(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_path text := p->>'path';
  v_kind text := coalesce(nullif(p->>'kind', ''), 'purchase');
  v_id uuid;
begin
  if v_path is null or split_part(v_path, '/', 1) <> c.id::text then
    raise exception 'Skedari nuk është në dosjen e klientit' using errcode = '22023';
  end if;
  if v_kind not in ('purchase', 'expense', 'investment', 'sale') then
    raise exception 'Lloji i skanimit nuk njihet' using errcode = '22023';
  end if;
  insert into public.acc_scans (client_id, accountant_id, path, file_name, mime, size_bytes, scanned_by, scan_kind)
  values (c.id, c.accountant_id, v_path, left(coalesce(nullif(p->>'file_name', ''), 'skanim'), 200), left(p->>'mime', 100),
          (p->>'size_bytes')::bigint, auth.uid(), v_kind)
  returning id into v_id;
  return v_id;
end $$;

-- The kind of a scan can be changed before it is confirmed (a purchase scanned as an expense, …).
create or replace function public.acc_scan_set_kind(p_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('purchase', 'expense', 'investment', 'sale') then
    raise exception 'Lloji i skanimit nuk njihet' using errcode = '22023';
  end if;
  update public.acc_scans set scan_kind = p_kind
  where id = p_id and accountant_id = public._require_accountant() and status <> 'confirmed';
  if not found then raise exception 'Skanimi nuk u gjet' using errcode = 'P0002'; end if;
end $$;

create or replace function public.acc_scan_result(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.acc_scans;
  c public.acc_clients;
  x jsonb := p->'extracted';
  v_doc_kind text;
  v_nui text;
  v_name text;
  v_no text;
  v_partner public.acc_partners;
  v_cat text;
  v_atk text;
  v_dup record;
  v_suggest jsonb;
begin
  select * into s from public.acc_scans where id = p_id and accountant_id = public._require_accountant();
  if not found then raise exception 'Skanimi nuk u gjet' using errcode = 'P0002'; end if;
  if s.status = 'confirmed' then raise exception 'Skanimi është konfirmuar tashmë' using errcode = '22023'; end if;
  c := public._own_client(s.client_id);
  v_doc_kind := case when s.scan_kind = 'sale' then 'sale' else 'purchase' end;

  if x is null or jsonb_typeof(x) <> 'object' then
    update public.acc_scans set status = 'failed', error = left(coalesce(p->>'error', 'Fatura nuk u lexua'), 500),
           model = coalesce(p->>'model', model), read_at = now()
    where id = s.id;
    return jsonb_build_object('status', 'failed');
  end if;

  -- supplier_* = the other party (the customer when the client issued the document)
  v_nui := nullif(regexp_replace(coalesce(x->>'supplier_nui', ''), '\D', '', 'g'), '');
  v_name := nullif(trim(coalesce(x->>'supplier_name', '')), '');
  v_no := nullif(trim(coalesce(x->>'doc_no', '')), '');

  if v_nui is not null then
    select * into v_partner from public.acc_partners where client_id = c.id and nui = v_nui limit 1;
  end if;
  if v_partner.id is null and v_name is not null then
    select * into v_partner from public.acc_partners where client_id = c.id and lower(name) = lower(v_name) order by active desc limit 1;
  end if;

  -- category and ATK category this client last used for the partner
  select d.category, d.atk_category into v_cat, v_atk
  from public.acc_documents d
  where d.client_id = c.id and d.kind = v_doc_kind
    and ((v_partner.id is not null and d.partner_id = v_partner.id) or (v_nui is not null and d.partner_nui = v_nui))
  order by d.doc_date desc, d.created_at desc
  limit 1;

  if v_no is not null then
    select d.id, d.doc_no, d.doc_date into v_dup
    from public.acc_documents d
    where d.client_id = c.id and d.kind = v_doc_kind and lower(trim(d.doc_no)) = lower(v_no)
      and ((v_partner.id is not null and d.partner_id = v_partner.id) or (v_nui is not null and d.partner_nui = v_nui)
           or (v_nui is null and v_partner.id is null and lower(d.partner_name) = lower(v_name)))
    limit 1;
  end if;

  v_suggest := jsonb_strip_nulls(jsonb_build_object(
    'partner_id', v_partner.id, 'partner_name', v_partner.name, 'category', v_cat, 'atk_category', v_atk,
    'duplicate_doc_id', v_dup.id, 'duplicate_doc_no', v_dup.doc_no, 'duplicate_doc_date', v_dup.doc_date,
    -- buyer_* = the client's side (the issuer for a sale): flag when it is another business
    'buyer_mismatch', case when nullif(regexp_replace(coalesce(x->>'buyer_nui', ''), '\D', '', 'g'), '') is not null
                            and c.nui is not null
                            and regexp_replace(x->>'buyer_nui', '\D', '', 'g') <> c.nui then true end));

  update public.acc_scans set status = 'read', extracted = x, suggest = v_suggest, error = null,
         model = coalesce(p->>'model', model), read_at = now()
  where id = s.id;
  return jsonb_build_object('status', 'read', 'suggest', v_suggest);
end $$;

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
      'source', s.source, 'note', s.note, 'request_title', r.title, 'scan_kind', s.scan_kind
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

-- ---------------------------------------------------------------------
-- 2. ATK categories and units
-- ---------------------------------------------------------------------
alter table public.acc_documents add column if not exists atk_category text;
alter table public.acc_document_lines add column if not exists category_code text;
create index if not exists acc_documents_atk_idx on public.acc_documents (client_id, atk_category) where atk_category is not null;

-- After acc_save_invoice: the document's ATK category and one per line (by position).
create or replace function public.acc_set_atk_categories(p_doc uuid, p_category text, p_lines jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
begin
  select * into d from public.acc_documents where id = p_doc and accountant_id = public._require_accountant();
  if not found then raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002'; end if;
  perform public._own_client(d.client_id);
  update public.acc_documents set atk_category = nullif(left(trim(coalesce(p_category, '')), 12), '') where id = d.id;
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    update public.acc_document_lines l set category_code = nullif(left(trim(coalesce(x->>'code', '')), 12), '')
    from jsonb_array_elements(p_lines) x
    where l.doc_id = d.id and l.position = (x->>'position')::int;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Books for a period (several months)
-- ---------------------------------------------------------------------
create or replace function public.acc_vat_book_range(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
begin
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Zgjidh një periudhë deri në një vit' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'kind', d.kind, 'date', d.doc_date, 'doc_no', d.doc_no, 'partner', coalesce(d.partner_name, p.name, ''),
      'nui', coalesce(nullif(d.partner_nui, ''), p.nui, p.fiscal_number, ''), 'vat_no', coalesce(nullif(d.partner_vat, ''), p.vat_number, ''),
      'doc_type', d.doc_type, 'vat_flag', d.vat_flag, 'category', d.category, 'atk_category', d.atk_category,
      'asset', d.category = 'assets', 'export', d.export,
      'net_e', d.net_e, 'vat_e', d.vat_e, 'net_d', d.net_d, 'vat_d', d.vat_d, 'amt_c', d.amt_c, 'amt_a', d.amt_a,
      'vat_nd', d.vat_nd, 'total', d.total
    ) order by d.doc_date, d.doc_no), '[]'::jsonb)
    from public.acc_documents d
    left join public.acc_partners p on p.id = d.partner_id
    where d.client_id = c.id and d.kind in ('sale', 'purchase') and d.doc_date between p_from and p_to
  );
end $$;

-- ---------------------------------------------------------------------
-- 4. Human resources
-- ---------------------------------------------------------------------
alter table public.acc_employees add column if not exists birth_date date;
alter table public.acc_employees add column if not exists gender text check (gender is null or gender in ('F', 'M'));
alter table public.acc_employees add column if not exists address text;
alter table public.acc_employees add column if not exists city text;
alter table public.acc_employees add column if not exists profession text;
alter table public.acc_employees add column if not exists education text;
alter table public.acc_employees add column if not exists bank_name text;
alter table public.acc_employees add column if not exists duties text;
alter table public.acc_employees add column if not exists workplace text;
alter table public.acc_employees add column if not exists contract_no text;
alter table public.acc_employees add column if not exists work_days smallint not null default 5 check (work_days in (5, 6));
alter table public.acc_employees add column if not exists weekly_hours numeric(4, 1) not null default 40 check (weekly_hours > 0 and weekly_hours <= 60);
alter table public.acc_employees add column if not exists schedule_from time;
alter table public.acc_employees add column if not exists schedule_to time;
alter table public.acc_employees add column if not exists probation_months smallint check (probation_months is null or probation_months between 0 and 6);
alter table public.acc_employees add column if not exists annual_leave_days numeric(4, 1) check (annual_leave_days is null or annual_leave_days between 0 and 60);
alter table public.acc_employees add column if not exists extra_leave_days numeric(4, 1) not null default 0 check (extra_leave_days between 0 and 30);
alter table public.acc_employees add column if not exists carried_leave_days numeric(4, 1) not null default 0 check (carried_leave_days between 0 and 60);

alter table public.acc_leaves drop constraint if exists acc_leaves_kind_check;
alter table public.acc_leaves add constraint acc_leaves_kind_check
  check (kind in ('annual', 'sick', 'sick_work', 'unpaid', 'maternity', 'paternity', 'special', 'other'));
alter table public.acc_leaves add column if not exists decision_no text;
alter table public.acc_leaves add column if not exists decision_date date;

create table if not exists public.acc_attendance (
  employee_id uuid not null references public.acc_employees (id) on delete cascade,
  client_id   uuid not null references public.acc_clients (id) on delete cascade,
  day         date not null,
  status      text not null check (status in ('present', 'absent', 'late', 'leave', 'sick', 'holiday', 'off')),
  hours       numeric(4, 1) check (hours is null or hours between 0 and 24),
  note        text,
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (employee_id, day)
);
create index if not exists acc_attendance_client_idx on public.acc_attendance (client_id, day);

create table if not exists public.acc_employee_history (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.acc_employees (id) on delete cascade,
  client_id   uuid not null references public.acc_clients (id) on delete cascade,
  change_date date not null default (now() at time zone 'Europe/Belgrade')::date,
  kind        text not null,       -- start, position, salary, contract, schedule, end, active, note
  old_value   text,
  new_value   text,
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists acc_employee_history_idx on public.acc_employee_history (employee_id, change_date desc, created_at desc);

alter table public.acc_attendance enable row level security;
alter table public.acc_employee_history enable row level security;
drop policy if exists acc_attendance_own on public.acc_attendance;
create policy acc_attendance_own on public.acc_attendance for select to authenticated
  using (public._acc_client_visible(client_id));
drop policy if exists acc_employee_history_own on public.acc_employee_history;
create policy acc_employee_history_own on public.acc_employee_history for select to authenticated
  using (public._acc_client_visible(client_id));
revoke all on public.acc_attendance, public.acc_employee_history from anon, authenticated;
grant select on public.acc_attendance, public.acc_employee_history to authenticated;

-- History of the employment relation, written by itself on every save.
create or replace function public._acc_employee_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Belgrade')::date;
  r record;
begin
  if tg_op = 'INSERT' then
    insert into public.acc_employee_history (employee_id, client_id, change_date, kind, new_value, created_by)
    values (new.id, new.client_id, new.start_date, 'start',
            concat_ws(' · ', new.position, new.contract, to_char(new.gross_salary, 'FM999999990.00') || ' €'), auth.uid());
    return new;
  end if;
  for r in
    select * from (values
      ('position', old.position, new.position),
      ('salary', to_char(old.gross_salary, 'FM999999990.00'), to_char(new.gross_salary, 'FM999999990.00')),
      ('contract', old.contract, new.contract),
      ('schedule', concat_ws(' ', old.weekly_hours::text, old.work_days::text, old.schedule_from::text, old.schedule_to::text),
                   concat_ws(' ', new.weekly_hours::text, new.work_days::text, new.schedule_from::text, new.schedule_to::text)),
      ('start', old.start_date::text, new.start_date::text),
      ('end', old.end_date::text, new.end_date::text),
      ('active', old.active::text, new.active::text)
    ) t(kind, o, n)
  loop
    if r.o is distinct from r.n then
      insert into public.acc_employee_history (employee_id, client_id, change_date, kind, old_value, new_value, created_by)
      values (new.id, new.client_id,
              case when r.kind = 'end' and new.end_date is not null then new.end_date else v_today end,
              r.kind, r.o, r.n, auth.uid());
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists acc_employees_history on public.acc_employees;
create trigger acc_employees_history after insert or update on public.acc_employees
  for each row execute function public._acc_employee_history();

create or replace function public.acc_save_employee(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_pno text := nullif(regexp_replace(coalesce(p->>'personal_no', ''), '\s', '', 'g'), '');
  e public.acc_employees;
  t text;
begin
  if trim(coalesce(p->>'first_name', '')) = '' or trim(coalesce(p->>'last_name', '')) = '' then
    raise exception 'Shkruaj emrin dhe mbiemrin' using errcode = '22023';
  end if;
  if v_pno is not null and v_pno !~ '^[0-9]{10}$' then
    raise exception 'Numri personal ka 10 shifra' using errcode = '22023';
  end if;
  if v_pno is not null and exists (select 1 from public.acc_employees where client_id = c.id and personal_no = v_pno and id is distinct from v_id) then
    raise exception 'Një punëtor tjetër i kësaj kompanie e ka këtë numër personal' using errcode = '23505';
  end if;
  if nullif(p->>'end_date', '') is not null and (p->>'end_date')::date < (p->>'start_date')::date then
    raise exception 'Data e përfundimit është para datës së fillimit' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.acc_employees (client_id, first_name, last_name, personal_no, position, start_date, end_date, contract, primary_job,
                                      gross_salary, emp_pension_pct, er_pension_pct, iban, email, phone, note)
    values (c.id, left(trim(p->>'first_name'), 60), left(trim(p->>'last_name'), 60), v_pno, nullif(trim(coalesce(p->>'position', '')), ''),
            (p->>'start_date')::date, nullif(p->>'end_date', '')::date, coalesce(nullif(p->>'contract', ''), 'indefinite'),
            coalesce((p->>'primary_job')::boolean, true), round(coalesce((p->>'gross_salary')::numeric, 0), 2),
            coalesce((p->>'emp_pension_pct')::numeric, 5), coalesce((p->>'er_pension_pct')::numeric, 5),
            nullif(upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g')), ''), nullif(trim(coalesce(p->>'email', '')), ''),
            nullif(trim(coalesce(p->>'phone', '')), ''), nullif(trim(coalesce(p->>'note', '')), ''))
    returning id into v_id;
  else
    update public.acc_employees set
      first_name = left(trim(p->>'first_name'), 60), last_name = left(trim(p->>'last_name'), 60), personal_no = v_pno,
      position = nullif(trim(coalesce(p->>'position', '')), ''), start_date = (p->>'start_date')::date, end_date = nullif(p->>'end_date', '')::date,
      contract = coalesce(nullif(p->>'contract', ''), contract), primary_job = coalesce((p->>'primary_job')::boolean, primary_job),
      gross_salary = round(coalesce((p->>'gross_salary')::numeric, gross_salary), 2),
      emp_pension_pct = coalesce((p->>'emp_pension_pct')::numeric, emp_pension_pct), er_pension_pct = coalesce((p->>'er_pension_pct')::numeric, er_pension_pct),
      iban = nullif(upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g')), ''), email = nullif(trim(coalesce(p->>'email', '')), ''),
      phone = nullif(trim(coalesce(p->>'phone', '')), ''), note = nullif(trim(coalesce(p->>'note', '')), ''),
      active = coalesce((p->>'active')::boolean, active)
    where id = v_id and client_id = c.id;
    if not found then
      raise exception 'Punëtori nuk u gjet' using errcode = 'P0002';
    end if;
  end if;

  -- HR fields: only those sent are changed (the payroll screen sends none of them)
  select * into e from public.acc_employees where id = v_id;
  update public.acc_employees set
    birth_date = case when p ? 'birth_date' then nullif(p->>'birth_date', '')::date else birth_date end,
    gender = case when p ? 'gender' then nullif(p->>'gender', '') else gender end,
    address = case when p ? 'address' then nullif(trim(coalesce(p->>'address', '')), '') else address end,
    city = case when p ? 'city' then nullif(trim(coalesce(p->>'city', '')), '') else city end,
    profession = case when p ? 'profession' then nullif(trim(coalesce(p->>'profession', '')), '') else profession end,
    education = case when p ? 'education' then nullif(trim(coalesce(p->>'education', '')), '') else education end,
    bank_name = case when p ? 'bank_name' then nullif(trim(coalesce(p->>'bank_name', '')), '') else bank_name end,
    duties = case when p ? 'duties' then nullif(trim(coalesce(p->>'duties', '')), '') else duties end,
    workplace = case when p ? 'workplace' then nullif(trim(coalesce(p->>'workplace', '')), '') else workplace end,
    contract_no = case when p ? 'contract_no' then nullif(trim(coalesce(p->>'contract_no', '')), '') else contract_no end,
    work_days = case when p ? 'work_days' then coalesce((p->>'work_days')::smallint, 5) else work_days end,
    weekly_hours = case when p ? 'weekly_hours' then coalesce((p->>'weekly_hours')::numeric, 40) else weekly_hours end,
    schedule_from = case when p ? 'schedule_from' then nullif(p->>'schedule_from', '')::time else schedule_from end,
    schedule_to = case when p ? 'schedule_to' then nullif(p->>'schedule_to', '')::time else schedule_to end,
    probation_months = case when p ? 'probation_months' then nullif(p->>'probation_months', '')::smallint else probation_months end,
    annual_leave_days = case when p ? 'annual_leave_days' then nullif(p->>'annual_leave_days', '')::numeric else annual_leave_days end,
    extra_leave_days = case when p ? 'extra_leave_days' then coalesce(nullif(p->>'extra_leave_days', '')::numeric, 0) else extra_leave_days end,
    carried_leave_days = case when p ? 'carried_leave_days' then coalesce(nullif(p->>'carried_leave_days', '')::numeric, 0) else carried_leave_days end
  where id = v_id
    and (p ?| array['birth_date', 'gender', 'address', 'city', 'profession', 'education', 'bank_name', 'duties', 'workplace', 'contract_no',
                    'work_days', 'weekly_hours', 'schedule_from', 'schedule_to', 'probation_months', 'annual_leave_days',
                    'extra_leave_days', 'carried_leave_days']);
  t := nullif(trim(coalesce(p->>'history_note', '')), '');
  if t is not null then
    insert into public.acc_employee_history (employee_id, client_id, kind, note, created_by) values (v_id, c.id, 'note', left(t, 500), auth.uid());
  end if;
  return v_id;
end $$;

create or replace function public.acc_save_leave(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.acc_employees;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_from date := (p->>'from_date')::date;
  v_to date := (p->>'to_date')::date;
begin
  select em.* into e from public.acc_employees em join public.acc_clients c on c.id = em.client_id
   where em.id = (p->>'employee_id')::uuid and c.accountant_id = public._require_accountant();
  if not found then
    raise exception 'Punëtori nuk u gjet' using errcode = 'P0002';
  end if;
  if v_to < v_from then raise exception 'Data e mbarimit është para fillimit' using errcode = '22023'; end if;
  if exists (select 1 from public.acc_leaves l where l.employee_id = e.id and l.id is distinct from v_id
             and l.from_date <= v_to and l.to_date >= v_from) then
    raise exception 'Punëtori ka tashmë pushim ose mungesë në këto data' using errcode = '23505';
  end if;
  if v_id is null then
    insert into public.acc_leaves (client_id, employee_id, kind, from_date, to_date, days, note, decision_no, decision_date)
    values (e.client_id, e.id, p->>'kind', v_from, v_to, (p->>'days')::numeric, nullif(trim(coalesce(p->>'note', '')), ''),
            nullif(trim(coalesce(p->>'decision_no', '')), ''), nullif(p->>'decision_date', '')::date)
    returning id into v_id;
  else
    update public.acc_leaves set kind = p->>'kind', from_date = v_from, to_date = v_to, days = (p->>'days')::numeric,
           note = nullif(trim(coalesce(p->>'note', '')), ''), decision_no = nullif(trim(coalesce(p->>'decision_no', '')), ''),
           decision_date = nullif(p->>'decision_date', '')::date
    where id = v_id and employee_id = e.id;
    if not found then raise exception 'Pushimi nuk u gjet' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Next decision number of the year for a client: "<n>/<year>".
create or replace function public.acc_next_leave_decision_no(p_client uuid, p_year int)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_n int;
begin
  select coalesce(max(nullif(split_part(decision_no, '/', 1), '')::int), 0) + 1 into v_n
  from public.acc_leaves
  where client_id = c.id and decision_no ~ ('^[0-9]+/' || p_year || '$');
  return v_n || '/' || p_year;
end $$;

create or replace function public.acc_employee_history_list(p_employee uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.acc_employees;
begin
  select em.* into e from public.acc_employees em join public.acc_clients c on c.id = em.client_id
   where em.id = p_employee and c.accountant_id = public._require_accountant();
  if not found then raise exception 'Punëtori nuk u gjet' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'change_date', h.change_date, 'kind', h.kind, 'old_value', h.old_value,
                                        'new_value', h.new_value, 'note', h.note, 'created_at', h.created_at,
                                        'by', coalesce(a.full_name, u.email))
                     order by h.change_date desc, h.created_at desc)
    from public.acc_employee_history h
    left join public.accountants a on a.user_id = h.created_by
    left join auth.users u on u.id = h.created_by
    where h.employee_id = e.id
  ), '[]'::jsonb);
end $$;

-- Attendance of a month: every employee working that month and the marked days.
create or replace function public.acc_attendance_month(p_client uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employee_id', e.id, 'name', e.first_name || ' ' || e.last_name, 'position', e.position,
      'work_days', e.work_days, 'weekly_hours', e.weekly_hours, 'start_date', e.start_date, 'end_date', e.end_date,
      'days', (select coalesce(jsonb_object_agg(a.day::text, jsonb_build_object('status', a.status, 'hours', a.hours, 'note', a.note)), '{}'::jsonb)
               from public.acc_attendance a where a.employee_id = e.id and a.day between v_from and v_to),
      'leaves', (select coalesce(jsonb_agg(jsonb_build_object('kind', l.kind, 'from_date', l.from_date, 'to_date', l.to_date)), '[]'::jsonb)
                 from public.acc_leaves l where l.employee_id = e.id and l.from_date <= v_to and l.to_date >= v_from)
    ) order by e.last_name, e.first_name)
    from public.acc_employees e
    where e.client_id = c.id and e.start_date <= v_to and (e.end_date is null or e.end_date >= v_from)
  ), '[]'::jsonb);
end $$;

-- Mark days: p = [{employee_id, day, status | null (= clear), hours?, note?}]
create or replace function public.acc_attendance_set(p_client uuid, p jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client(p_client);
  x jsonb;
  n int := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    if not exists (select 1 from public.acc_employees where id = (x->>'employee_id')::uuid and client_id = c.id) then
      raise exception 'Punëtori nuk u gjet' using errcode = 'P0002';
    end if;
    if nullif(x->>'status', '') is null then
      delete from public.acc_attendance where employee_id = (x->>'employee_id')::uuid and day = (x->>'day')::date;
    else
      insert into public.acc_attendance (employee_id, client_id, day, status, hours, note, updated_by)
      values ((x->>'employee_id')::uuid, c.id, (x->>'day')::date, x->>'status', nullif(x->>'hours', '')::numeric,
              nullif(trim(coalesce(x->>'note', '')), ''), auth.uid())
      on conflict (employee_id, day) do update set status = excluded.status, hours = excluded.hours, note = excluded.note,
             updated_by = excluded.updated_by, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.acc_scan_set_kind(uuid, text), public.acc_set_atk_categories(uuid, text, jsonb),
  public.acc_vat_book_range(uuid, date, date), public.acc_next_leave_decision_no(uuid, int), public.acc_employee_history_list(uuid),
  public.acc_attendance_month(uuid, date), public.acc_attendance_set(uuid, jsonb), public._acc_employee_history() from public, anon;
grant execute on function public.acc_scan_set_kind(uuid, text), public.acc_set_atk_categories(uuid, text, jsonb),
  public.acc_vat_book_range(uuid, date, date), public.acc_next_leave_decision_no(uuid, int), public.acc_employee_history_list(uuid),
  public.acc_attendance_month(uuid, date), public.acc_attendance_set(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Kasa: ATK category of products by business type
-- ---------------------------------------------------------------------
create or replace function public._atk_default_type(p_business uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case b.type::text when 'market' then 'AU' when 'restaurant' then 'UR' when 'pharmacy' then 'BM' when 'salon' then 'SHZ' else 'TT' end
  from public.businesses b where b.id = p_business;
$$;

create or replace function public._products_atk_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.atk_type is null or new.atk_type in ('', 'TT') then
    new.atk_type := coalesce(public._atk_default_type(new.business_id), 'TT');
  end if;
  return new;
end $$;

drop trigger if exists products_atk_type on public.products;
create trigger products_atk_type before insert on public.products
  for each row execute function public._products_atk_type();

update public.products p set atk_type = public._atk_default_type(p.business_id)
where p.atk_type = 'TT' and public._atk_default_type(p.business_id) <> 'TT';

revoke execute on function public._atk_default_type(uuid), public._products_atk_type() from public, anon, authenticated;

-- The sale returned to the till carries the ATK category of each line (CouponItem.Type of the fiscal coupon).
create or replace function public.sale_json(p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'ref_sale_id', s.ref_sale_id,
    'ref_invoice_no', (select o.invoice_no from public.sales o where o.id = s.ref_sale_id),
    'invoice_no', s.invoice_no, 'daily_no', s.daily_no, 'sale_date', s.sale_date,
    'created_at', s.created_at, 'client_created_at', s.client_created_at,
    'items_count', s.items_count, 'subtotal', s.subtotal, 'invoice_discount', s.invoice_discount,
    'discount_total', s.discount_total, 'total', s.total, 'net_total', s.net_total, 'vat_total', s.vat_total,
    'vat_lines', s.vat_lines, 'payment_method', s.payment_method, 'cash_amount', s.cash_amount,
    'card_amount', s.card_amount, 'tendered', s.tendered, 'change_amount', s.change_amount,
    'reason', s.reason, 'note', s.note, 'offline', s.offline, 'offline_no', s.offline_no,
    'fiscal_status', s.fiscal_status, 'worker_id', s.worker_id,
    'worker_name', (select pr.full_name from public.profiles pr where pr.id = s.worker_id),
    'register_name', (select r.name from public.registers r where r.id = s.register_id),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'position', i.position, 'product_id', i.product_id, 'name', i.name, 'unit', i.unit,
        'quantity', i.quantity, 'unit_price', i.unit_price, 'line_discount', i.line_discount,
        'invoice_discount', i.invoice_discount, 'total', i.total, 'vat_code', i.vat_code, 'atk_type', i.atk_type,
        'refunded', (select coalesce(-sum(r.quantity), 0) from public.sale_items r where r.ref_item_id = i.id)
      ) order by i.position), '[]'::jsonb)
      from public.sale_items i where i.sale_id = s.id
    ),
    'voided', exists (select 1 from public.sales v where v.ref_sale_id = s.id and v.kind = 'void'),
    'has_refunds', exists (select 1 from public.sales v where v.ref_sale_id = s.id and v.kind = 'refund')
  )
  from public.sales s
  where s.id = p_sale_id and s.business_id = public.current_business_id()
$$;
