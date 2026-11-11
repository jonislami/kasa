-- 0030: activation keys for the installed SEF app (Windows, Android, iPhone).
-- The platform admin generates a key for a business (optionally for one till) and sends it to the client.
-- The installed app asks for the key once: it links the device to the business exactly like link_device()
-- does after a manager's e-mail sign-in, so the PIN screen (pin-login) works unchanged.
-- Keys are one-time, expire, and only their SHA-256 is stored; the plain key is shown once.

create table if not exists public.activation_keys (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses (id) on delete cascade,
  register_id uuid references public.registers (id) on delete set null,
  key_hash    text not null unique,
  key_hint    text not null,                 -- last 4 characters, to recognise a key in the list
  label       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  device_id   uuid,
  revoked_at  timestamptz
);
create index if not exists activation_keys_business_idx on public.activation_keys (business_id);

-- Only through the functions below (no direct access for anyone).
alter table public.activation_keys enable row level security;

-- "KASA-ABCD-EFGH-JKLM", "abcd efgh jklm" → "ABCDEFGHJKLM"
create or replace function public._activation_key_norm(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(regexp_replace(upper(coalesce(p_key, '')), '[^A-Z0-9]', '', 'g'), '^KASA(?=[A-Z0-9]{12}$)', '')
$$;

create or replace function public._activation_key_hash(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(public._activation_key_norm(p_key), 'sha256'), 'hex')
$$;

-- p_business, p_register (optional), p_label (optional), p_days (1–90, default 30) → { id, key, expires_at }
create or replace function public.platform_activation_key_create(p_business uuid, p_register uuid default null, p_label text default null, p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 32 symbols without I, O, 0, 1 (easy to read and type); 256 % 32 = 0, so every symbol is equally likely
  v_abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_raw text := '';
  v_id uuid;
  v_exp timestamptz := now() + make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
  i int;
begin
  perform public._require_platform_admin();
  if not exists (select 1 from public.businesses where id = p_business and status = 'active') then
    raise exception 'Çelësi jepet vetëm për biznes aktiv (i aprovuar dhe i paguar)' using errcode = '22023';
  end if;
  if p_register is not null and not exists (select 1 from public.registers where id = p_register and business_id = p_business) then
    raise exception 'Arka nuk i përket këtij biznesi' using errcode = '22023';
  end if;
  for i in 0..11 loop
    v_raw := v_raw || substr(v_abc, get_byte(v_bytes, i) % 32 + 1, 1);
  end loop;
  insert into public.activation_keys (business_id, register_id, key_hash, key_hint, label, created_by, expires_at)
  values (p_business, p_register, public._activation_key_hash(v_raw), right(v_raw, 4), nullif(trim(p_label), ''), auth.uid(), v_exp)
  returning id into v_id;
  insert into public.business_events (business_id, action, note, by_user)
  values (p_business, 'activation_key', concat_ws(' · ', 'Çelës …' || right(v_raw, 4), nullif(trim(p_label), '')), auth.uid());
  return jsonb_build_object(
    'id', v_id,
    'key', 'KASA-' || substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4),
    'expires_at', v_exp);
end $$;

create or replace function public.platform_activation_keys(p_business uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', k.id, 'hint', k.key_hint, 'label', k.label, 'register', r.name, 'created_at', k.created_at,
             'expires_at', k.expires_at, 'used_at', k.used_at, 'device', d.name, 'device_active', d.active,
             'status', case when k.revoked_at is not null then 'revoked'
                            when k.used_at is not null then 'used'
                            when k.expires_at < now() then 'expired'
                            else 'open' end)
           order by k.created_at desc)
      from public.activation_keys k
      left join public.registers r on r.id = k.register_id
      left join public.devices d on d.id = k.device_id
     where k.business_id = p_business), '[]'::jsonb);
end $$;

create or replace function public.platform_activation_key_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_platform_admin();
  update public.activation_keys set revoked_at = now() where id = p_id and used_at is null and revoked_at is null;
  if not found then raise exception 'Çelësi është përdorur ose anuluar tashmë' using errcode = '22023'; end if;
end $$;

-- Called by the installed app before anyone is signed in (anon).
-- p: { key, device_id, name?, platform?, app_version?, user_agent? } → { device_id, secret, business_id, business_name, register_id }
create or replace function public.activate_device(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.activation_keys;
  b public.businesses;
  v_id uuid;
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
  v_platform text := coalesce(nullif(p->>'platform', ''), 'web');
begin
  begin
    v_id := nullif(p->>'device_id', '')::uuid;
  exception when others then
    v_id := null;
  end;
  if v_id is null then raise exception 'Mungon ID e pajisjes' using errcode = '22023'; end if;
  if length(public._activation_key_norm(p->>'key')) <> 12 then
    raise exception 'Çelësi ka 12 shenja, p.sh. KASA-ABCD-EFGH-JKLM' using errcode = 'P0001', hint = 'activation_key';
  end if;

  select * into k from public.activation_keys where key_hash = public._activation_key_hash(p->>'key') for update;
  if not found then
    perform pg_sleep(0.5); -- slows down guessing
    raise exception 'Çelësi nuk është i saktë' using errcode = 'P0001', hint = 'activation_key';
  end if;
  if k.revoked_at is not null then raise exception 'Ky çelës është anuluar. Kërko çelës të ri.' using errcode = 'P0001', hint = 'activation_key'; end if;
  if k.used_at is not null then raise exception 'Ky çelës është përdorur njëherë. Kërko çelës të ri.' using errcode = 'P0001', hint = 'activation_key'; end if;
  if k.expires_at < now() then raise exception 'Çelësi ka skaduar. Kërko çelës të ri.' using errcode = 'P0001', hint = 'activation_key'; end if;

  select * into b from public.businesses where id = k.business_id;
  if not b.active then
    raise exception 'Biznesi nuk është aktiv. Kontakto administratorin e Kasa-s.' using errcode = 'P0001', hint = 'activation_key';
  end if;

  if v_platform not in ('web', 'electron', 'capacitor') then v_platform := 'web'; end if;
  if exists (select 1 from public.devices where id = v_id and business_id <> b.id) then
    delete from public.devices where id = v_id; -- the installation moves to another business
  end if;
  insert into public.devices (id, business_id, register_id, name, platform, app_version, user_agent, secret_hash, linked_by, last_user_id)
  values (v_id, b.id, k.register_id, coalesce(nullif(trim(p->>'name'), ''), 'Pajisje'), v_platform,
          nullif(p->>'app_version', ''), left(nullif(p->>'user_agent', ''), 300),
          extensions.crypt(v_secret, extensions.gen_salt('bf', 8)), k.created_by, null)
  on conflict (id) do update set
    secret_hash = excluded.secret_hash, active = true, linked_by = excluded.linked_by, linked_at = now(),
    last_seen_at = now(), platform = excluded.platform, app_version = excluded.app_version, user_agent = excluded.user_agent,
    register_id = coalesce(excluded.register_id, public.devices.register_id);

  update public.activation_keys set used_at = now(), device_id = v_id where id = k.id;
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (b.id, null, 'device_link', 'device', v_id::text,
          jsonb_build_object('platform', v_platform, 'app_version', p->>'app_version', 'activation_key', k.key_hint));
  insert into public.business_events (business_id, action, note, by_user)
  values (b.id, 'device_activated', concat_ws(' · ', coalesce(nullif(trim(p->>'name'), ''), 'Pajisje'), 'çelësi …' || k.key_hint), null);

  return jsonb_build_object('device_id', v_id, 'secret', v_secret, 'business_id', b.id, 'business_name', b.name, 'register_id', k.register_id);
end $$;

revoke execute on function public._activation_key_norm(text), public._activation_key_hash(text) from public, anon, authenticated;
revoke execute on function public.platform_activation_key_create(uuid, uuid, text, int), public.platform_activation_keys(uuid),
  public.platform_activation_key_revoke(uuid), public.activate_device(jsonb) from public;
-- Supabase grants new functions to anon by default: the admin functions are for signed-in admins only
revoke execute on function public.platform_activation_key_create(uuid, uuid, text, int), public.platform_activation_keys(uuid),
  public.platform_activation_key_revoke(uuid) from anon;
grant execute on function public.platform_activation_key_create(uuid, uuid, text, int), public.platform_activation_keys(uuid),
  public.platform_activation_key_revoke(uuid) to authenticated;
grant execute on function public.activate_device(jsonb) to anon, authenticated;
