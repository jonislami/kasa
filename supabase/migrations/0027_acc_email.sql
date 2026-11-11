-- =====================================================================
-- 0027 – Kasa Kontabilist: e-mails (sent by the Edge Function acc-notify through Resend).
--
-- * accountants.notify (office owner row): which e-mails the office sends – messages, document requests,
--   office invoices, monthly report.
-- * acc_email_log: every e-mail (who, to whom, what, sent / failed) – also used to throttle notices
--   (one "new message" e-mail per client and direction every 30 minutes).
-- * acc_notify_context(kind, id, extra): checks the caller (office member who sees the client, or the
--   client's portal user), gathers recipients and content, writes the log row and returns it to the function.
--   Kinds: request, invoice, report, office_message (office → client), client_message (client → office).
-- * _acc_report_data(client, month): the monthly summary (also for the scheduled job, service role only).
-- Nothing existing changes shape.
-- =====================================================================

alter table public.accountants add column if not exists notify jsonb not null
  default '{"messages": true, "requests": true, "invoices": true, "reports": false}'::jsonb;

create table if not exists public.acc_email_log (
  id         bigint generated always as identity primary key,
  office_id  uuid not null references public.accountants (user_id) on delete cascade,
  client_id  uuid references public.acc_clients (id) on delete set null,
  kind       text not null,
  ref_id     text,
  recipients text[] not null,
  subject    text not null,
  status     text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error      text,
  sent_by    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists acc_email_log_office_idx on public.acc_email_log (office_id, created_at desc);
create index if not exists acc_email_log_throttle_idx on public.acc_email_log (client_id, kind, created_at desc);
alter table public.acc_email_log enable row level security;
drop policy if exists acc_email_log_own on public.acc_email_log;
create policy acc_email_log_own on public.acc_email_log for select to authenticated
  using (public.is_accountant() and office_id = public._office_id() and public._acc_role() = 'admin');
revoke all on public.acc_email_log from anon, authenticated;
grant select on public.acc_email_log to authenticated;

-- Office settings for e-mails (admins).
create or replace function public.acc_notify_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select o.notify from public.accountants o where o.user_id = public._require_accountant()
$$;

create or replace function public.acc_notify_settings_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
begin
  update public.accountants
     set notify = notify || jsonb_strip_nulls(jsonb_build_object(
           'messages', (p->>'messages')::boolean, 'requests', (p->>'requests')::boolean,
           'invoices', (p->>'invoices')::boolean, 'reports', (p->>'reports')::boolean))
   where user_id = v_office;
end $$;

-- Monthly summary of a client (sales, purchases, VAT, open amounts, office invoices, open requests).
create or replace function public._acc_report_data(p_client uuid, p_month date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select date_trunc('month', p_month)::date as f, (date_trunc('month', p_month) + interval '1 month - 1 day')::date as t)
  select jsonb_build_object(
    'month', m.f,
    'sales', (select jsonb_build_object('net', coalesce(sum(net_e + net_d + amt_c + amt_a), 0), 'vat', coalesce(sum(vat_e + vat_d), 0), 'gross', coalesce(sum(total), 0), 'docs', count(*))
              from public.acc_documents where client_id = p_client and kind = 'sale' and doc_date between m.f and m.t),
    'purchases', (select jsonb_build_object('net', coalesce(sum(net_e + net_d + amt_c + amt_a + vat_nd), 0), 'vat', coalesce(sum(vat_e + vat_d), 0), 'gross', coalesce(sum(total), 0), 'docs', count(*))
                  from public.acc_documents where client_id = p_client and kind = 'purchase' and doc_date between m.f and m.t),
    'vat_return', (select jsonb_build_object('status', r.status, 'amount', coalesce((r.boxes->>'72')::numeric, 0), 'credit', coalesce((r.boxes->>'71')::numeric, 0), 'filed_at', r.filed_at)
                   from public.acc_vat_returns r where r.client_id = p_client and r.month = m.f),
    'payroll', (select jsonb_build_object('status', r.status, 'employees', count(l.*), 'net', coalesce(sum(l.net), 0), 'to_pay', coalesce(sum(l.tax + l.emp_contrib + l.er_contrib), 0))
                from public.acc_payroll_runs r left join public.acc_payroll_lines l on l.run_id = r.id
                where r.client_id = p_client and r.month = m.f and r.status <> 'draft' group by r.id, r.status),
    'receivable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = p_client and b.kind = 'sale'),
    'payable', (select coalesce(sum(b.open), 0) from public.acc_doc_balances b where b.client_id = p_client and b.kind = 'purchase'),
    'office_open', (select coalesce(sum(i.total - i.paid), 0) from public.acc_office_invoices i where i.client_id = p_client and i.status = 'open'),
    'open_requests', (select coalesce(jsonb_agg(r.title || coalesce(' (' || to_char(r.period, 'MM/YYYY') || ')', '')), '[]'::jsonb)
                      from public.acc_doc_requests r where r.client_id = p_client and r.status = 'requested')
  )
  from m
$$;

-- Recipients on the client side: active portal users and the company e-mail.
create or replace function public._acc_client_emails(p_client uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(e)) filter (where e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'), '{}')
  from (
    select pu.email as e from public.acc_portal_users pu where pu.client_id = p_client and pu.active
    union all
    select c.email from public.acc_clients c where c.id = p_client
  ) x
$$;

-- p_kind: request | invoice | report | office_message | client_message
create or replace function public.acc_notify_context(p_kind text, p_id uuid, p_extra jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients;
  o public.accountants;
  v_to text[];
  v_subject text;
  v_data jsonb;
  v_ref text := p_id::text;
  v_flag text;
  v_log bigint;
  r public.acc_doc_requests;
  i public.acc_office_invoices;
  v_month date;
begin
  if p_kind = 'client_message' then
    c := public._portal_client(p_id);
  elsif p_kind = 'request' then
    select * into r from public.acc_doc_requests where id = p_id;
    if not found then raise exception 'Kërkesa nuk u gjet' using errcode = 'P0002'; end if;
    c := public._own_client(r.client_id);
  elsif p_kind = 'invoice' then
    select * into i from public.acc_office_invoices where id = p_id;
    if not found then raise exception 'Fatura nuk u gjet' using errcode = 'P0002'; end if;
    perform public._acc_require_admin();
    c := public._own_client(i.client_id);
  elsif p_kind in ('report', 'office_message') then
    c := public._own_client(p_id);
  else
    raise exception 'Lloji nuk vlen' using errcode = '22023';
  end if;
  select * into o from public.accountants where user_id = c.accountant_id;

  v_flag := case p_kind when 'request' then 'requests' when 'invoice' then 'invoices' when 'report' then 'reports' else 'messages' end;
  -- reports and requests sent by hand go even when the automatic ones are off; message notices follow the setting
  if p_kind in ('office_message', 'client_message') and coalesce((o.notify->>v_flag)::boolean, true) = false then
    return jsonb_build_object('skip', 'Njoftimet me email për mesazhet janë të fikura');
  end if;
  if p_kind in ('office_message', 'client_message') and exists (
       select 1 from public.acc_email_log l where l.client_id = c.id and l.kind = p_kind and l.status in ('queued', 'sent')
         and l.created_at > now() - interval '30 minutes') then
    return jsonb_build_object('skip', 'U njoftua para pak');
  end if;

  if p_kind = 'client_message' then
    select array_agg(distinct lower(e)) filter (where e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') into v_to
    from (select coalesce(o.office_email, o.email) as e
          union all
          select a.email from public.accountants a where a.office_id = o.user_id and a.active and a.role in ('admin', 'accountant')
            and (a.all_clients or a.role = 'admin' or exists (select 1 from public.acc_member_clients mc where mc.member_id = a.user_id and mc.client_id = c.id))) x;
    v_subject := 'Mesazh i ri nga ' || c.name;
    v_data := jsonb_build_object('messages', (select coalesce(jsonb_agg(m.body order by m.id), '[]'::jsonb) from (
                 select body, id from public.acc_messages where client_id = c.id and from_client and read_at is null order by id desc limit 5) m));
  else
    v_to := public._acc_client_emails(c.id);
    if p_kind = 'request' then
      v_subject := 'Kërkesë për dokumente: ' || r.title;
      v_data := jsonb_build_object('title', r.title, 'period', r.period, 'due_date', r.due_date, 'note', r.note);
    elsif p_kind = 'invoice' then
      v_subject := 'Fatura ' || i.inv_no || ' nga ' || coalesce(o.office_name, 'zyra e kontabilitetit');
      v_data := jsonb_build_object('inv_no', i.inv_no, 'issue_date', i.issue_date, 'due_date', i.due_date, 'description', i.description,
                                   'total', i.total, 'paid', i.paid, 'iban', o.office_iban, 'bank', o.office_bank);
    elsif p_kind = 'report' then
      v_month := coalesce(nullif(p_extra->>'month', '')::date, (date_trunc('month', public._local_date()) - interval '1 month')::date);
      v_subject := 'Raporti i muajit ' || to_char(v_month, 'MM/YYYY') || ' – ' || c.name;
      v_data := public._acc_report_data(c.id, v_month);
      v_ref := c.id::text || ':' || to_char(v_month, 'YYYY-MM');
    else -- office_message
      v_subject := 'Mesazh i ri nga ' || coalesce(o.office_name, 'zyra e kontabilitetit');
      v_data := jsonb_build_object('messages', (select coalesce(jsonb_agg(m.body order by m.id), '[]'::jsonb) from (
                   select body, id from public.acc_messages where client_id = c.id and not from_client and read_at is null order by id desc limit 5) m));
    end if;
  end if;

  if p_kind in ('office_message', 'client_message') and jsonb_array_length(coalesce(v_data->'messages', '[]'::jsonb)) = 0 then
    return jsonb_build_object('skip', 'Asnjë mesazh i palexuar');
  end if;
  if coalesce(array_length(v_to, 1), 0) = 0 then
    return jsonb_build_object('skip', case when p_kind = 'client_message' then 'Zyra nuk ka email' else 'Klienti nuk ka email (as te të dhënat, as te portali)' end);
  end if;

  insert into public.acc_email_log (office_id, client_id, kind, ref_id, recipients, subject, sent_by)
  values (o.user_id, c.id, p_kind, v_ref, v_to, v_subject, auth.uid())
  returning id into v_log;
  if p_kind = 'request' then
    update public.acc_doc_requests set reminders = reminders + 1, last_reminded_at = now() where id = r.id;
  end if;

  return jsonb_build_object(
    'log_id', v_log, 'kind', p_kind, 'to', to_jsonb(v_to), 'subject', v_subject, 'data', v_data,
    'client', jsonb_build_object('name', c.name, 'nui', c.nui),
    'office', jsonb_build_object('name', o.office_name, 'email', coalesce(o.office_email, o.email), 'phone', coalesce(o.office_phone, o.phone),
                                 'address', concat_ws(', ', o.office_address, o.office_city)));
end $$;

-- The function reports back whether Resend accepted the e-mail.
create or replace function public.acc_email_done(p_id bigint, p_ok boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.acc_email_log set status = case when p_ok then 'sent' else 'failed' end, error = left(p_error, 500)
  where id = p_id and (sent_by = auth.uid() or auth.uid() is null);
end $$;

create or replace function public.acc_email_log_list(p_limit int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'client_name', c.name, 'recipients', l.recipients, 'subject', l.subject,
                                        'status', l.status, 'error', l.error, 'created_at', l.created_at, 'sent_by_name', coalesce(a.full_name, pu.full_name, u.email))
                     order by l.id desc)
    from (select * from public.acc_email_log where office_id = v_office order by id desc limit least(coalesce(p_limit, 200), 1000)) l
    left join public.acc_clients c on c.id = l.client_id
    left join public.accountants a on a.user_id = l.sent_by
    left join public.acc_portal_users pu on pu.user_id = l.sent_by and pu.client_id = l.client_id
    left join auth.users u on u.id = l.sent_by
  ), '[]'::jsonb);
end $$;

-- Scheduled monthly reports (called by the Edge Function with the service role): clients of offices that turned
-- reports on, with at least one recipient, not sent yet for the month.
create or replace function public._acc_report_targets(p_month date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'office_id', o.user_id, 'client_id', c.id, 'client_name', c.name, 'client_nui', c.nui, 'to', to_jsonb(public._acc_client_emails(c.id)),
           'office', jsonb_build_object('name', o.office_name, 'email', coalesce(o.office_email, o.email), 'phone', coalesce(o.office_phone, o.phone),
                                        'address', concat_ws(', ', o.office_address, o.office_city)),
           'data', public._acc_report_data(c.id, p_month))), '[]'::jsonb)
  from public.acc_clients c
  join public.accountants o on o.user_id = c.accountant_id and o.office_id is null and o.active
  where c.active and coalesce((o.notify->>'reports')::boolean, false)
    and coalesce(array_length(public._acc_client_emails(c.id), 1), 0) > 0
    and not exists (select 1 from public.acc_email_log l where l.client_id = c.id and l.kind = 'report'
                      and l.ref_id = c.id::text || ':' || to_char(p_month, 'YYYY-MM') and l.status = 'sent')
$$;

create or replace function public._acc_email_log_add(p_office uuid, p_client uuid, p_kind text, p_ref text, p_to text[], p_subject text, p_ok boolean, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.acc_email_log (office_id, client_id, kind, ref_id, recipients, subject, status, error)
  values (p_office, p_client, p_kind, p_ref, p_to, p_subject, case when p_ok then 'sent' else 'failed' end, left(p_error, 500))
$$;

revoke execute on function public._acc_report_data(uuid, date), public._acc_client_emails(uuid), public._acc_report_targets(date),
  public._acc_email_log_add(uuid, uuid, text, text, text[], text, boolean, text) from public, anon, authenticated;
grant execute on function public._acc_report_targets(date), public._acc_email_log_add(uuid, uuid, text, text, text[], text, boolean, text) to service_role;
revoke execute on function public.acc_notify_settings(), public.acc_notify_settings_save(jsonb), public.acc_notify_context(text, uuid, jsonb),
  public.acc_email_done(bigint, boolean, text), public.acc_email_log_list(int) from public, anon;
grant execute on function public.acc_notify_settings(), public.acc_notify_settings_save(jsonb), public.acc_notify_context(text, uuid, jsonb),
  public.acc_email_done(bigint, boolean, text), public.acc_email_log_list(int) to authenticated;
