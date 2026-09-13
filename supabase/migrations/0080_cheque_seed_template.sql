-- =====================================================================
-- NIL Office — 0080_cheque_seed_template.sql
-- One sample cheque_print_templates row + its 5 required field rows —
-- the print-testing fixture spec §46 asks for (Date/Payee/Amount
-- Numeric/Amount Words/Purpose at known coordinates). Idempotent: skips
-- entirely if no ADMIN profile exists yet (fresh DB, chicken-and-egg,
-- same guard 0010_accounting_seed.sql uses) or if the sample already
-- exists. Values are a reasonable starting point for a standard Iranian
-- bank cheque leaf (~165mm x 80mm) — meant to be adjusted per real bank
-- via the calibration UI (numeric X/Y form), not treated as exact.
-- =====================================================================

do $$
declare
  v_admin uuid;
  v_template uuid;
begin
  select id into v_admin from public.profiles where role = 'ADMIN' and is_active limit 1;
  if v_admin is null then
    return;
  end if;
  if exists (select 1 from public.cheque_print_templates where name = 'نمونه — چک استاندارد') then
    return;
  end if;

  insert into public.cheque_print_templates
    (name, page_width_mm, page_height_mm, orientation, print_date_format, offset_x_mm, offset_y_mm, created_by)
  values
    ('نمونه — چک استاندارد', 165, 80, 'LANDSCAPE', 'JALALI', 0, 0, v_admin)
  returning id into v_template;

  insert into public.cheque_print_template_fields
    (template_id, field_key, x_mm, y_mm, width_mm, height_mm, font_size_pt, alignment, direction)
  values
    (v_template, 'DATE',           120, 10, 35, 8, 10, 'CENTER', 'LTR'),
    (v_template, 'PAYEE',           20, 25, 90, 8, 11, 'RIGHT',  'RTL'),
    (v_template, 'AMOUNT_NUMERIC', 120, 25, 35, 8, 11, 'CENTER', 'LTR'),
    (v_template, 'AMOUNT_WORDS',    20, 38, 130, 12, 10, 'RIGHT', 'RTL'),
    (v_template, 'PURPOSE',         20, 55, 130, 10, 9,  'RIGHT', 'RTL');
end $$;

-- =====================================================================
-- ROLLBACK
-- ---------------------------------------------------------------------
-- delete from public.cheque_print_templates where name = 'نمونه — چک استاندارد';
-- =====================================================================
