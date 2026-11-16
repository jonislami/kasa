-- =====================================================================
-- 0034 – ATK requirement (Kërkesat specifike, neni 25 pika 5.3): the audit logs "mbrohen me kriptim dhe kontroll
-- të integritetit". Every new row of audit_log is chained to the previous row of the same business:
--   hash = sha256(prev_hash | business | user | action | entity | entity_id | details | created_at)
-- so a row changed or removed afterwards breaks the chain, and audit_verify() finds where.
-- Older rows stay as they were (hash null); the chain starts with the first row written after this migration.
-- Nothing changes for the program: log_action() and every insert work as before.
-- =====================================================================

alter table public.audit_log add column if not exists prev_hash text;
alter table public.audit_log add column if not exists hash text;

create or replace function public._audit_row_hash(prev text, r public.audit_log)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    coalesce(prev, ''), coalesce(r.business_id::text, ''), coalesce(r.user_id::text, ''), r.action,
    coalesce(r.entity, ''), coalesce(r.entity_id, ''), r.details::text,
    to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex');
$$;

create or replace function public._audit_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text;
begin
  -- one writer at a time per business, so the chain has no forks
  perform pg_advisory_xact_lock(hashtext('audit:' || coalesce(new.business_id::text, 'platform')));
  select a.hash into v_prev from public.audit_log a
  where a.business_id is not distinct from new.business_id and a.hash is not null
  order by a.id desc limit 1;
  new.prev_hash := v_prev;
  new.hash := public._audit_row_hash(v_prev, new);
  return new;
end $$;

drop trigger if exists audit_log_chain on public.audit_log;
create trigger audit_log_chain before insert on public.audit_log
  for each row execute function public._audit_chain();

-- Checks the chain of the current business (owner / manager): every hash recomputed, every link to the row before.
create or replace function public.audit_verify()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  r public.audit_log;
  v_prev text := null;
  v_checked int := 0;
  v_broken jsonb := '[]'::jsonb;
  v_first timestamptz;
begin
  if v_business is null or not public.is_manager() then
    raise exception 'Vetëm pronari ose menaxheri' using errcode = '42501';
  end if;
  for r in select * from public.audit_log where business_id = v_business and hash is not null order by id loop
    v_checked := v_checked + 1;
    if v_first is null then v_first := r.created_at; end if;
    if (v_checked > 1 and r.prev_hash is distinct from v_prev) or r.hash <> public._audit_row_hash(r.prev_hash, r) then
      v_broken := v_broken || jsonb_build_object('id', r.id, 'action', r.action, 'created_at', r.created_at);
    end if;
    v_prev := r.hash;
  end loop;
  return jsonb_build_object('checked', v_checked, 'since', v_first, 'broken', v_broken, 'ok', jsonb_array_length(v_broken) = 0);
end $$;

revoke execute on function public._audit_row_hash(text, public.audit_log), public._audit_chain() from public, anon, authenticated;
revoke execute on function public.audit_verify() from public, anon;
grant execute on function public.audit_verify() to authenticated;
