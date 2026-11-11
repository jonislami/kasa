-- =====================================================================
-- 0028 – Kasa Kontabilist: restoring a client from a backup (0025, format kasa-kontabilist-backup v1).
--
-- * acc_restore_client(backup, name?) – office admins only – opens the backup as a NEW client of the office:
--   every row gets a new id and every link (partner, invoice, payment, account, loan, employee, run, entry…)
--   is mapped to the new rows; people who no longer exist are left empty.
-- * Order matters: invoices first without their links to each other (credit note → original, proforma → invoice),
--   then the links; payroll runs as drafts while their lines go in, then their status; month locks last,
--   so the lock triggers do not refuse old data.
-- * Not restored: the PDF / photo files (only their list is in the backup), scans, the office's own invoices
--   (they stay with the office when a client is deleted). Invoice numbering continues after the restored numbers.
-- * The history of actions gets one line for the restore instead of one per row (acc.restoring).
-- =====================================================================

-- History (0022): silent while a restore runs (one summary line is written instead).
do $$
declare
  def text := pg_get_functiondef('public._acc_log()'::regprocedure);
begin
  if position('acc.restoring' in def) = 0 then
    if position('if auth.uid() is null then return null; end if;' in def) = 0 then
      raise exception '_acc_log: start not found';
    end if;
    execute replace(def, 'if auth.uid() is null then return null; end if;',
                    'if auth.uid() is null or current_setting(''acc.restoring'', true) = ''on'' then return null; end if;');
  end if;
end $$;

-- An auth user id from the backup, if that person still exists.
create or replace function public._acc_user_or_null(p text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where id::text = p
$$;

create or replace function public.acc_restore_client(p jsonb, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_office uuid := public._acc_require_admin();
  v_client uuid := gen_random_uuid();
  cl jsonb := p->'client';
  v_name text;
  v_nui text;
  r jsonb;
  v_new uuid;
  m_partner jsonb := '{}';
  m_doc jsonb := '{}';
  m_pay jsonb := '{}';
  m_acc jsonb := '{}';
  m_loan jsonb := '{}';
  m_tx jsonb := '{}';
  m_tg jsonb := '{}';
  m_entry jsonb := '{}';
  m_emp jsonb := '{}';
  m_run jsonb := '{}';
  v_counts jsonb := '{}';
  v_n int;
begin
  if coalesce(p->>'format', '') <> 'kasa-kontabilist-backup' or cl is null then
    raise exception 'Ky skedar nuk është backup i Kasa Kontabilist' using errcode = '22023';
  end if;
  if coalesce((p->>'version')::int, 0) <> 1 then
    raise exception 'Version i panjohur i backup-it (%)', p->>'version' using errcode = '22023';
  end if;
  perform set_config('acc.restoring', 'on', true);

  -- client: a new one in this office; no link to Kasa; NUI only when it is free in the office
  v_name := left(coalesce(nullif(trim(p_name), ''), (cl->>'name') || ' (rikthyer)'), 200);
  v_nui := nullif(cl->>'nui', '');
  if v_nui is not null and exists (select 1 from public.acc_clients where accountant_id = v_office and nui = v_nui) then
    v_nui := null;
  end if;
  insert into public.acc_clients
  select (jsonb_populate_record(null::public.acc_clients, cl || jsonb_build_object(
    'id', v_client, 'accountant_id', v_office, 'name', v_name, 'nui', v_nui, 'active', true,
    'kasa_business_id', null, 'link_status', 'none', 'link_requested_at', null, 'link_responded_at', null,
    'created_at', now(), 'updated_at', now()))).*;

  -- partners, money accounts, loans
  for r in select * from jsonb_array_elements(coalesce(p->'partners', '[]')) loop
    v_new := gen_random_uuid(); m_partner := m_partner || jsonb_build_object(r->>'id', v_new);
    insert into public.acc_partners select (jsonb_populate_record(null::public.acc_partners, r || jsonb_build_object('id', v_new, 'client_id', v_client, 'accountant_id', v_office))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'money_accounts', '[]')) loop
    v_new := gen_random_uuid(); m_acc := m_acc || jsonb_build_object(r->>'id', v_new);
    insert into public.acc_money_accounts select (jsonb_populate_record(null::public.acc_money_accounts, r || jsonb_build_object('id', v_new, 'client_id', v_client, 'accountant_id', v_office))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'loans', '[]')) loop
    v_new := gen_random_uuid(); m_loan := m_loan || jsonb_build_object(r->>'id', v_new);
    insert into public.acc_loans select (jsonb_populate_record(null::public.acc_loans, r || jsonb_build_object('id', v_new, 'client_id', v_client, 'account_id', m_acc->(r->>'account_id')))).*;
  end loop;

  -- invoices (links between invoices afterwards), lines, payments
  for r in select * from jsonb_array_elements(coalesce(p->'documents', '[]')) loop
    v_new := gen_random_uuid(); m_doc := m_doc || jsonb_build_object(r->>'id', v_new);
    insert into public.acc_documents select (jsonb_populate_record(null::public.acc_documents, r || jsonb_build_object(
      'id', v_new, 'client_id', v_client, 'accountant_id', v_office, 'partner_id', m_partner->(r->>'partner_id'),
      'ref_doc_id', null, 'converted_to', null,
      'created_by', public._acc_user_or_null(r->>'created_by'), 'updated_by', public._acc_user_or_null(r->>'updated_by')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'documents', '[]')) loop
    if nullif(r->>'ref_doc_id', '') is not null or nullif(r->>'converted_to', '') is not null then
      update public.acc_documents
         set ref_doc_id = (m_doc->>(r->>'ref_doc_id'))::uuid, converted_to = (m_doc->>(r->>'converted_to'))::uuid
       where id = (m_doc->>(r->>'id'))::uuid;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'document_lines', '[]')) loop
    continue when m_doc->(r->>'doc_id') is null;
    insert into public.acc_document_lines select (jsonb_populate_record(null::public.acc_document_lines, r || jsonb_build_object('id', gen_random_uuid(), 'doc_id', m_doc->(r->>'doc_id')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'payments', '[]')) loop
    continue when m_doc->(r->>'doc_id') is null;
    v_new := gen_random_uuid(); m_pay := m_pay || jsonb_build_object(r->>'id', v_new);
    insert into public.acc_payments select (jsonb_populate_record(null::public.acc_payments, r || jsonb_build_object(
      'id', v_new, 'client_id', v_client, 'doc_id', m_doc->(r->>'doc_id'), 'account_id', m_acc->(r->>'account_id'),
      'created_by', public._acc_user_or_null(r->>'created_by')))).*;
  end loop;

  -- cash and bank
  for r in select * from jsonb_array_elements(coalesce(p->'transactions', '[]')) loop
    continue when m_acc->(r->>'account_id') is null;
    v_new := gen_random_uuid(); m_tx := m_tx || jsonb_build_object(r->>'id', v_new);
    if nullif(r->>'transfer_group', '') is not null and m_tg->(r->>'transfer_group') is null then
      m_tg := m_tg || jsonb_build_object(r->>'transfer_group', gen_random_uuid());
    end if;
    insert into public.acc_transactions select (jsonb_populate_record(null::public.acc_transactions, r || jsonb_build_object(
      'id', v_new, 'client_id', v_client, 'account_id', m_acc->(r->>'account_id'), 'partner_id', m_partner->(r->>'partner_id'),
      'loan_id', m_loan->(r->>'loan_id'), 'transfer_group', m_tg->(r->>'transfer_group'),
      'created_by', public._acc_user_or_null(r->>'created_by')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'bank_lines', '[]')) loop
    continue when m_acc->(r->>'account_id') is null;
    insert into public.acc_bank_lines select (jsonb_populate_record(null::public.acc_bank_lines, r || jsonb_build_object(
      'id', gen_random_uuid(), 'client_id', v_client, 'account_id', m_acc->(r->>'account_id'),
      'payment_id', m_pay->(r->>'payment_id'), 'tx_id', m_tx->(r->>'tx_id'), 'doc_id', m_doc->(r->>'doc_id')))).*;
  end loop;

  -- VAT and other taxes
  for r in select * from jsonb_array_elements(coalesce(p->'vat_returns', '[]')) loop
    insert into public.acc_vat_returns select (jsonb_populate_record(null::public.acc_vat_returns, r
      || case when r ? 'id' then jsonb_build_object('id', gen_random_uuid()) else '{}'::jsonb end
      || jsonb_build_object('client_id', v_client, 'updated_by', public._acc_user_or_null(r->>'updated_by')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'tax_filings', '[]')) loop
    insert into public.acc_tax_filings select (jsonb_populate_record(null::public.acc_tax_filings, r || jsonb_build_object(
      'id', gen_random_uuid(), 'client_id', v_client, 'created_by', public._acc_user_or_null(r->>'created_by')))).*;
  end loop;

  -- ledger
  for r in select * from jsonb_array_elements(coalesce(p->'chart_of_accounts', '[]')) loop
    insert into public.acc_coa select (jsonb_populate_record(null::public.acc_coa, r
      || case when r ? 'id' then jsonb_build_object('id', gen_random_uuid()) else '{}'::jsonb end
      || jsonb_build_object('client_id', v_client))).*
    on conflict do nothing;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'journal_entries', '[]')) loop
    v_new := gen_random_uuid(); m_entry := m_entry || jsonb_build_object(r->>'id', v_new);
    insert into public.acc_journal_entries select (jsonb_populate_record(null::public.acc_journal_entries, r || jsonb_build_object(
      'id', v_new, 'client_id', v_client, 'created_by', public._acc_user_or_null(r->>'created_by')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'journal_lines', '[]')) loop
    continue when m_entry->(r->>'entry_id') is null;
    insert into public.acc_journal_lines select (jsonb_populate_record(null::public.acc_journal_lines, r
      || case when r ? 'id' then jsonb_build_object('id', gen_random_uuid()) else '{}'::jsonb end
      || jsonb_build_object('entry_id', m_entry->(r->>'entry_id'), 'partner_id', m_partner->(r->>'partner_id')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'assets', '[]')) loop
    insert into public.acc_assets select (jsonb_populate_record(null::public.acc_assets, r || jsonb_build_object(
      'id', gen_random_uuid(), 'client_id', v_client, 'doc_id', m_doc->(r->>'doc_id')))).*;
  end loop;

  -- employees and payroll (runs as drafts while their lines go in)
  for r in select * from jsonb_array_elements(coalesce(p->'employees', '[]')) loop
    v_new := gen_random_uuid(); m_emp := m_emp || jsonb_build_object(r->>'id', v_new);
    insert into public.acc_employees select (jsonb_populate_record(null::public.acc_employees, r || jsonb_build_object('id', v_new, 'client_id', v_client))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'leaves', '[]')) loop
    continue when m_emp->(r->>'employee_id') is null;
    insert into public.acc_leaves select (jsonb_populate_record(null::public.acc_leaves, r || jsonb_build_object(
      'id', gen_random_uuid(), 'client_id', v_client, 'employee_id', m_emp->(r->>'employee_id')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'payroll_runs', '[]')) loop
    v_new := gen_random_uuid(); m_run := m_run || jsonb_build_object(r->>'id', v_new);
    insert into public.acc_payroll_runs select (jsonb_populate_record(null::public.acc_payroll_runs, r || jsonb_build_object(
      'id', v_new, 'client_id', v_client, 'status', 'draft'))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'payroll_lines', '[]')) loop
    continue when m_run->(r->>'run_id') is null or m_emp->(r->>'employee_id') is null;
    insert into public.acc_payroll_lines select (jsonb_populate_record(null::public.acc_payroll_lines, r
      || case when r ? 'id' then jsonb_build_object('id', gen_random_uuid()) else '{}'::jsonb end
      || jsonb_build_object('run_id', m_run->(r->>'run_id'), 'employee_id', m_emp->(r->>'employee_id')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'payroll_runs', '[]')) loop
    update public.acc_payroll_runs set status = coalesce(r->>'status', 'draft') where id = (m_run->>(r->>'id'))::uuid;
  end loop;

  -- the office's work with this client
  if jsonb_typeof(p->'contract') = 'object' then
    insert into public.acc_contracts select (jsonb_populate_record(null::public.acc_contracts, (p->'contract') || jsonb_build_object(
      'id', gen_random_uuid(), 'office_id', v_office, 'client_id', v_client))).*;
  end if;
  for r in select * from jsonb_array_elements(coalesce(p->'tasks', '[]')) loop
    insert into public.acc_tasks select (jsonb_populate_record(null::public.acc_tasks, r || jsonb_build_object(
      'id', gen_random_uuid(), 'office_id', v_office, 'client_id', v_client,
      'assigned_to', (select a.user_id from public.accountants a where a.user_id::text = r->>'assigned_to' and coalesce(a.office_id, a.user_id) = v_office),
      'created_by', public._acc_user_or_null(r->>'created_by'), 'done_by', public._acc_user_or_null(r->>'done_by')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'doc_requests', '[]')) loop
    insert into public.acc_doc_requests select (jsonb_populate_record(null::public.acc_doc_requests, r || jsonb_build_object(
      'id', gen_random_uuid(), 'office_id', v_office, 'client_id', v_client, 'requested_by', public._acc_user_or_null(r->>'requested_by')))).*;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p->'notes', '[]')) loop
    insert into public.acc_client_notes select (jsonb_populate_record(null::public.acc_client_notes, r || jsonb_build_object(
      'id', gen_random_uuid(), 'office_id', v_office, 'client_id', v_client, 'created_by', public._acc_user_or_null(r->>'created_by')))).*;
  end loop;
  insert into public.acc_messages (office_id, client_id, sender_id, from_client, body, created_at, read_at)
  select v_office, v_client, public._acc_user_or_null(m->>'sender_id'), coalesce((m->>'from_client')::boolean, false), m->>'body',
         coalesce((m->>'created_at')::timestamptz, now()), (m->>'read_at')::timestamptz
  from jsonb_array_elements(coalesce(p->'messages', '[]')) m
  where coalesce(trim(m->>'body'), '') <> '';

  -- month locks and VAT status last
  for r in select * from jsonb_array_elements(coalesce(p->'periods', '[]')) loop
    insert into public.acc_periods select (jsonb_populate_record(null::public.acc_periods, r || jsonb_build_object('client_id', v_client))).*;
  end loop;

  -- invoice numbering continues after the restored numbers (F-2026-0012 → 12)
  insert into public.acc_counters (client_id, series, year, last_no)
  select v_client, x[1], x[2]::int, max(x[3]::int)
  from public.acc_documents d, regexp_match(d.doc_no, '^([A-Z]+)-(\d{4})-(\d+)$') x
  where d.client_id = v_client and d.auto_number and x is not null
  group by x[1], x[2];

  select jsonb_build_object(
    'partners', (select count(*) from public.acc_partners where client_id = v_client),
    'documents', (select count(*) from public.acc_documents where client_id = v_client),
    'payments', (select count(*) from public.acc_payments where client_id = v_client),
    'transactions', (select count(*) from public.acc_transactions where client_id = v_client),
    'employees', (select count(*) from public.acc_employees where client_id = v_client),
    'payroll_runs', (select count(*) from public.acc_payroll_runs where client_id = v_client),
    'journal_entries', (select count(*) from public.acc_journal_entries where client_id = v_client),
    'vat_returns', (select count(*) from public.acc_vat_returns where client_id = v_client),
    'files_not_restored', jsonb_array_length(coalesce(p->'files', '[]'))) into v_counts;

  perform set_config('acc.restoring', 'off', true);
  insert into public.acc_activity (office_id, client_id, user_id, entity, entity_id, action, label)
  values (v_office, v_client, auth.uid(), 'acc_clients', v_client::text, 'insert',
          left('Rikthyer nga backup-i i ' || coalesce(nullif(p->>'created_at', ''), '?') || ': ' || v_name, 200));
  return jsonb_build_object('client_id', v_client, 'name', v_name, 'nui_kept', v_nui is not null or cl->>'nui' is null, 'counts', v_counts);
end $$;

revoke execute on function public._acc_user_or_null(text) from public, anon, authenticated;
revoke execute on function public.acc_restore_client(jsonb, text) from public, anon;
grant execute on function public.acc_restore_client(jsonb, text) to authenticated;
