-- =====================================================================
-- 0044 – The worker's identification number on the fiscal coupon (UA 01/2026, neni 7 pika 2.5: "emrin e personit
-- (operatorit) dhe numrin identifikues të tij"). Every profile of a business gets a short number (1, 2, 3 …, printed
-- as ID 001) in the order the accounts were created; a new account gets the next one. The number never changes and
-- is not reused. sale_json and my_context return it, so the coupon prints "EMRI I PUNËTORIT: … (ID 001)".
-- =====================================================================
alter table public.profiles add column if not exists worker_no integer;

-- numbers for the existing accounts, oldest first
update public.profiles p
   set worker_no = x.n
  from (select id, row_number() over (partition by business_id order by created_at, id) as n
          from public.profiles where business_id is not null) x
 where x.id = p.id and p.worker_no is null;

create unique index if not exists profiles_business_worker_no on public.profiles (business_id, worker_no) where business_id is not null;

create or replace function public.profiles_worker_no()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is not null and new.worker_no is null then
    -- one new number at a time per business
    perform pg_advisory_xact_lock(hashtext('worker_no:' || new.business_id::text));
    select coalesce(max(worker_no), 0) + 1 into new.worker_no from public.profiles where business_id = new.business_id;
  end if;
  return new;
end $$;

drop trigger if exists profiles_worker_no on public.profiles;
create trigger profiles_worker_no before insert on public.profiles for each row execute function public.profiles_worker_no();

-- the number stays: a client may not change it
create or replace function public.profiles_worker_no_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.worker_no is not null and new.worker_no is distinct from old.worker_no then
    new.worker_no := old.worker_no;
  end if;
  if old.worker_no is null and new.business_id is not null and new.worker_no is null then
    perform pg_advisory_xact_lock(hashtext('worker_no:' || new.business_id::text));
    select coalesce(max(worker_no), 0) + 1 into new.worker_no from public.profiles where business_id = new.business_id;
  end if;
  return new;
end $$;

drop trigger if exists profiles_worker_no_lock on public.profiles;
create trigger profiles_worker_no_lock before update on public.profiles for each row execute function public.profiles_worker_no_lock();

-- sale_json and my_context: the number next to the name
do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.sale_json(uuid)'::regprocedure);
  if position('''worker_no''' in d) = 0 then
    d := replace(d,
      '''worker_name'', (select pr.full_name from public.profiles pr where pr.id = s.worker_id),',
      '''worker_name'', (select pr.full_name from public.profiles pr where pr.id = s.worker_id),' || chr(10) ||
      '    ''worker_no'', (select pr.worker_no from public.profiles pr where pr.id = s.worker_id),');
    if position('''worker_no''' in d) = 0 then raise exception 'sale_json: worker_name line not found'; end if;
    execute d;
  end if;

  d := pg_get_functiondef('public.my_context()'::regprocedure);
  if position('''worker_no''' in d) = 0 then
    d := replace(d,
      '''full_name'', p.full_name, ''email'', p.email, ''active'', p.active, ''login_kind'', p.login_kind)',
      '''full_name'', p.full_name, ''email'', p.email, ''active'', p.active, ''login_kind'', p.login_kind, ''worker_no'', p.worker_no)');
    if position('''worker_no''' in d) = 0 then raise exception 'my_context: profile line not found'; end if;
    execute d;
  end if;
end $$;
