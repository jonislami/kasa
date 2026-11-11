-- =====================================================================
-- 0021 – Kasa Kontabilist, phase K6: scanning supplier invoices with AI.
--
-- * acc_scans: one uploaded photo / PDF (bucket acc-files, folder of the client) and what the AI read.
--   Status: pending (uploaded) → read (AI done) → review (opened / corrected) → confirmed (purchase saved)
--           or failed (could not be read; can be retried).
-- * The Edge Function "acc-scan" runs with the accountant's own JWT (no service role): it reads the
--   scan row and the file through RLS / storage policies and stores the result with acc_scan_result.
-- * acc_scan_result also suggests the supplier (by NUI, then by name), the category the client last used
--   for that supplier, and flags a duplicate (same supplier NUI + invoice number already booked).
-- * acc_scan_confirm links the saved purchase, attaches the original to it (acc_files) and records who
--   confirmed. Nothing existing changes shape.
-- =====================================================================

create table if not exists public.acc_scans (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.acc_clients (id) on delete cascade,
  accountant_id uuid not null references public.accountants (user_id) on delete cascade,
  path          text not null unique,               -- <client_id>/scan-<uuid>-<name> in bucket acc-files
  file_name     text not null,
  mime          text,
  size_bytes    bigint,
  status        text not null default 'pending' check (status in ('pending', 'read', 'review', 'confirmed', 'failed')),
  extracted     jsonb,                              -- what the AI read (see the Edge Function schema)
  suggest       jsonb,                              -- {partner_id, partner_name, category, duplicate_doc_id, duplicate_doc_no}
  error         text,
  model         text,
  doc_id        uuid references public.acc_documents (id) on delete set null,
  scanned_by    uuid references auth.users (id) on delete set null,
  confirmed_by  uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  confirmed_at  timestamptz
);
create index if not exists acc_scans_client_idx on public.acc_scans (client_id, created_at desc);

alter table public.acc_scans enable row level security;
drop policy if exists acc_scans_own on public.acc_scans;
create policy acc_scans_own on public.acc_scans for select to authenticated
  using (accountant_id = auth.uid() and public.is_accountant());
revoke all on public.acc_scans from anon, authenticated;
grant select on public.acc_scans to authenticated;

-- ---------------------------------------------------------------------
-- Register an uploaded file (the program uploads it to storage first).
-- ---------------------------------------------------------------------
create or replace function public.acc_scan_add(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.acc_clients := public._own_client((p->>'client_id')::uuid);
  v_path text := p->>'path';
  v_id uuid;
begin
  if v_path is null or split_part(v_path, '/', 1) <> c.id::text then
    raise exception 'Skedari nuk është në dosjen e klientit' using errcode = '22023';
  end if;
  insert into public.acc_scans (client_id, accountant_id, path, file_name, mime, size_bytes, scanned_by)
  values (c.id, c.accountant_id, v_path, left(coalesce(nullif(p->>'file_name', ''), 'skanim'), 200), left(p->>'mime', 100),
          (p->>'size_bytes')::bigint, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Result of the AI (called by the Edge Function with the accountant's JWT).
-- p = {extracted?, error?, model?}
-- ---------------------------------------------------------------------
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
  v_nui text;
  v_name text;
  v_no text;
  v_partner public.acc_partners;
  v_cat text;
  v_dup record;
  v_suggest jsonb;
begin
  select * into s from public.acc_scans where id = p_id and accountant_id = public._require_accountant();
  if not found then raise exception 'Skanimi nuk u gjet' using errcode = 'P0002'; end if;
  if s.status = 'confirmed' then raise exception 'Skanimi është konfirmuar tashmë' using errcode = '22023'; end if;
  c := public._own_client(s.client_id);

  if x is null or jsonb_typeof(x) <> 'object' then
    update public.acc_scans set status = 'failed', error = left(coalesce(p->>'error', 'Fatura nuk u lexua'), 500),
           model = coalesce(p->>'model', model), read_at = now()
    where id = s.id;
    return jsonb_build_object('status', 'failed');
  end if;

  v_nui := nullif(regexp_replace(coalesce(x->>'supplier_nui', ''), '\D', '', 'g'), '');
  v_name := nullif(trim(coalesce(x->>'supplier_name', '')), '');
  v_no := nullif(trim(coalesce(x->>'doc_no', '')), '');

  -- supplier: by NUI, then by the exact name
  if v_nui is not null then
    select * into v_partner from public.acc_partners where client_id = c.id and nui = v_nui limit 1;
  end if;
  if v_partner.id is null and v_name is not null then
    select * into v_partner from public.acc_partners where client_id = c.id and lower(name) = lower(v_name) order by active desc limit 1;
  end if;

  -- category this client last used for the supplier (learning from earlier bookings)
  select d.category into v_cat
  from public.acc_documents d
  where d.client_id = c.id and d.kind = 'purchase'
    and ((v_partner.id is not null and d.partner_id = v_partner.id) or (v_nui is not null and d.partner_nui = v_nui))
  order by d.doc_date desc, d.created_at desc
  limit 1;

  -- duplicate: same supplier and invoice number already booked
  if v_no is not null then
    select d.id, d.doc_no, d.doc_date into v_dup
    from public.acc_documents d
    where d.client_id = c.id and d.kind = 'purchase' and lower(trim(d.doc_no)) = lower(v_no)
      and ((v_partner.id is not null and d.partner_id = v_partner.id) or (v_nui is not null and d.partner_nui = v_nui)
           or (v_nui is null and v_partner.id is null and lower(d.partner_name) = lower(v_name)))
    limit 1;
  end if;

  v_suggest := jsonb_strip_nulls(jsonb_build_object(
    'partner_id', v_partner.id, 'partner_name', v_partner.name, 'category', v_cat,
    'duplicate_doc_id', v_dup.id, 'duplicate_doc_no', v_dup.doc_no, 'duplicate_doc_date', v_dup.doc_date,
    'buyer_mismatch', case when nullif(regexp_replace(coalesce(x->>'buyer_nui', ''), '\D', '', 'g'), '') is not null
                            and c.nui is not null
                            and regexp_replace(x->>'buyer_nui', '\D', '', 'g') <> c.nui then true end));

  update public.acc_scans set status = 'read', extracted = x, suggest = v_suggest, error = null,
         model = coalesce(p->>'model', model), read_at = now()
  where id = s.id;
  return jsonb_build_object('status', 'read', 'suggest', v_suggest);
end $$;

-- Opened in the review screen (and corrections are being made).
create or replace function public.acc_scan_review(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.acc_scans set status = 'review'
  where id = p_id and accountant_id = public._require_accountant() and status = 'read';
end $$;

-- After the purchase is saved (acc_save_invoice): link it, attach the original, record who confirmed.
create or replace function public.acc_scan_confirm(p_id uuid, p_doc uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.acc_scans;
begin
  select * into s from public.acc_scans where id = p_id and accountant_id = public._require_accountant() for update;
  if not found then raise exception 'Skanimi nuk u gjet' using errcode = 'P0002'; end if;
  if s.status = 'confirmed' then raise exception 'Skanimi është konfirmuar tashmë' using errcode = '22023'; end if;
  if not exists (select 1 from public.acc_documents where id = p_doc and client_id = s.client_id) then
    raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002';
  end if;
  update public.acc_scans set status = 'confirmed', doc_id = p_doc, confirmed_by = auth.uid(), confirmed_at = now() where id = s.id;
  insert into public.acc_files (client_id, doc_id, path, file_name, mime, size_bytes, uploaded_by)
  values (s.client_id, p_doc, s.path, s.file_name, s.mime, s.size_bytes, coalesce(s.scanned_by, auth.uid()))
  on conflict (path) do update set doc_id = excluded.doc_id;
  insert into public.acc_doc_history (doc_id, user_id, action, details)
  values (p_doc, auth.uid(), 'scan', jsonb_build_object('name', s.file_name, 'model', s.model));
end $$;

-- Delete a scan that was not confirmed; returns the storage path, which the program removes.
create or replace function public.acc_scan_delete(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.acc_scans;
begin
  select * into s from public.acc_scans where id = p_id and accountant_id = public._require_accountant();
  if not found then raise exception 'Skanimi nuk u gjet' using errcode = 'P0002'; end if;
  if s.status = 'confirmed' and s.doc_id is not null then
    raise exception 'Skanimi i konfirmuar mbetet si origjinal i faturës' using errcode = '22023';
  end if;
  delete from public.acc_scans where id = s.id;
  return s.path;
end $$;

-- List of a client (newest first) with the names of who scanned / confirmed and the booked document.
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
      'scanned_by_name', coalesce(ps.full_name, us.email), 'confirmed_by_name', coalesce(pc.full_name, uc.email)
    ) order by s.created_at desc)
    from public.acc_scans s
    left join public.acc_documents d on d.id = s.doc_id
    left join auth.users us on us.id = s.scanned_by
    left join public.accountants ps on ps.user_id = s.scanned_by
    left join auth.users uc on uc.id = s.confirmed_by
    left join public.accountants pc on pc.user_id = s.confirmed_by
    where s.client_id = c.id and (p_status is null or s.status = p_status)
  ), '[]'::jsonb);
end $$;

revoke execute on function public.acc_scan_add(jsonb), public.acc_scan_result(uuid, jsonb), public.acc_scan_review(uuid),
  public.acc_scan_confirm(uuid, uuid), public.acc_scan_delete(uuid), public.acc_scans_list(uuid, text) from public, anon;
grant execute on function public.acc_scan_add(jsonb), public.acc_scan_result(uuid, jsonb), public.acc_scan_review(uuid),
  public.acc_scan_confirm(uuid, uuid), public.acc_scan_delete(uuid), public.acc_scans_list(uuid, text) to authenticated;
