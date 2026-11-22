-- =====================================================================
-- 0045 – A service keeps the unit of measure chosen for it (any unit of the ATK list, e.g. orë, ditë, copë), as an
-- article does. save_product no longer turns the unit of a service into "copë"; a service still has no stock.
-- =====================================================================
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.save_product(jsonb)'::regprocedure);
  n := regexp_replace(d, '(if v_kind = ''service'' then\r?\n)[ \t]*v_unit := ''cope'';\r?\n', '\1');
  if n = d then
    if position('v_unit := ''cope''' in d) = 0 then
      return; -- already applied
    end if;
    raise exception 'save_product: the service unit line was not found';
  end if;
  execute n;
end $$;
