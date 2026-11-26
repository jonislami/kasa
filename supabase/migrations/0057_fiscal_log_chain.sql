-- =====================================================================
-- 0057 – ATK logs (testimi teknik 21.01.2027): "te log-at për ATK-në duhet implementuar PayLoad, Hash Chain
-- (Current Hash, Previous Hash dhe Integrity Check)".
-- 1. fiscal_log (every call to ATK) gets:
--      payload   – what was sent to ATK: {"details": base64(PosCoupon), "signature": …} for a coupon,
--                  filled from fiscal_coupons by the trigger (the Edge Function stays as it is);
--      prev_hash – hash of the previous row of the same business;
--      hash      – sha256(prev_hash | business | sale | env | action | ok | http_status | coupon_id | message |
--                  payload | created_at).
--    register_id and user_id are left out of the hash: they become null when a register / user is removed
--    (on delete set null) and that must not look like tampering.
-- 2. fiscal_verify() – the whole chain checked, as audit_verify() (0034) does for audit_log.
-- 3. audit_chain(from, to) and fiscal_chain(from, to) – Previous Hash, Current Hash and Integrity Check of every
--    row in a period, for the screen and the CSV / PDF of the audit report.
-- Older rows stay as they were (hash null); the chain starts with the first row written after this migration.
-- =====================================================================

alter table public.fiscal_log add column if not exists payload text;
alter table public.fiscal_log add column if not exists prev_hash text;
alter table public.fiscal_log add column if not exists hash text;

create or replace function public._fiscal_row_hash(prev text, r public.fiscal_log)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    coalesce(prev, ''), r.business_id::text, coalesce(r.sale_id::text, ''), r.env, r.action, r.ok::text,
    coalesce(r.http_status::text, ''), coalesce(r.coupon_id::text, ''), coalesce(r.message, ''), coalesce(r.payload, ''),
    to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex');
$$;

create or replace function public._fiscal_log_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text;
begin
  -- the payload of a coupon: exactly what goes to ATK's /pos/coupon
  if new.payload is null and new.action = 'coupon' and new.sale_id is not null then
    select jsonb_build_object('details', c.details, 'signature', c.signature)::text into new.payload
    from public.fiscal_coupons c where c.sale_id = new.sale_id;
  end if;
  -- one writer at a time per business, so the chain has no forks
  perform pg_advisory_xact_lock(hashtext('fiscal_log:' || new.business_id::text));
  select l.hash into v_prev from public.fiscal_log l
  where l.business_id = new.business_id and l.hash is not null
  order by l.id desc limit 1;
  new.prev_hash := v_prev;
  new.hash := public._fiscal_row_hash(v_prev, new);
  return new;
end $$;

drop trigger if exists fiscal_log_chain on public.fiscal_log;
create trigger fiscal_log_chain before insert on public.fiscal_log
  for each row execute function public._fiscal_log_chain();

-- The whole chain of the current business (owner / manager).
create or replace function public.fiscal_verify()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  r public.fiscal_log;
  v_prev text := null;
  v_checked int := 0;
  v_broken jsonb := '[]'::jsonb;
  v_first timestamptz;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm pronari ose menaxheri' using errcode = '42501';
  end if;
  for r in select * from public.fiscal_log where business_id = v_business and hash is not null order by id loop
    v_checked := v_checked + 1;
    if v_first is null then v_first := r.created_at; end if;
    if (v_checked > 1 and r.prev_hash is distinct from v_prev) or r.hash <> public._fiscal_row_hash(r.prev_hash, r) then
      v_broken := v_broken || jsonb_build_object('id', r.id, 'action', r.action, 'created_at', r.created_at);
    end if;
    v_prev := r.hash;
  end loop;
  return jsonb_build_object('checked', v_checked, 'since', v_first, 'broken', v_broken, 'ok', jsonb_array_length(v_broken) = 0);
end $$;

-- Integrity of every row in a period: its hash recomputed and its link to the row before it.
-- intact is null for rows written before the chain existed.
create or replace function public.audit_chain(p_from timestamptz, p_to timestamptz)
returns table (id bigint, prev_hash text, hash text, intact boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_start bigint;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm pronari ose menaxheri' using errcode = '42501';
  end if;
  -- the chain from the last row before the period, so the first row of the period is checked against it
  select coalesce(max(a.id), 0) into v_start from public.audit_log a
  where a.business_id = v_business and a.hash is not null and a.created_at < p_from;
  return query
  select x.id, x.prev_hash, x.hash, x.intact from (
    select a.id, a.prev_hash, a.hash, a.created_at,
      case when a.hash is null then null
           else a.hash = public._audit_row_hash(a.prev_hash, a)
                and (a.id = v_start or a.prev_hash is not distinct from lag(a.hash) over (order by a.id)) end as intact
    from public.audit_log a
    where a.business_id = v_business and a.id >= v_start and (a.hash is not null or a.created_at >= p_from)
  ) x
  where x.created_at >= p_from and x.created_at < p_to;
end $$;

create or replace function public.fiscal_chain(p_from timestamptz, p_to timestamptz)
returns table (id bigint, prev_hash text, hash text, intact boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_start bigint;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm pronari ose menaxheri' using errcode = '42501';
  end if;
  select coalesce(max(l.id), 0) into v_start from public.fiscal_log l
  where l.business_id = v_business and l.hash is not null and l.created_at < p_from;
  return query
  select x.id, x.prev_hash, x.hash, x.intact from (
    select l.id, l.prev_hash, l.hash, l.created_at,
      case when l.hash is null then null
           else l.hash = public._fiscal_row_hash(l.prev_hash, l)
                and (l.id = v_start or l.prev_hash is not distinct from lag(l.hash) over (order by l.id)) end as intact
    from public.fiscal_log l
    where l.business_id = v_business and l.id >= v_start and (l.hash is not null or l.created_at >= p_from)
  ) x
  where x.created_at >= p_from and x.created_at < p_to;
end $$;

revoke execute on function public._fiscal_row_hash(text, public.fiscal_log), public._fiscal_log_chain() from public, anon, authenticated;
revoke execute on function public.fiscal_verify(), public.audit_chain(timestamptz, timestamptz), public.fiscal_chain(timestamptz, timestamptz) from public, anon;
grant execute on function public.fiscal_verify(), public.audit_chain(timestamptz, timestamptz), public.fiscal_chain(timestamptz, timestamptz) to authenticated;
