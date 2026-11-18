-- =====================================================================
-- 0041 – Business application in four steps (company, taxes, units, documents).
--   * business_activities: the list of activities offered for a unit (checkboxes), managed by the platform admin.
--   * business_units: the units of a business (name, number, country, city, address, activities, tills), saved one by
--     one and linked to the business; status pending → approved / rejected. Approval creates the tills of each
--     approved unit (registers.unit_id).
--   * business_documents + bucket "business-docs": the registration certificate (required in the form) and other
--     documents (PDF, PNG, JPG, WebP; 10 MB). Folder = the business id; the owner adds / removes while the application
--     is open, the platform admin reads.
--   * The tax profile (legal form, tax category, voluntary real income, VAT status and date, tax centre, country,
--     partner code) is kept in businesses.registration; the VAT number in businesses.vat_number as before.
--   * registration_nui_taken(nui): the form checks the NUI before sending (the Edge Function checks again).
--   * The owner edits the whole application until it is approved (owner_application_save); "needs_info" goes back
--     to "pending". Admin actions are written to audit_log and business_events.
-- Nothing existing changes shape: old registrations keep working (no units → tills as in 0036).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Activities (managed by the platform admin)
-- ---------------------------------------------------------------------
create table if not exists public.business_activities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort       int not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists business_activities_name_idx on public.business_activities (lower(name));
alter table public.business_activities enable row level security;
drop policy if exists business_activities_read on public.business_activities;
create policy business_activities_read on public.business_activities for select to anon, authenticated
  using (active or public.is_platform_admin());

insert into public.business_activities (name, sort)
select v.name, v.sort
  from (values ('Tregti me pakicë', 10), ('Tregti me shumicë', 20), ('Gastronomi', 30), ('Ndërtim', 40), ('Shërbime', 50),
               ('Automjete', 60), ('Barnatore', 70), ('Market', 80), ('Autopjesë', 90), ('Depo', 100)) v(name, sort)
 where not exists (select 1 from public.business_activities a where lower(a.name) = lower(v.name));

create or replace function public.platform_activity_save(p_id uuid, p_name text, p_active boolean default true, p_sort int default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(trim(coalesce(p_name, '')), 80);
  v_id uuid;
begin
  perform public._require_platform_admin();
  if v_name = '' then raise exception 'Shkruaj emrin e veprimtarisë' using errcode = '22023'; end if;
  if exists (select 1 from public.business_activities where lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'Kjo veprimtari ekziston tashmë' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.business_activities (name, sort, active)
    values (v_name, coalesce(p_sort, (select coalesce(max(sort), 0) + 10 from public.business_activities)), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.business_activities set name = v_name, active = coalesce(p_active, active), sort = coalesce(p_sort, sort), updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Veprimtaria nuk u gjet' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), case when p_id is null then 'activity_create' else 'activity_update' end, 'business_activity', v_id::text,
          jsonb_build_object('name', v_name, 'active', coalesce(p_active, true)));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Units
-- ---------------------------------------------------------------------
create table if not exists public.business_units (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses (id) on delete cascade,
  name        text not null,
  unit_no     text,
  country     text not null default 'Kosovë',
  city        text not null,
  address     text not null,
  activities  text[] not null default '{}',
  registers   int not null default 1 check (registers between 1 and 20),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists business_units_business_idx on public.business_units (business_id, sort);
alter table public.business_units enable row level security;
drop policy if exists business_units_read on public.business_units;
create policy business_units_read on public.business_units for select to authenticated
  using (business_id = public.current_business_id() or business_id = public._owner_business());

alter table public.registers add column if not exists unit_id uuid references public.business_units (id) on delete set null;

-- ---------------------------------------------------------------------
-- 3. Documents
-- ---------------------------------------------------------------------
create table if not exists public.business_documents (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses (id) on delete cascade,
  kind        text not null check (kind in ('certificate', 'other')),
  path        text not null unique,                 -- <business_id>/<uuid>-<name> in bucket business-docs
  file_name   text not null,
  mime        text,
  size_bytes  bigint,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create index if not exists business_documents_business_idx on public.business_documents (business_id, created_at);
alter table public.business_documents enable row level security;
drop policy if exists business_documents_read on public.business_documents;
create policy business_documents_read on public.business_documents for select to authenticated
  using (business_id = public.current_business_id() or business_id = public._owner_business());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-docs', 'business-docs', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- the owner while the application is open (pending / needs_info)
create or replace function public._application_open(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.businesses b where b.id = p_business and b.status in ('pending', 'needs_info'))
$$;

drop policy if exists business_docs_read on storage.objects;
create policy business_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'business-docs'
         and ((storage.foldername(name))[1] = public._owner_business()::text or public.is_platform_admin()));
drop policy if exists business_docs_write on storage.objects;
create policy business_docs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'business-docs'
              and (storage.foldername(name))[1] = public._owner_business()::text
              and public._application_open(public._owner_business()));
drop policy if exists business_docs_delete on storage.objects;
create policy business_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'business-docs'
         and (storage.foldername(name))[1] = public._owner_business()::text
         and public._application_open(public._owner_business()));

-- ---------------------------------------------------------------------
-- 4. The form: NUI check, the application of the owner, saving, documents
-- ---------------------------------------------------------------------
-- true when another business (not rejected) already has this NUI
create or replace function public.registration_nui_taken(p_nui text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.businesses b
                  where b.nui = regexp_replace(coalesce(p_nui, ''), '\D', '', 'g') and b.status <> 'rejected'
                    and b.id is distinct from public._owner_business())
$$;

create or replace function public.owner_application()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  return jsonb_build_object(
    'open', public._application_open(v_b),
    'units', coalesce((select jsonb_agg(to_jsonb(u) - 'business_id' order by u.sort, u.created_at) from public.business_units u where u.business_id = v_b), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) - 'business_id' - 'created_by' order by d.created_at) from public.business_documents d where d.business_id = v_b), '[]'::jsonb));
end $$;

create or replace function public.owner_application_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  b public.businesses;
  t jsonb := coalesce(p->'tax', '{}'::jsonb);
  v_nui text := regexp_replace(coalesce(p->>'nui', ''), '\D', '', 'g');
  v_vat boolean := coalesce((t->>'vat_registered')::boolean, false);
  v_units jsonb := coalesce(p->'units', '[]'::jsonb);
  v_allowed text[];
  u jsonb;
  i int := 0;
  v_acts text[];
  v_total int := 0;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  select * into b from public.businesses where id = v_b for update;
  if b.status not in ('pending', 'needs_info') then
    raise exception 'Aplikimi nuk ndryshohet më pasi të vendoset' using errcode = '22023';
  end if;

  -- company
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Shkruaj emrin e kompanisë' using errcode = '22023'; end if;
  if v_nui !~ '^\d{9}$' then raise exception 'NUI duhet të ketë 9 shifra' using errcode = '22023'; end if;
  if exists (select 1 from public.businesses x where x.nui = v_nui and x.status <> 'rejected' and x.id <> v_b) then
    raise exception 'Ky NUI është regjistruar tashmë nga një biznes tjetër' using errcode = '23505';
  end if;
  if coalesce(trim(p->>'address'), '') = '' or coalesce(trim(p->>'city'), '') = '' or coalesce(trim(p->>'country'), '') = '' then
    raise exception 'Shkruaj adresën, shtetin dhe qytetin e kompanisë' using errcode = '22023';
  end if;
  -- taxes
  if coalesce(t->>'legal_form', '') not in ('bi', 'shpk', 'sha', 'op', 'ok', 'other') then
    raise exception 'Zgjidh formën juridike' using errcode = '22023';
  end if;
  if coalesce(t->>'tax_category', '') = '' then raise exception 'Zgjidh kategorinë tatimore' using errcode = '22023'; end if;
  if v_vat and (coalesce(trim(t->>'vat_number'), '') = '' or coalesce(t->>'vat_date', '') = '') then
    raise exception 'Shkruaj numrin e TVSH-së dhe datën e regjistrimit në TVSH' using errcode = '22023';
  end if;
  -- units
  if jsonb_typeof(v_units) <> 'array' or jsonb_array_length(v_units) = 0 then
    raise exception 'Shto të paktën një njësi të biznesit' using errcode = '22023';
  end if;
  if jsonb_array_length(v_units) > 50 then raise exception 'Deri në 50 njësi' using errcode = '22023'; end if;
  select coalesce(array_agg(a.name), '{}') into v_allowed from public.business_activities a where a.active;
  for u in select * from jsonb_array_elements(v_units) loop
    i := i + 1;
    if coalesce(trim(u->>'name'), '') = '' or coalesce(trim(u->>'city'), '') = '' or coalesce(trim(u->>'address'), '') = ''
       or coalesce(trim(u->>'country'), '') = '' then
      raise exception 'Njësia %: shkruaj emrin, shtetin, qytetin dhe adresën', i using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_acts
      from jsonb_array_elements_text(coalesce(u->'activities', '[]'::jsonb)) x where x = any (v_allowed);
    if cardinality(v_acts) = 0 then raise exception 'Njësia %: zgjidh të paktën një veprimtari', i using errcode = '22023'; end if;
    v_total := v_total + least(20, greatest(1, coalesce((u->>'registers')::int, 1)));
  end loop;

  update public.businesses
     set name = left(trim(p->>'name'), 160),
         nui = v_nui,
         fiscal_number = coalesce(nullif(fiscal_number, ''), v_nui),
         vat_number = case when v_vat then left(trim(t->>'vat_number'), 30) else null end,
         address = left(trim(p->>'address'), 200),
         city = left(trim(p->>'city'), 80),
         phone = coalesce(nullif(left(trim(p->>'phone'), 40), ''), phone),
         owner_name = coalesce(nullif(left(trim(p->>'owner_name'), 120), ''), owner_name),
         activity = (select left(string_agg(distinct x, ', '), 200)
                       from jsonb_array_elements(v_units) uu, jsonb_array_elements_text(coalesce(uu->'activities', '[]'::jsonb)) x where x = any (v_allowed)),
         registration = registration || jsonb_build_object(
           'version', 2, 'country', left(trim(p->>'country'), 60), 'tax_center', nullif(left(trim(coalesce(t->>'tax_center', '')), 80), ''),
           'legal_form', t->>'legal_form', 'tax_category', left(t->>'tax_category', 40),
           'real_income', coalesce((t->>'real_income')::boolean, false), 'vat_registered', v_vat,
           'vat_date', case when v_vat then t->>'vat_date' else null end,
           'partner_code', nullif(left(trim(coalesce(p->>'partner_code', '')), 40), ''), 'registers', v_total),
         status = case when status = 'needs_info' then 'pending' else status end
   where id = v_b;

  -- the units are replaced while the application is open (no till uses them yet)
  update public.registers set unit_id = null where business_id = v_b and unit_id is not null;
  delete from public.business_units where business_id = v_b;
  i := 0;
  for u in select * from jsonb_array_elements(v_units) loop
    i := i + 1;
    insert into public.business_units (business_id, name, unit_no, country, city, address, activities, registers, sort)
    values (v_b, left(trim(u->>'name'), 120), nullif(left(trim(coalesce(u->>'unit_no', '')), 20), ''), left(trim(u->>'country'), 60),
            left(trim(u->>'city'), 80), left(trim(u->>'address'), 200),
            (select coalesce(array_agg(distinct x), '{}') from jsonb_array_elements_text(coalesce(u->'activities', '[]'::jsonb)) x where x = any (v_allowed)),
            least(20, greatest(1, coalesce((u->>'registers')::int, 1))), i);
  end loop;

  if not coalesce((p->>'initial')::boolean, false) then
    insert into public.business_events (business_id, action, note, by_user)
    values (v_b, case when b.status = 'needs_info' then 'info_sent' else 'updated' end, nullif(left(trim(coalesce(p->>'message', '')), 1000), ''), auth.uid());
  end if;
end $$;

create or replace function public.owner_document_add(p_kind text, p_path text, p_name text, p_mime text, p_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  v_old text;
  v_id uuid;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  if not public._application_open(v_b) then raise exception 'Dokumentet ndryshohen vetëm para aprovimit' using errcode = '22023'; end if;
  if p_kind not in ('certificate', 'other') then raise exception 'Lloji i dokumentit nuk njihet' using errcode = '22023'; end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> v_b::text then raise exception 'Skedari nuk është në dosjen e biznesit' using errcode = '22023'; end if;
  if coalesce(p_mime, '') not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') then
    raise exception 'Lejohen vetëm PDF, PNG, JPG dhe WebP' using errcode = '22023';
  end if;
  if coalesce(p_size, 0) > 10485760 then raise exception 'Skedari është më i madh se 10 MB' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'business-docs' and o.name = p_path) then
    raise exception 'Skedari nuk u ngarkua' using errcode = 'P0002';
  end if;
  if (select count(*) from public.business_documents where business_id = v_b) >= 20 then
    raise exception 'Deri në 20 dokumente' using errcode = '22023';
  end if;
  -- one certificate: a new one replaces the old (the caller removes the old file)
  if p_kind = 'certificate' then
    delete from public.business_documents where business_id = v_b and kind = 'certificate' returning path into v_old;
  end if;
  insert into public.business_documents (business_id, kind, path, file_name, mime, size_bytes, created_by)
  values (v_b, p_kind, p_path, left(coalesce(nullif(trim(p_name), ''), 'dokument'), 200), p_mime, p_size, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'replaced_path', v_old);
end $$;

create or replace function public.owner_document_remove(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  v_path text;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  if not public._application_open(v_b) then raise exception 'Dokumentet ndryshohen vetëm para aprovimit' using errcode = '22023'; end if;
  delete from public.business_documents where id = p_id and business_id = v_b returning path into v_path;
  if v_path is null then raise exception 'Dokumenti nuk u gjet' using errcode = 'P0002'; end if;
  return v_path;
end $$;

-- ---------------------------------------------------------------------
-- 5. Platform admin: units and documents of an application, a unit's decision, approval creates the tills
-- ---------------------------------------------------------------------
create or replace function public.platform_application_extra(p_business uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_platform_admin();
  return jsonb_build_object(
    'units', coalesce((select jsonb_agg(to_jsonb(u) order by u.sort, u.created_at) from public.business_units u where u.business_id = p_business), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) - 'created_by' order by d.created_at) from public.business_documents d where d.business_id = p_business), '[]'::jsonb));
end $$;

create or replace function public.platform_unit_decide(p_unit uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.business_units;
begin
  perform public._require_platform_admin();
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Statusi nuk vlen' using errcode = '22023'; end if;
  update public.business_units set status = p_status, updated_at = now() where id = p_unit returning * into u;
  if u.id is null then raise exception 'Njësia nuk u gjet' using errcode = 'P0002'; end if;
  if p_status = 'approved' and exists (select 1 from public.businesses where id = u.business_id and status = 'active') then
    perform public._ensure_registers(u.business_id);
  end if;
  insert into public.business_events (business_id, action, note, by_user) values (u.business_id, 'unit_' || p_status, u.name, auth.uid());
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), 'unit_' || p_status, 'business_unit', u.id::text, jsonb_build_object('business', u.business_id, 'name', u.name));
end $$;

-- Tills on approval: with units, the tills each approved unit asked for (named after the unit when there are several);
-- without units, as in 0036 (registration.registers).
create or replace function public._ensure_registers(p_business uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_want int;
  v_have int;
  v_multi boolean;
  u record;
  v_free uuid;
begin
  if exists (select 1 from public.business_units where business_id = p_business) then
    select count(*) > 1 into v_multi from public.business_units where business_id = p_business and status = 'approved';
    for u in select * from public.business_units where business_id = p_business and status = 'approved' order by sort, created_at loop
      select count(*) into v_have from public.registers r where r.business_id = p_business and r.active and r.unit_id = u.id;
      while v_have < u.registers loop
        -- a till made at registration ("Arka 1") without a unit goes to the first unit
        select r.id into v_free from public.registers r where r.business_id = p_business and r.active and r.unit_id is null order by r.created_at limit 1;
        if v_free is not null then
          update public.registers set unit_id = u.id, name = case when v_multi then left(u.name || ' · ' || name, 60) else name end where id = v_free;
        else
          insert into public.registers (business_id, name, unit_id)
          values (p_business, left(case when v_multi then u.name || ' · Arka ' || (v_have + 1) else 'Arka ' || (v_have + 1) end, 60), u.id);
        end if;
        v_have := v_have + 1;
      end loop;
    end loop;
    select count(*) into v_want from public.registers where business_id = p_business and active;
  else
    select least(20, greatest(1, coalesce((b.registration->>'registers')::int, 1))) into v_want from public.businesses b where b.id = p_business;
    select count(*) into v_have from public.registers r where r.business_id = p_business and r.active;
    while v_have < v_want loop
      v_have := v_have + 1;
      insert into public.registers (business_id, name) values (p_business, 'Arka ' || v_have);
    end loop;
  end if;
  update public.business_licenses set max_devices = greatest(max_devices, v_want), updated_at = now()
   where business_id = p_business and max_devices < v_want;
end $$;

-- Approval also approves the units still waiting (a unit the admin rejected stays rejected).
create or replace function public.platform_decide(p_business uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  v_status text;
begin
  perform public._require_platform_admin();
  select * into b from public.businesses where id = p_business for update;
  if not found then raise exception 'Biznesi nuk u gjet' using errcode = 'P0002'; end if;
  v_status := case p_action
    when 'approve' then 'active'
    when 'reject' then 'rejected'
    when 'request_info' then 'needs_info'
    when 'suspend' then 'suspended'
    when 'reactivate' then 'active'
  end;
  if v_status is null then raise exception 'Veprimi nuk vlen' using errcode = '22023'; end if;
  if p_action in ('reject', 'request_info') and coalesce(trim(p_note), '') = '' then
    raise exception 'Shkruaj arsyen / çka duhet të plotësojë klienti' using errcode = '22023';
  end if;
  if p_action = 'approve' and exists (select 1 from public.business_units where business_id = b.id)
     and not exists (select 1 from public.business_units where business_id = b.id and status <> 'rejected') then
    raise exception 'Të gjitha njësitë janë refuzuar – aprovo të paktën një njësi' using errcode = '22023';
  end if;
  update public.businesses
     set status = v_status, status_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now(), decided_by = auth.uid()
   where id = b.id;
  if p_action in ('approve', 'reactivate') then
    update public.business_licenses set status = 'active', starts_on = coalesce(starts_on, public._local_date()), updated_at = now(), updated_by = auth.uid()
     where business_id = b.id;
  end if;
  if p_action = 'approve' then
    update public.business_units set status = 'approved', updated_at = now() where business_id = b.id and status = 'pending';
    perform public._ensure_registers(b.id);
  end if;
  perform public._business_sync_active(b.id);
  insert into public.business_events (business_id, action, note, by_user) values (b.id, p_action, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), 'business_' || p_action, 'business', b.id::text, jsonb_build_object('status', v_status, 'note', p_note));
  return jsonb_build_object('status', v_status, 'active', (select active from public.businesses where id = b.id));
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public._application_open(uuid), public._ensure_registers(uuid) from public, anon, authenticated;
-- used inside the RLS / storage policies; both only answer about the caller's own business
grant execute on function public._application_open(uuid), public._owner_business() to authenticated;
revoke execute on function public.registration_nui_taken(text) from public;
grant execute on function public.registration_nui_taken(text) to anon, authenticated;
revoke execute on function public.owner_application(), public.owner_application_save(jsonb), public.owner_document_add(text, text, text, text, bigint),
  public.owner_document_remove(uuid), public.platform_application_extra(uuid), public.platform_unit_decide(uuid, text),
  public.platform_activity_save(uuid, text, boolean, int) from public, anon;
grant execute on function public.owner_application(), public.owner_application_save(jsonb), public.owner_document_add(text, text, text, text, bigint),
  public.owner_document_remove(uuid), public.platform_application_extra(uuid), public.platform_unit_decide(uuid, text),
  public.platform_activity_save(uuid, text, boolean, int) to authenticated;
grant select on public.business_activities to anon, authenticated;
grant select on public.business_units, public.business_documents to authenticated;
