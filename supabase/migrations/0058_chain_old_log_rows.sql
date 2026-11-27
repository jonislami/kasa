-- =====================================================================
-- 0058 – The rows written before the hash chains (audit_log before 0034, fiscal_log before 0057) join the chain,
-- so the audit report shows no "Pa zinxhir" rows.
--   • fiscal_log: a coupon row without payload gets it from fiscal_coupons ({"details", "signature"} – exactly what
--     was sent to ATK).
--   • Every chain (one per business; audit_log also the platform's, business_id null) is computed again from its
--     first row in id order: prev_hash = hash of the row before, hash as in 0034 / 0057. The rows already chained get
--     a new prev_hash / hash, because older rows now come before them.
-- Only payload, prev_hash and hash change; nothing is sent to ATK and no other column is touched. The old rows are
-- protected from now on: the chain is computed today, it does not prove what happened to them before.
-- audit_log is append-only (audit_log_immutable): the trigger is off only inside this transaction.
-- =====================================================================

do $$
declare
  k record;
  f public.fiscal_log;
  a public.audit_log;
  v_prev text;
  v_hash text;
begin
  -- ---------------------------------------------------------------- fiscal_log
  for k in select distinct business_id from public.fiscal_log loop
    -- the same lock as the insert trigger: a call to ATK in the meantime waits for this chain
    perform pg_advisory_xact_lock(hashtext('fiscal_log:' || k.business_id::text));
    update public.fiscal_log l
    set payload = jsonb_build_object('details', c.details, 'signature', c.signature)::text
    from public.fiscal_coupons c
    where l.business_id = k.business_id and l.payload is null and l.action = 'coupon' and l.sale_id is not null
      and c.sale_id = l.sale_id;
    v_prev := null;
    for f in select * from public.fiscal_log where business_id = k.business_id order by id loop
      v_hash := public._fiscal_row_hash(v_prev, f);
      update public.fiscal_log set prev_hash = v_prev, hash = v_hash where id = f.id;
      v_prev := v_hash;
    end loop;
  end loop;

  -- ---------------------------------------------------------------- audit_log
  alter table public.audit_log disable trigger audit_log_immutable;
  for k in select distinct business_id from public.audit_log loop
    perform pg_advisory_xact_lock(hashtext('audit:' || coalesce(k.business_id::text, 'platform')));
    v_prev := null;
    for a in select * from public.audit_log where business_id is not distinct from k.business_id order by id loop
      v_hash := public._audit_row_hash(v_prev, a);
      update public.audit_log set prev_hash = v_prev, hash = v_hash where id = a.id;
      v_prev := v_hash;
    end loop;
  end loop;
  alter table public.audit_log enable trigger audit_log_immutable;
end $$;
