-- 0031: ATK transaction numbers are kept exactly as ATK sends them.
-- They have up to 19–20 digits; bigint could not hold all of them (the save failed and the coupon stayed
-- "pending" although ATK had received it) and JavaScript rounded the rest. Stored as text from now on.

alter table public.fiscal_coupons alter column transaction_no type text using transaction_no::text;

-- fiscal-relay logs when ATK accepted a coupon but saving the answer failed (action 'store')
alter table public.fiscal_log drop constraint if exists fiscal_log_action_check;
alter table public.fiscal_log add constraint fiscal_log_action_check check (action in ('verify', 'signcsr', 'coupon', 'store'));

create or replace function public._fiscal_store(p jsonb)
returns public.fiscal_coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fiscal_coupons;
  v_status text := p->>'status';
begin
  -- With the signed data: first store (ignored when the coupon is already there). Without: only the send result.
  if p ? 'details' then
    insert into public.fiscal_coupons (sale_id, business_id, register_id, env, coupon_type, coupon_id, coupon_seq, branch_id, pos_id,
                                       reference_no, verification_no, issued_at, details, signature, qr, offline)
    values ((p->>'sale_id')::uuid, (p->>'business_id')::uuid, (p->>'register_id')::uuid, p->>'env', (p->>'coupon_type')::smallint,
            (p->>'coupon_id')::bigint, (p->>'coupon_seq')::bigint, (p->>'branch_id')::bigint, (p->>'pos_id')::bigint,
            nullif(p->>'reference_no', '')::bigint, p->>'verification_no', (p->>'issued_at')::timestamptz,
            p->>'details', p->>'signature', p->>'qr', coalesce((p->>'offline')::boolean, false))
    on conflict (sale_id) do nothing;
  end if;

  update public.fiscal_coupons
     set status = coalesce(v_status, status),
         transaction_no = coalesce(nullif(p->>'transaction_no', ''), transaction_no),
         error = case when v_status = 'sent' then null else coalesce(p->>'error', error) end,
         attempts = attempts + case when v_status is null then 0 else 1 end,
         sent_at = case when v_status = 'sent' then now() else sent_at end,
         updated_at = now()
   where sale_id = (p->>'sale_id')::uuid
  returning * into f;

  perform set_config('kasa.fiscal_write', 'on', true);
  update public.registers
     set coupon_seq = greatest(coupon_seq, f.coupon_seq),
         fiscal_last_sent_at = case when v_status = 'sent' then now() else fiscal_last_sent_at end
   where id = f.register_id;
  perform set_config('kasa.fiscal_write', 'off', true);
  return f;
end $$;
