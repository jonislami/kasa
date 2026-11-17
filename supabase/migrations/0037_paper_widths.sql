-- =====================================================================
-- 0037 – More paper rolls for receipt printers: 57, 58, 76, 80 and 112 mm (before: only 58 and 80).
-- Characters per line follow the paper (57/58 → 32, 76 → 42, 80 → 48, 112 → 64); a printer with a narrower print area
-- (e.g. 80 mm paper printing 42 characters) is set with settings.line_chars – no column needed.
-- Existing values stay valid; the app before this migration only offers 58 and 80.
-- =====================================================================
alter table public.business_settings drop constraint if exists business_settings_paper_width_check;
alter table public.business_settings add constraint business_settings_paper_width_check check (paper_width in (57, 58, 76, 80, 112));

alter table public.register_applications drop constraint if exists register_applications_paper_width_check;
alter table public.register_applications add constraint register_applications_paper_width_check check (paper_width in (57, 58, 76, 80, 112));
