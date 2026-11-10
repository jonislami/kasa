-- =====================================================================
-- 0014 – The owner adds the accountant directly.
--
-- In Cilësimet → Kontabilisti the owner writes the accountant's email (the account
-- created by the platform admin). The business appears at once among the
-- accountant's clients in "Kasa Kontabilist", already linked (approved) – no request,
-- no approval. If the accountant already has this business as a client (same Kasa
-- business, or same NUI not linked yet), that client is linked instead of a new one.
-- The access is the same read-only access as an approved request (business_members),
-- and the owner takes it away with revoke_accountant as before.
-- Nothing the live app uses changes.
-- =====================================================================

create or replace function public.add_accountant_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := public.current_business_id();
  v_email text := lower(trim(coalesce(p_email, '')));
  a public.accountants;
  b public.businesses;
  v_client uuid;
begin
  if v_business is null or public.current_role_in_business() is distinct from 'admin' then
    raise exception 'Vetëm pronari' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Shkruaj email-in e kontabilistit' using errcode = '22023';
  end if;
  select * into a from public.accountants where lower(email) = v_email;
  if not found then
    raise exception 'Nuk ka llogari kontabilisti me këtë email. Kontabilisti duhet ta ketë programin "Kasa Kontabilist" (llogarinë e krijon administratori i platformës).' using errcode = 'P0002';
  end if;
  if not a.active then
    raise exception 'Llogaria e këtij kontabilisti është e çaktivizuar' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = v_business;

  -- 1) a client already linked (or asked for) with this business
  select id into v_client from public.acc_clients
   where accountant_id = a.user_id and kasa_business_id = v_business
   order by updated_at desc limit 1;
  -- 2) a client with the same NUI, not linked to Kasa yet
  if v_client is null and b.nui is not null then
    select id into v_client from public.acc_clients
     where accountant_id = a.user_id and kasa_business_id is null and nui = b.nui
     order by updated_at desc limit 1;
  end if;

  if v_client is not null then
    update public.acc_clients
       set kasa_business_id = v_business, link_status = 'approved', active = true,
           link_requested_at = coalesce(link_requested_at, now()), link_responded_at = now(),
           nui = coalesce(nui, b.nui), vat_number = coalesce(vat_number, b.vat_number),
           fiscal_number = coalesce(fiscal_number, b.fiscal_number), updated_at = now()
     where id = v_client;
  else
    insert into public.acc_clients (accountant_id, name, nui, vat_number, fiscal_number, vat_registered, address, city, phone, email,
                                    kasa_business_id, link_status, link_requested_at, link_responded_at)
    values (a.user_id, b.name, b.nui, b.vat_number, b.fiscal_number, b.vat_number is not null, b.address, b.city, b.phone, b.owner_email,
            v_business, 'approved', now(), now())
    returning id into v_client;
  end if;

  insert into public.business_members (user_id, business_id, role, status, invited_by, responded_at)
  values (a.user_id, v_business, 'accountant', 'active', auth.uid(), now())
  on conflict (user_id, business_id) do update
    set status = 'active', invited_by = excluded.invited_by, responded_at = now(), revoked_at = null;

  insert into public.audit_log (business_id, user_id, action, entity, entity_id, details)
  values (v_business, auth.uid(), 'accountant_add', 'accountant', a.user_id::text,
          jsonb_build_object('name', a.full_name, 'email', a.email, 'office', a.office_name));

  return jsonb_build_object('client_id', v_client, 'full_name', a.full_name, 'office_name', a.office_name);
end $$;

revoke execute on function public.add_accountant_by_email(text) from public, anon;
grant execute on function public.add_accountant_by_email(text) to authenticated;
