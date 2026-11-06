-- =====================================================================
-- 0005 – Users, PINs, devices (phase 6). Run after 0001–0004.
--
--   * workers are created by the Edge Function `business-users` (auth user + profile);
--     editing, PINs and (de)activation go through the RPCs below
--   * a device is linked to the business when a manager signs in with email on it:
--     link_device() returns a secret that only that device keeps (encrypted)
--   * PIN login: Edge Function `pin-login` calls pin_device_workers / pin_check
--     (service_role only) – bcrypt, 5 wrong PINs → locked for 15 minutes
--   * role rules: managers manage workers; only the owner (admin) manages managers;
--     nobody changes the owner's role or deactivates themself
-- =====================================================================

alter table public.profiles add column if not exists login_kind text not null default 'email'
  check (login_kind in ('email', 'pin'));
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists last_pin_login_at timestamptz;

-- profiles: the new columns are readable like the others (never pin_hash)
grant select (login_kind, phone, last_pin_login_at) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- Devices (one row per installation linked to a business)
-- ---------------------------------------------------------------------
create table if not exists public.devices (
  id            uuid primary key,                          -- device.getDeviceId() on the client
  business_id   uuid not null default public.current_business_id()
                references public.businesses (id) on delete cascade,
  register_id   uuid references public.registers (id) on delete set null,
  name          text not null default 'Pajisje',
  platform      text not null default 'web' check (platform in ('web', 'electron', 'capacitor')),
  app_version   text,
  user_agent    text,
  secret_hash   text not null,
  active        boolean not null default true,
  linked_by     uuid references auth.users (id),
  linked_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  last_user_id  uuid references auth.users (id)
);
create index if not exists devices_business_idx on public.devices (business_id);

alter table public.devices enable row level security;
drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices for select to authenticated
  using (business_id = public.current_business_id() and public.is_manager());
revoke all on public.devices from anon, authenticated;
grant select (id, business_id, register_id, name, platform, app_version, user_agent, active, linked_by, linked_at, last_seen_at, last_user_id)
  on public.devices to authenticated;

-- my_context: phone + fiscal number for the receipt
create or replace function public.my_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_platform_admin', public.is_platform_admin(),
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'business_id', p.business_id, 'role', p.role,
        'full_name', p.full_name, 'email', p.email, 'active', p.active, 'login_kind', p.login_kind
      )
      from public.profiles p where p.id = auth.uid()
    ),
    'business', (
      select jsonb_build_object(
        'id', b.id, 'name', b.name, 'type', b.type, 'active', b.active,
        'city', b.city, 'address', b.address, 'phone', b.phone, 'nui', b.nui,
        'vat_number', b.vat_number, 'fiscal_number', b.fiscal_number
      )
      from public.profiles p
      join public.businesses b on b.id = p.business_id
      where p.id = auth.uid()
    )
  )
$$;

-- ---------------------------------------------------------------------
-- Helpers: may the caller manage this person?
-- ---------------------------------------------------------------------
create or replace function public._can_manage(p_target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.user_role := public.current_role_in_business();
  v_target public.profiles%rowtype;
begin
  if v_me is null or v_me not in ('admin', 'manager') then
    return false;
  end if;
  select * into v_target from public.profiles where id = p_target and business_id = public.current_business_id();
  if not found then
    return false;
  end if;
  if v_target.role = 'worker' then
    return true;
  end if;
  -- managers / admins: only the owner, and never another admin
  return v_me = 'admin' and v_target.role = 'manager';
end $$;
revoke execute on function public._can_manage(uuid) from public, anon, authenticated;

create or replace function public._check_pin(p_pin text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_pin is null or p_pin !~ '^\d{4}$' then
    raise exception 'PIN-i duhet të ketë 4 shifra' using errcode = '22023';
  end if;
  if p_pin in ('0000', '1111', '1234', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '4321') then
    raise exception 'Ky PIN është shumë i thjeshtë' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Users of the business (list for Settings → Përdoruesit & PIN-et)
-- ---------------------------------------------------------------------
create or replace function public.business_users()
returns table (
  id uuid, full_name text, email text, role public.user_role, login_kind text, phone text, active boolean,
  commission_pct numeric, has_pin boolean, pin_locked boolean, last_pin_login_at timestamptz,
  last_sign_in_at timestamptz, created_at timestamptz, can_manage boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name, case when p.login_kind = 'pin' then null else p.email end, p.role, p.login_kind, p.phone, p.active,
         p.commission_pct, p.pin_hash is not null, coalesce(p.pin_locked_until > now(), false), p.last_pin_login_at,
         u.last_sign_in_at, p.created_at, public._can_manage(p.id)
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.business_id = public.current_business_id()
  order by case p.role when 'admin' then 0 when 'manager' then 1 else 2 end, p.active desc, p.full_name;
end $$;

-- p: { id, full_name?, role?, commission_pct?, phone?, active? }
create or replace function public.update_business_user(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.profiles%rowtype;
  v_role public.user_role;
begin
  if v_id is null or not public._can_manage(v_id) then
    raise exception 'Nuk ke të drejtë ta ndryshosh këtë përdorues' using errcode = '42501';
  end if;
  select * into v_old from public.profiles where id = v_id for update;
  v_role := coalesce(nullif(p->>'role', '')::public.user_role, v_old.role);
  if v_role = 'admin' then
    raise exception 'Pronari është vetëm një' using errcode = '42501';
  end if;
  if v_role = 'manager' and public.current_role_in_business() <> 'admin' then
    raise exception 'Vetëm pronari cakton menaxherë' using errcode = '42501';
  end if;
  if v_id = auth.uid() then
    raise exception 'Llogarinë tënde e ndryshon pronari' using errcode = '42501';
  end if;
  if p ? 'full_name' and length(trim(p->>'full_name')) = 0 then
    raise exception 'Shkruaj emrin' using errcode = '22023';
  end if;
  if p ? 'commission_pct' and ((p->>'commission_pct')::numeric < 0 or (p->>'commission_pct')::numeric > 100) then
    raise exception 'Komisioni duhet të jetë 0–100%%' using errcode = '22023';
  end if;
  if v_role = 'manager' and v_old.login_kind = 'pin' then
    raise exception 'Menaxheri ka nevojë për email (krijoje si menaxher me email)' using errcode = '22023';
  end if;

  update public.profiles set
    full_name = coalesce(nullif(trim(p->>'full_name'), ''), full_name),
    role = v_role,
    commission_pct = coalesce(round((p->>'commission_pct')::numeric, 2), commission_pct),
    phone = case when p ? 'phone' then nullif(trim(p->>'phone'), '') else phone end,
    active = coalesce((p->>'active')::boolean, active)
  where id = v_id;

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(),
          case when (p->>'active')::boolean is false and v_old.active then 'user_deactivate'
               when (p->>'active')::boolean is true and not v_old.active then 'user_activate'
               else 'user_update' end,
          'profile', v_id::text, jsonb_build_object(
            'name', coalesce(nullif(trim(p->>'full_name'), ''), v_old.full_name),
            'role', jsonb_build_array(v_old.role, v_role),
            'commission_pct', jsonb_build_array(v_old.commission_pct, coalesce(round((p->>'commission_pct')::numeric, 2), v_old.commission_pct))));
end $$;

-- A manager sets (or resets) someone's PIN; also unlocks it.
create or replace function public.set_user_pin(p_user uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user <> auth.uid() and not public._can_manage(p_user) then
    raise exception 'Nuk ke të drejtë ta ndryshosh këtë PIN' using errcode = '42501';
  end if;
  perform public._check_pin(p_pin);
  update public.profiles set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), pin_failed = 0, pin_locked_until = null
    where id = p_user and business_id = public.current_business_id();
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (public.current_business_id(), auth.uid(), 'pin_set', 'profile', p_user::text,
          jsonb_build_object('name', (select full_name from public.profiles where id = p_user)));
end $$;

-- Used by the Edge Function right after it creates the auth user (service_role only).
create or replace function public.admin_set_pin(p_user uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._check_pin(p_pin);
  update public.profiles set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), pin_failed = 0, pin_locked_until = null
    where id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------
-- p: { device_id, name?, platform?, app_version?, user_agent?, register_id? } → { secret, device_id }
-- Called by a manager signed in with email. Re-linking the same device replaces its secret.
create or replace function public.link_device(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_id uuid := nullif(p->>'device_id', '')::uuid;
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
  v_register uuid := nullif(p->>'register_id', '')::uuid;
  v_platform text := coalesce(nullif(p->>'platform', ''), 'web');
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Pajisjen e lidh vetëm pronari ose menaxheri' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'Mungon ID e pajisjes' using errcode = '22023';
  end if;
  if v_platform not in ('web', 'electron', 'capacitor') then v_platform := 'web'; end if;
  if v_register is not null and not exists (select 1 from public.registers where id = v_register and business_id = v_business) then
    v_register := null;
  end if;
  if exists (select 1 from public.devices where id = v_id and business_id <> v_business) then
    -- The same installation moves to another business: the old link is removed.
    delete from public.devices where id = v_id;
  end if;

  insert into public.devices (id, business_id, register_id, name, platform, app_version, user_agent, secret_hash, linked_by, last_user_id)
  values (v_id, v_business, v_register, coalesce(nullif(trim(p->>'name'), ''), 'Pajisje'), v_platform,
          nullif(p->>'app_version', ''), left(nullif(p->>'user_agent', ''), 300),
          extensions.crypt(v_secret, extensions.gen_salt('bf', 8)), auth.uid(), auth.uid())
  on conflict (id) do update set
    secret_hash = excluded.secret_hash, active = true, linked_by = excluded.linked_by, linked_at = now(),
    last_seen_at = now(), last_user_id = excluded.last_user_id, platform = excluded.platform,
    app_version = excluded.app_version, user_agent = excluded.user_agent,
    register_id = coalesce(excluded.register_id, public.devices.register_id),
    name = case when p ? 'name' then excluded.name else public.devices.name end;

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'device_link', 'device', v_id::text,
          jsonb_build_object('platform', v_platform, 'app_version', p->>'app_version'));
  return jsonb_build_object('device_id', v_id, 'secret', v_secret);
end $$;

-- p: { device_id, name?, register_id?, active? } – managers rename / assign a register / block a device
create or replace function public.update_device(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_id uuid := nullif(p->>'device_id', '')::uuid;
  v_register uuid := nullif(p->>'register_id', '')::uuid;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm admini ose menaxheri' using errcode = '42501';
  end if;
  if v_register is not null and not exists (select 1 from public.registers where id = v_register and business_id = v_business) then
    raise exception 'Arka nuk u gjet' using errcode = 'P0002';
  end if;
  update public.devices set
    name = coalesce(nullif(trim(p->>'name'), ''), name),
    register_id = case when p ? 'register_id' then v_register else register_id end,
    active = coalesce((p->>'active')::boolean, active)
  where id = v_id and business_id = v_business;
  if not found then
    raise exception 'Pajisja nuk u gjet' using errcode = 'P0002';
  end if;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), case when (p->>'active')::boolean is false then 'device_block' else 'device_update' end,
          'device', v_id::text, p - 'device_id');
end $$;

-- Any signed-in user of the business: "this device is alive" (+ version). Returns the device row or null.
create or replace function public.device_heartbeat(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_row public.devices%rowtype;
begin
  if v_business is null then
    return null;
  end if;
  update public.devices set last_seen_at = now(), last_user_id = auth.uid(),
         app_version = coalesce(nullif(p->>'app_version', ''), app_version)
  where id = nullif(p->>'device_id', '')::uuid and business_id = v_business
  returning * into v_row;
  if not found then
    return null;
  end if;
  return jsonb_build_object('device_id', v_row.id, 'register_id', v_row.register_id, 'name', v_row.name, 'active', v_row.active);
end $$;

-- ---------------------------------------------------------------------
-- PIN login (service_role only – called by the Edge Function `pin-login`)
-- ---------------------------------------------------------------------
create or replace function public._device_business(p_device uuid, p_secret text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.business_id
  from public.devices d
  join public.businesses b on b.id = d.business_id
  where d.id = p_device and d.active and b.active
    and d.secret_hash = extensions.crypt(coalesce(p_secret, ''), d.secret_hash)
$$;
revoke execute on function public._device_business(uuid, text) from public, anon, authenticated;

-- → { business: {id, name, type}, workers: [{id, full_name, role, has_pin, locked}] } or null if the device is not valid
create or replace function public.pin_device_workers(p_device uuid, p_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._device_business(p_device, p_secret);
begin
  if v_business is null then
    return null;
  end if;
  return jsonb_build_object(
    'business', (select jsonb_build_object('id', b.id, 'name', b.name, 'type', b.type) from public.businesses b where b.id = v_business),
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role,
                                          'has_pin', p.pin_hash is not null,
                                          'locked', coalesce(p.pin_locked_until > now(), false))
                       order by case p.role when 'worker' then 0 else 1 end, p.full_name)
      from public.profiles p
      where p.business_id = v_business and p.active
    ), '[]'::jsonb)
  );
end $$;

-- → { ok: true, email } | { ok: false, error: 'device'|'not_found'|'no_pin'|'locked'|'wrong_pin', left?, until? }
create or replace function public.pin_check(p_device uuid, p_secret text, p_user uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public._device_business(p_device, p_secret);
  v_p public.profiles%rowtype;
  v_email text;
begin
  if v_business is null then
    return jsonb_build_object('ok', false, 'error', 'device');
  end if;
  select * into v_p from public.profiles where id = p_user and business_id = v_business and active for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_p.pin_hash is null then
    return jsonb_build_object('ok', false, 'error', 'no_pin');
  end if;
  if v_p.pin_locked_until is not null and v_p.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'until', v_p.pin_locked_until);
  end if;

  if v_p.pin_hash = extensions.crypt(coalesce(p_pin, ''), v_p.pin_hash) then
    update public.profiles set pin_failed = 0, pin_locked_until = null, last_pin_login_at = now() where id = p_user;
    update public.devices set last_seen_at = now(), last_user_id = p_user where id = p_device;
    insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
    values (v_business, p_user, 'pin_login', 'device', p_device::text, '{}'::jsonb);
    select email into v_email from auth.users where id = p_user;
    return jsonb_build_object('ok', true, 'email', v_email);
  end if;

  update public.profiles set
    pin_failed = pin_failed + 1,
    pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '15 minutes' else null end
  where id = p_user;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, p_user, 'login_failed', 'device', p_device::text, jsonb_build_object('attempt', v_p.pin_failed + 1, 'method', 'pin'));
  if v_p.pin_failed + 1 >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked', 'until', now() + interval '15 minutes');
  end if;
  return jsonb_build_object('ok', false, 'error', 'wrong_pin', 'left', 5 - (v_p.pin_failed + 1));
end $$;

revoke execute on function public.admin_set_pin(uuid, text) from public, anon, authenticated;
revoke execute on function public.pin_device_workers(uuid, text) from public, anon, authenticated;
revoke execute on function public.pin_check(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_pin(uuid, text) to service_role;
grant execute on function public.pin_device_workers(uuid, text) to service_role;
grant execute on function public.pin_check(uuid, text, uuid, text) to service_role;

revoke execute on function public.business_users() from public, anon;
revoke execute on function public.update_business_user(jsonb) from public, anon;
revoke execute on function public.set_user_pin(uuid, text) from public, anon;
revoke execute on function public.link_device(jsonb) from public, anon;
revoke execute on function public.update_device(jsonb) from public, anon;
revoke execute on function public.device_heartbeat(jsonb) from public, anon;
grant execute on function public.business_users() to authenticated;
grant execute on function public.update_business_user(jsonb) to authenticated;
grant execute on function public.set_user_pin(uuid, text) to authenticated;
grant execute on function public.link_device(jsonb) to authenticated;
grant execute on function public.update_device(jsonb) to authenticated;
grant execute on function public.device_heartbeat(jsonb) to authenticated;
