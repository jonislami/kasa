-- =====================================================================
-- 0051 – Every SEF device belongs to one till.
-- A device without a till did not know its unit: the till showed every register of every unit and the PIN screen
-- every worker. Now:
-- 1. An activation key always names its till: with one till it is chosen by itself; with more, the key cannot be
--    made without choosing one (owner keys already named it; the platform admin's could be "Pa caktuar").
-- 2. Activation without a till on the key (older keys): a business with one till links the device to it.
-- 3. activate_device returns the till the device ended with (also when it kept the one it had).
-- A device that has no till today is assigned once at the till by the owner / manager (update_device, unchanged).
-- Existing data does not change.
-- =====================================================================
do $$
declare
  r record;
  v_def text;
  v_count int;
begin
  for r in
    select * from (values
      -- 1. keys: one till → that till; several → it must be chosen
      ('public._activation_key_issue(uuid,uuid,text,integer)', 'for i in 0..11 loop',
       'if p_register is null then' || chr(10)
       || '    if (select count(*) from public.registers where business_id = p_business and active) > 1 then' || chr(10)
       || '      raise exception ''Zgjidh arkën për këtë çelës: pajisja do të shesë vetëm si ajo arkë'' using errcode = ''22023'';' || chr(10)
       || '    end if;' || chr(10)
       || '    select id into p_register from public.registers where business_id = p_business and active limit 1;' || chr(10)
       || '  end if;' || chr(10)
       || '  for i in 0..11 loop'),
      ('public.platform_activation_key_create(uuid,uuid,text,integer)', 'for i in 0..11 loop',
       'if p_register is null then' || chr(10)
       || '    if (select count(*) from public.registers where business_id = p_business and active) > 1 then' || chr(10)
       || '      raise exception ''Zgjidh arkën për këtë çelës: pajisja do të shesë vetëm si ajo arkë'' using errcode = ''22023'';' || chr(10)
       || '    end if;' || chr(10)
       || '    select id into p_register from public.registers where business_id = p_business and active limit 1;' || chr(10)
       || '  end if;' || chr(10)
       || '  for i in 0..11 loop'),
      -- 2. an older key without a till: the only till of the business
      ('public.activate_device(jsonb)', 'values (v_id, b.id, k.register_id,',
       'values (v_id, b.id, coalesce(k.register_id, (select min(r.id::text)::uuid from public.registers r where r.business_id = b.id and r.active having count(*) = 1)),'),
      -- 3. the till the device has after the activation
      ('public.activate_device(jsonb)', '''register_id'', k.register_id);',
       '''register_id'', (select d.register_id from public.devices d where d.id = v_id));')
    ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.new_text in v_def) > 0 then
      continue; -- already changed
    end if;
    v_count := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    if v_count <> 1 then
      raise exception '0051: % – "%" found % times, expected 1', r.fn, r.old_text, v_count;
    end if;
    execute replace(v_def, r.old_text, r.new_text);
  end loop;
end $$;
