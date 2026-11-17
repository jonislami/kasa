-- =====================================================================
-- 0038 – Receipt paper: only 58, 80 and 100 mm (replaces the list of 0037).
-- Characters per line: 58 → 32, 80 → 48, 100 → 56; a printer with a narrower or wider print area is set with
-- settings.line_chars. Rows saved with a width that is no longer offered move to the nearest one (57 → 58,
-- 76 → 80, 112 → 100). The app before this migration only saves 58 and 80 (0.3.9) or the 0037 list.
-- =====================================================================
alter table public.business_settings drop constraint if exists business_settings_paper_width_check;
alter table public.register_applications drop constraint if exists register_applications_paper_width_check;

update public.business_settings set paper_width = case paper_width when 57 then 58 when 76 then 80 when 112 then 100 end
 where paper_width in (57, 76, 112);
update public.register_applications set paper_width = case paper_width when 57 then 58 when 76 then 80 when 112 then 100 end
 where paper_width in (57, 76, 112);

alter table public.business_settings add constraint business_settings_paper_width_check check (paper_width in (58, 80, 100));
alter table public.register_applications add constraint register_applications_paper_width_check check (paper_width in (58, 80, 100));
