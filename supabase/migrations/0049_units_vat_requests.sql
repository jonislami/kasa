-- =====================================================================
-- 0049 – After the registration: a new unit, and the request to move into VAT.
-- 1. "Shto njësi": the owner of an active business adds a unit (a new point of sale). It waits as 'pending'; when
--    the platform admin approves it (platform_unit_decide, 0041) its tills are created as at registration.
--    A unit still waiting can be withdrawn by the owner.
-- 2. "Kërko kalimin në TVSH": a business registered without VAT sends its VAT number, the date and the document of
--    the VAT registration (bucket business-docs, folder <business>/vat/). The business stays "Pa TVSH" until the
--    platform admin checks the document and approves; only then businesses.vat_number is set.
-- 3. The VAT number of a business that is past the application can no longer be changed from the client (the old
--    "Cilësimet → Të dhënat e biznesit" field): only through an approved request or by the platform admin.
-- Existing data does not change.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A new unit after the registration
-- ---------------------------------------------------------------------
create or replace function public.owner_unit_add(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  b public.businesses;
  v_allowed text[];
  v_acts text[];
  v_id uuid;
  v_main uuid;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  select * into b from public.businesses where id = v_b for update;
  if b.status in ('pending', 'needs_info') then
    raise exception 'Njësitë shtohen te formulari i aplikimit derisa ai të aprovohet' using errcode = '22023';
  end if;
  if b.status not in ('approved', 'active') then raise exception 'Biznesi nuk është aktiv' using errcode = '22023'; end if;
  if coalesce(trim(p->>'name'), '') = '' or coalesce(trim(p->>'city'), '') = '' or coalesce(trim(p->>'address'), '') = ''
     or coalesce(trim(p->>'country'), '') = '' then
    raise exception 'Shkruaj emrin, shtetin, qytetin dhe adresën e njësisë' using errcode = '22023';
  end if;
  if (select count(*) from public.business_units where business_id = v_b) >= 50 then
    raise exception 'Deri në 50 njësi' using errcode = '22023';
  end if;
  if (select count(*) from public.business_units where business_id = v_b and status = 'pending') >= 5 then
    raise exception 'Ke 5 njësi që presin miratim – prit vendimin para se të shtosh të tjera' using errcode = '22023';
  end if;
  select coalesce(array_agg(a.name), '{}') into v_allowed from public.business_activities a where a.active;
  select coalesce(array_agg(distinct x), '{}') into v_acts
    from jsonb_array_elements_text(coalesce(p->'activities', '[]'::jsonb)) x where x = any (v_allowed);
  if cardinality(v_acts) = 0 then raise exception 'Zgjidh të paktën një veprimtari' using errcode = '22023'; end if;

  -- a business registered before the units (0041) has none: its present premises become the main unit first, with
  -- its tills and Branch ID, so the new unit does not take them over when it is approved
  if not exists (select 1 from public.business_units where business_id = v_b) then
    insert into public.business_units (business_id, name, country, city, address, activities, registers, status, sort, fiscal_branch_id)
    values (v_b, left(b.name, 120), coalesce(nullif(b.registration->>'country', ''), 'Kosovë'), coalesce(nullif(trim(b.city), ''), '—'),
            coalesce(nullif(trim(b.address), ''), '—'),
            coalesce((select array_agg(distinct trim(x)) from unnest(string_to_array(coalesce(b.activity, ''), ',')) x where trim(x) <> ''), '{}'),
            least(20, greatest(1, (select count(*) from public.registers r where r.business_id = v_b and r.active)::int)), 'approved', 0, b.fiscal_branch_id)
    returning id into v_main;
    update public.registers set unit_id = v_main where business_id = v_b and unit_id is null;
  end if;

  insert into public.business_units (business_id, name, unit_no, country, city, address, activities, registers, status, sort)
  values (v_b, left(trim(p->>'name'), 120), nullif(left(trim(coalesce(p->>'unit_no', '')), 20), ''), left(trim(p->>'country'), 60),
          left(trim(p->>'city'), 80), left(trim(p->>'address'), 200), v_acts,
          least(20, greatest(1, coalesce((p->>'registers')::int, 1))), 'pending',
          coalesce((select max(sort) + 1 from public.business_units where business_id = v_b), 1))
  returning id into v_id;

  insert into public.business_events (business_id, action, note, by_user) values (v_b, 'unit_requested', left(trim(p->>'name'), 120), auth.uid());
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_b, auth.uid(), 'unit_requested', 'business_unit', v_id::text, jsonb_build_object('name', left(trim(p->>'name'), 120)));
  return v_id;
end $$;

-- withdraw a unit that still waits (after the registration; during the application the form replaces the units)
create or replace function public.owner_unit_withdraw(p_unit uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  v_name text;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  if public._application_open(v_b) then raise exception 'Njësitë ndryshohen te formulari i aplikimit' using errcode = '22023'; end if;
  delete from public.business_units u
   where u.id = p_unit and u.business_id = v_b and u.status = 'pending'
     and not exists (select 1 from public.registers r where r.unit_id = u.id)
  returning name into v_name;
  if v_name is null then raise exception 'Vetëm njësia që pret miratim mund të tërhiqet' using errcode = '22023'; end if;
  insert into public.business_events (business_id, action, note, by_user) values (v_b, 'unit_withdrawn', v_name, auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- 2. The request to move into VAT
-- ---------------------------------------------------------------------
alter table public.business_documents drop constraint if exists business_documents_kind_check;
alter table public.business_documents add constraint business_documents_kind_check check (kind in ('certificate', 'other', 'vat'));

create table if not exists public.business_vat_requests (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  vat_number  text not null,
  vat_date    date not null,
  document_id uuid references public.business_documents (id) on delete set null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note        text,                                   -- the admin's reason when rejected
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  decided_by  uuid references auth.users (id),
  decided_at  timestamptz
);
create index if not exists business_vat_requests_business_idx on public.business_vat_requests (business_id, created_at desc);
create unique index if not exists business_vat_requests_one_pending on public.business_vat_requests (business_id) where status = 'pending';
alter table public.business_vat_requests enable row level security;
drop policy if exists business_vat_requests_read on public.business_vat_requests;
create policy business_vat_requests_read on public.business_vat_requests for select to authenticated
  using (business_id = public._owner_business() or public.is_platform_admin());
grant select on public.business_vat_requests to authenticated;

-- the VAT document is uploaded by the owner of an active business into <business>/vat/; it can be removed again only
-- while no request uses it (a failed request cleans up its file)
create or replace function public._vat_upload_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((storage.foldername(p_name))[2] = 'vat', false)
     and exists (select 1 from public.businesses b
                  where b.id = public._owner_business() and b.status in ('approved', 'active') and nullif(trim(b.vat_number), '') is null)
$$;
revoke execute on function public._vat_upload_allowed(text) from public, anon;
grant execute on function public._vat_upload_allowed(text) to authenticated;

drop policy if exists business_docs_write on storage.objects;
create policy business_docs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'business-docs'
              and (storage.foldername(name))[1] = public._owner_business()::text
              and (public._application_open(public._owner_business()) or public._vat_upload_allowed(name)));
drop policy if exists business_docs_delete on storage.objects;
create policy business_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'business-docs'
         and (storage.foldername(name))[1] = public._owner_business()::text
         and (public._application_open(public._owner_business())
              or (public._vat_upload_allowed(name) and not exists (select 1 from public.business_documents d where d.path = name))));

create or replace function public.owner_vat_request(p_vat_number text, p_vat_date date, p_path text, p_name text, p_mime text, p_size bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  b public.businesses;
  v_vat text := left(regexp_replace(coalesce(p_vat_number, ''), '\s', '', 'g'), 30);
  v_doc uuid;
  v_id uuid;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  select * into b from public.businesses where id = v_b for update;
  if b.status in ('pending', 'needs_info') then
    raise exception 'Gjatë aplikimit TVSH-ja shënohet te formulari i aplikimit' using errcode = '22023';
  end if;
  if b.status not in ('approved', 'active') then raise exception 'Biznesi nuk është aktiv' using errcode = '22023'; end if;
  if nullif(trim(b.vat_number), '') is not null then raise exception 'Biznesi është tashmë në TVSH' using errcode = '22023'; end if;
  if exists (select 1 from public.business_vat_requests where business_id = v_b and status = 'pending') then
    raise exception 'Një kërkesë për TVSH pret miratim' using errcode = '23505';
  end if;
  if v_vat !~ '^[0-9A-Za-z-]{6,30}$' then raise exception 'Shkruaj numrin e TVSH-së' using errcode = '22023'; end if;
  if p_vat_date is null or p_vat_date > public._local_date() then
    raise exception 'Shkruaj datën e regjistrimit në TVSH (jo në të ardhmen)' using errcode = '22023';
  end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> v_b::text or split_part(p_path, '/', 2) <> 'vat' then
    raise exception 'Skedari nuk është në dosjen e biznesit' using errcode = '22023';
  end if;
  if coalesce(p_mime, '') not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') then
    raise exception 'Lejohen vetëm PDF, PNG, JPG dhe WebP' using errcode = '22023';
  end if;
  if coalesce(p_size, 0) > 10485760 then raise exception 'Skedari është më i madh se 10 MB' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'business-docs' and o.name = p_path) then
    raise exception 'Ngarko dokumentin e regjistrimit në TVSH' using errcode = 'P0002';
  end if;

  insert into public.business_documents (business_id, kind, path, file_name, mime, size_bytes, created_by)
  values (v_b, 'vat', p_path, left(coalesce(nullif(trim(p_name), ''), 'dokument'), 200), p_mime, p_size, auth.uid())
  returning id into v_doc;
  insert into public.business_vat_requests (business_id, vat_number, vat_date, document_id, created_by)
  values (v_b, v_vat, p_vat_date, v_doc, auth.uid())
  returning id into v_id;

  insert into public.business_events (business_id, action, note, by_user) values (v_b, 'vat_requested', 'Nr. TVSH ' || v_vat, auth.uid());
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_b, auth.uid(), 'vat_requested', 'business', v_b::text, jsonb_build_object('vat_number', v_vat, 'vat_date', p_vat_date));
  return v_id;
end $$;

-- the owner withdraws a request that still waits (e.g. a wrong document); its file stays as history of the business
create or replace function public.owner_vat_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  update public.business_vat_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where id = p_id and business_id = v_b and status = 'pending';
  if not found then raise exception 'Kërkesa nuk pret më miratim' using errcode = '22023'; end if;
  insert into public.business_events (business_id, action, note, by_user) values (v_b, 'vat_cancelled', null, auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- 3. Platform admin: what the active businesses ask, and the decision on VAT
-- ---------------------------------------------------------------------
create or replace function public.platform_pending_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_platform_admin();
  return jsonb_build_object(
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'business_id', b.id, 'business', b.name, 'nui', b.nui, 'name', u.name, 'unit_no', u.unit_no,
               'country', u.country, 'city', u.city, 'address', u.address, 'activities', u.activities, 'registers', u.registers,
               'created_at', u.created_at) order by u.created_at)
        from public.business_units u join public.businesses b on b.id = u.business_id
       where u.status = 'pending' and b.status in ('approved', 'active')), '[]'::jsonb),
    'vat', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'business_id', b.id, 'business', b.name, 'nui', b.nui, 'vat_number', r.vat_number, 'vat_date', r.vat_date,
               'document', case when d.id is null then null else jsonb_build_object('path', d.path, 'file_name', d.file_name, 'mime', d.mime, 'size_bytes', d.size_bytes) end,
               'created_at', r.created_at) order by r.created_at)
        from public.business_vat_requests r join public.businesses b on b.id = r.business_id
        left join public.business_documents d on d.id = r.document_id
       where r.status = 'pending'), '[]'::jsonb));
end $$;

create or replace function public.platform_vat_decide(p_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.business_vat_requests;
begin
  perform public._require_platform_admin();
  if p_action not in ('approve', 'reject') then raise exception 'Veprimi nuk vlen' using errcode = '22023'; end if;
  if p_action = 'reject' and coalesce(trim(p_note), '') = '' then
    raise exception 'Shkruaj arsyen e refuzimit (e sheh klienti)' using errcode = '22023';
  end if;
  select * into r from public.business_vat_requests where id = p_id for update;
  if not found then raise exception 'Kërkesa nuk u gjet' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'Kërkesa është vendosur tashmë' using errcode = '22023'; end if;

  update public.business_vat_requests
     set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
         note = nullif(left(trim(coalesce(p_note, '')), 1000), ''), decided_by = auth.uid(), decided_at = now()
   where id = r.id;

  if p_action = 'approve' then
    perform set_config('kasa.vat_change', '1', true);
    update public.businesses
       set vat_number = r.vat_number,
           registration = registration || jsonb_build_object('vat_registered', true, 'vat_date', r.vat_date)
     where id = r.business_id;
    perform set_config('kasa.vat_change', '', true);
  end if;

  insert into public.business_events (business_id, action, note, by_user)
  values (r.business_id, case when p_action = 'approve' then 'vat_approved' else 'vat_rejected' end,
          case when p_action = 'approve' then 'Nr. TVSH ' || r.vat_number else nullif(trim(p_note), '') end, auth.uid());
  -- in the business's own log (the owner sees it) and in the platform log
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (r.business_id, auth.uid(), case when p_action = 'approve' then 'vat_approved' else 'vat_rejected' end, 'business', r.business_id::text,
          jsonb_build_object('vat_number', r.vat_number, 'vat_date', r.vat_date, 'note', nullif(trim(coalesce(p_note, '')), '')));
end $$;

-- ---------------------------------------------------------------------
-- 4. The VAT number changes only through the application, an approved request or the platform admin
-- ---------------------------------------------------------------------
create or replace function public._business_vat_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(coalesce(new.vat_number, '')), '') is distinct from nullif(trim(coalesce(old.vat_number, '')), '')
     and old.status not in ('pending', 'needs_info', 'approved')
     and auth.uid() is not null
     and not public.is_platform_admin()
     and coalesce(current_setting('kasa.vat_change', true), '') <> '1' then
    raise exception 'Numri i TVSH-së ndryshohet vetëm me kërkesë te administratori (Llogaria → Kërko kalimin në TVSH)' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists businesses_vat_lock on public.businesses;
create trigger businesses_vat_lock before update of vat_number on public.businesses for each row execute function public._business_vat_lock();
revoke execute on function public._business_vat_lock() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.owner_unit_add(jsonb), public.owner_unit_withdraw(uuid),
  public.owner_vat_request(text, date, text, text, text, bigint), public.owner_vat_cancel(uuid),
  public.platform_pending_requests(), public.platform_vat_decide(uuid, text, text) from public, anon;
grant execute on function public.owner_unit_add(jsonb), public.owner_unit_withdraw(uuid),
  public.owner_vat_request(text, date, text, text, text, bigint), public.owner_vat_cancel(uuid),
  public.platform_pending_requests(), public.platform_vat_decide(uuid, text, text) to authenticated;
