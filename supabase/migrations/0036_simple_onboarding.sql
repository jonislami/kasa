-- =====================================================================
-- 0036 – A simpler start for new clients: the client fills everything at registration, the platform admin only approves.
--   * No payment step: "Aprovo" opens the business right away (status 'active'); the license has no expiry unless the
--     admin sets one. Businesses that waited for payment ('approved') become active.
--   * No separate "Apliko për arkë": approval creates the tills the client asked for at registration
--     (registration.registers) and raises the license's device limit to that number when needed.
--   * The owner takes the activation key for each till from their own panel (/llogaria) – the admin no longer sends keys.
--     A new key for a till cancels that till's unused key; keys are shown once and only their SHA-256 is stored.
-- Old clients keep working: every existing RPC stays with the same signature.
-- =====================================================================

-- Install SEF: an active business may install (no approved till application needed any more).
create or replace function public._can_install(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select b.active and b.status = 'active' from public.businesses b where b.id = p_business
$$;

-- Tills the client asked for at registration; called on approval.
create or replace function public._ensure_registers(p_business uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_want int;
  v_have int;
begin
  select least(20, greatest(1, coalesce((b.registration->>'registers')::int, 1))) into v_want from public.businesses b where b.id = p_business;
  select count(*) into v_have from public.registers r where r.business_id = p_business and r.active;
  while v_have < v_want loop
    v_have := v_have + 1;
    insert into public.registers (business_id, name) values (p_business, 'Arka ' || v_have);
  end loop;
  update public.business_licenses set max_devices = greatest(max_devices, v_want), updated_at = now()
   where business_id = p_business and max_devices < v_want;
end $$;

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
  update public.businesses
     set status = v_status, status_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now(), decided_by = auth.uid()
   where id = b.id;
  if p_action in ('approve', 'reactivate') then
    update public.business_licenses set status = 'active', starts_on = coalesce(starts_on, public._local_date()), updated_at = now(), updated_by = auth.uid()
     where business_id = b.id;
  end if;
  if p_action = 'approve' then
    perform public._ensure_registers(b.id);
  end if;
  perform public._business_sync_active(b.id);
  insert into public.business_events (business_id, action, note, by_user) values (b.id, p_action, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (null, auth.uid(), 'business_' || p_action, 'business', b.id::text, jsonb_build_object('status', v_status, 'note', p_note));
  return jsonb_build_object('status', v_status, 'active', (select active from public.businesses where id = b.id));
end $$;

-- The plain key, generated once; shared by the owner's function (the admin's keeps its own copy from 0030).
create or replace function public._activation_key_issue(p_business uuid, p_register uuid, p_label text, p_days int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 32 symbols without I, O, 0, 1; 256 % 32 = 0, so every symbol is equally likely
  v_abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_raw text := '';
  v_id uuid;
  v_exp timestamptz := now() + make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
  i int;
begin
  for i in 0..11 loop
    v_raw := v_raw || substr(v_abc, get_byte(v_bytes, i) % 32 + 1, 1);
  end loop;
  insert into public.activation_keys (business_id, register_id, key_hash, key_hint, label, created_by, expires_at)
  values (p_business, p_register, public._activation_key_hash(v_raw), right(v_raw, 4), nullif(trim(p_label), ''), auth.uid(), v_exp)
  returning id into v_id;
  insert into public.business_events (business_id, action, note, by_user)
  values (p_business, 'activation_key', concat_ws(' · ', 'Çelës …' || right(v_raw, 4), nullif(trim(p_label), '')), auth.uid());
  return jsonb_build_object('id', v_id, 'key', 'KASA-' || substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4), 'expires_at', v_exp);
end $$;

-- Owner: the tills of the business with the state of their key and device.
create or replace function public.owner_registers()
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
    'max_devices', (public._license_state(v_b)->>'max_devices')::int,
    'registers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'name', r.name,
               'device', (select d.name from public.devices d where d.register_id = r.id and d.active order by d.last_seen_at desc nulls last limit 1),
               'device_seen', (select max(d.last_seen_at) from public.devices d where d.register_id = r.id and d.active),
               'key_hint', k.key_hint, 'key_expires', k.expires_at)
             order by r.created_at, r.name)
        from public.registers r
        left join lateral (
          select x.key_hint, x.expires_at from public.activation_keys x
           where x.register_id = r.id and x.used_at is null and x.revoked_at is null and x.expires_at > now()
           order by x.created_at desc limit 1) k on true
       where r.business_id = v_b and r.active), '[]'::jsonb));
end $$;

-- Owner: a key for one till (shown once). An unused earlier key of that till stops working.
create or replace function public.owner_activation_key_create(p_register uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  v_name text;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  if not public._can_install(v_b) then
    raise exception 'Çelësi merret pasi të aprovohet biznesi' using errcode = '22023';
  end if;
  select name into v_name from public.registers where id = p_register and business_id = v_b and active;
  if v_name is null then raise exception 'Arka nuk u gjet' using errcode = 'P0002'; end if;
  update public.activation_keys set revoked_at = now()
   where register_id = p_register and business_id = v_b and used_at is null and revoked_at is null;
  return public._activation_key_issue(v_b, p_register, v_name, 30);
end $$;

-- Owner: one more till, up to the license's device limit.
create or replace function public.owner_register_add(p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b uuid := public._owner_business();
  v_count int;
  v_max int;
  v_id uuid;
begin
  if v_b is null then raise exception 'Vetëm pronari i biznesit' using errcode = '42501'; end if;
  if not public._can_install(v_b) then raise exception 'Arkat shtohen pasi të aprovohet biznesi' using errcode = '22023'; end if;
  select count(*) into v_count from public.registers where business_id = v_b and active;
  v_max := (public._license_state(v_b)->>'max_devices')::int;
  if v_count >= v_max then
    raise exception 'Licenca lejon % arka. Për më shumë kontakto administratorin e Kasa-s.', v_max using errcode = 'P0001';
  end if;
  insert into public.registers (business_id, name)
  values (v_b, left(coalesce(nullif(trim(p_name), ''), 'Arka ' || (v_count + 1)), 60))
  returning id into v_id;
  insert into public.business_events (business_id, action, note, by_user) values (v_b, 'register_added', 'Arka ' || (v_count + 1), auth.uid());
  return v_id;
end $$;

-- Businesses that waited for payment are open now.
do $$
declare r record;
begin
  for r in select id from public.businesses where status = 'approved' loop
    update public.businesses set status = 'active' where id = r.id;
    perform public._ensure_registers(r.id);
    perform public._business_sync_active(r.id);
  end loop;
end $$;

revoke execute on function public._ensure_registers(uuid), public._activation_key_issue(uuid, uuid, text, int) from public, anon, authenticated;
revoke execute on function public.owner_registers(), public.owner_activation_key_create(uuid), public.owner_register_add(text) from public, anon;
grant execute on function public.owner_registers(), public.owner_activation_key_create(uuid), public.owner_register_add(text) to authenticated;
