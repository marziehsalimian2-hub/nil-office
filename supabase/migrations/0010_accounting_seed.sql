-- =============================================================================
-- NIL Office v1.0  |  Migration 0010 — Accounting Seed (idempotent, editable)
-- A sensible starter Chart of Accounts for a small Iranian service/trading co.
-- Reports use account_type (not hard-coded IDs); ADMIN may freely edit/extend.
-- =============================================================================

-- base accounting unit (single row)
insert into public.app_settings (id, base_currency_code, display_unit)
values (1, 'IRR', 'RIAL')
on conflict (id) do nothing;

-- default fiscal year (adjust dates as needed in the UI)
insert into public.fiscal_years (title, start_date, end_date, status)
select 'سال مالی ۱۴۰۵', date '2026-03-21', date '2027-03-20', 'OPEN'
where not exists (select 1 from public.fiscal_years);

-- ---- Chart of accounts ------------------------------------------------------
-- Levels: 1 گروه (group) -> 2 کل (general) -> 3 معین (subsidiary, posting).
-- allows_posting = true only at the subsidiary (معین) level here.
do $$
declare
  g_asset uuid; g_liab uuid; g_equity uuid; g_rev uuid; g_exp uuid;
  k uuid;
  procedure_dummy int;
begin
  if exists (select 1 from public.accounts) then return; end if;

  -- groups (level 1)
  insert into public.accounts (code,name,level,nature,account_type,allows_posting) values
    ('1','دارایی‌ها',1,'DEBIT','ASSET',false)     returning id into g_asset;
  insert into public.accounts (code,name,level,nature,account_type,allows_posting) values
    ('2','بدهی‌ها',1,'CREDIT','LIABILITY',false)   returning id into g_liab;
  insert into public.accounts (code,name,level,nature,account_type,allows_posting) values
    ('3','حقوق صاحبان سهام',1,'CREDIT','EQUITY',false) returning id into g_equity;
  insert into public.accounts (code,name,level,nature,account_type,allows_posting) values
    ('4','درآمدها',1,'CREDIT','REVENUE',false)     returning id into g_rev;
  insert into public.accounts (code,name,level,nature,account_type,allows_posting) values
    ('5','هزینه‌ها',1,'DEBIT','EXPENSE',false)      returning id into g_exp;

  -- general ledger (level 2)
  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting)
  values ('11','دارایی‌های جاری',g_asset,2,'DEBIT','ASSET',false) returning id into k;

  -- subsidiary (level 3, posting) under current assets
  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting) values
    ('1101','صندوق',k,3,'DEBIT','ASSET',true),
    ('1102','بانک‌ها',k,3,'DEBIT','ASSET',true),
    ('1103','حساب‌های دریافتنی',k,3,'DEBIT','ASSET',true),
    ('1104','پیش‌پرداخت‌ها',k,3,'DEBIT','ASSET',true),
    ('1105','تنخواه‌گردان',k,3,'DEBIT','ASSET',true);

  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting)
  values ('21','بدهی‌های جاری',g_liab,2,'CREDIT','LIABILITY',false) returning id into k;
  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting) values
    ('2101','حساب‌های پرداختنی',k,3,'CREDIT','LIABILITY',true),
    ('2102','پیش‌دریافت‌ها',k,3,'CREDIT','LIABILITY',true);

  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting)
  values ('31','سرمایه',g_equity,2,'CREDIT','EQUITY',false) returning id into k;
  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting) values
    ('3101','سرمایه',k,3,'CREDIT','EQUITY',true),
    ('3102','سود و زیان انباشته',k,3,'CREDIT','EQUITY',true);

  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting)
  values ('41','درآمد عملیاتی',g_rev,2,'CREDIT','REVENUE',false) returning id into k;
  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting) values
    ('4101','درآمد خدمات',k,3,'CREDIT','REVENUE',true),
    ('4102','درآمد فروش',k,3,'CREDIT','REVENUE',true);

  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting)
  values ('51','هزینه‌های عملیاتی',g_exp,2,'DEBIT','EXPENSE',false) returning id into k;
  insert into public.accounts (code,name,parent_id,level,nature,account_type,allows_posting) values
    ('5101','هزینه حقوق و دستمزد',k,3,'DEBIT','EXPENSE',true),
    ('5102','هزینه اداری و عمومی',k,3,'DEBIT','EXPENSE',true),
    ('5103','هزینه بانکی',k,3,'DEBIT','EXPENSE',true),
    ('5104','هزینه اجاره',k,3,'DEBIT','EXPENSE',true);
end $$;
