import {
  CURRENCY_LABEL, PAYROLL_BATCH_STATUS_LABEL, SALARY_COMPONENT_TYPE_LABEL, PAYMENT_FREQUENCY_LABEL, POSTING_STATUS_LABEL,
  PERSONNEL_STATUS_LABEL, PERSONNEL_EMPLOYMENT_TYPE_LABEL,
} from "@/lib/enums";
import { PAYSLIP_STATE_LABEL } from "@/lib/payroll/payslip";

/**
 * ONE registry drives the on-screen report AND its CSV export (single source of truth for columns, filters and gate).
 * Money columns are exact decimal STRINGS from the read RPCs — formatting/CSV never touch Number(). Every payroll amount row
 * carries a `currency` column: currencies are never summed.
 */
export type ColKind = "text" | "money" | "int" | "date" | "bool" | "enum" | "flags";
export type ReportCol = { key: string; label: string; kind: ColKind; labels?: Record<string, string> };
export type FilterKey = "period" | "currency" | "from" | "to" | "personnel" | "status" | "department" | "employment_type";
export type ReportFamily = "hr" | "payroll";

export type ReportDef = {
  key: string;
  family: ReportFamily;
  title: string;
  description: string;
  filters: FilterKey[];
  /** filters that must be chosen before the report can run */
  required?: FilterKey[];
  columns: ReportCol[];
  /** per-currency totals returned by some payroll RPCs */
  totalsColumns?: ReportCol[];
  source: { kind: "rpc"; name: string; fixed?: Record<string, unknown> } | { kind: "table"; name: string };
};

const BASIS_LABEL: Record<string, string> = { APPROVED: "تأییدشده", CALCULATED: "محاسبه‌شده (هنوز تأیید نشده)" };
export const RECON_FLAG_LABEL: Record<string, string> = {
  JOURNAL_MISSING: "سند حسابداری ندارد",
  JOURNAL_NOT_POSTED: "سند هنوز قطعی نشده",
  NET_PAYABLE_MISMATCH: "مبلغ حقوق پرداختنی در سند با خالص حقوق نمی‌خواند",
  OVERPAID: "پرداخت بیش از خالص",
  PAYMENT_AMOUNT_CHANGED: "مبلغ پرداخت پس از ساخت تغییر کرده",
  UNPAID: "هنوز چیزی پرداخت نشده",
};
const EMPLOYMENT_RECORD_STATUS_LABEL: Record<string, string> = { ACTIVE: "جاری", ENDED: "پایان‌یافته" };

const c = (key: string, label: string, kind: ColKind = "text", labels?: Record<string, string>): ReportCol => ({ key, label, kind, labels });
const CUR = c("currency", "واحد پول", "enum", CURRENCY_LABEL as Record<string, string>);
const BATCH_STATUS = c("batch_status", "وضعیت دسته", "enum", PAYROLL_BATCH_STATUS_LABEL);
const BASIS = c("basis", "مبنای محاسبه", "enum", BASIS_LABEL);
const PAY_STATE = (key: string, label: string) => c(key, label, "enum", PAYSLIP_STATE_LABEL);
const PERIOD = c("period_label", "دوره");

export const REPORTS: ReportDef[] = [
  /* ------------------------------ HR (no amounts) ------------------------------ */
  {
    key: "hr_personnel_register", family: "hr", title: "دفتر پرسنلی", description: "فهرست همهٔ پرسنل با وضعیت و نوع همکاری (بدون هیچ مبلغی).",
    filters: ["status", "employment_type", "department"],
    columns: [
      c("personnel_number", "شمارهٔ پرسنلی"), c("name", "نام و نام خانوادگی"), c("job_title", "عنوان شغلی"), c("department", "واحد"),
      c("employment_type", "نوع همکاری", "enum", PERSONNEL_EMPLOYMENT_TYPE_LABEL as Record<string, string>),
      c("employment_status", "وضعیت", "enum", PERSONNEL_STATUS_LABEL as Record<string, string>),
      c("hire_date", "تاریخ استخدام", "date"), c("termination_date", "تاریخ پایان همکاری", "date"), c("work_location", "محل کار"),
    ],
    source: { kind: "table", name: "personnel" },
  },
  {
    key: "hr_active_personnel", family: "hr", title: "پرسنل فعال", description: "فقط افراد با وضعیت «فعال».",
    filters: ["employment_type", "department"],
    columns: [
      c("personnel_number", "شمارهٔ پرسنلی"), c("name", "نام و نام خانوادگی"), c("job_title", "عنوان شغلی"), c("department", "واحد"),
      c("employment_type", "نوع همکاری", "enum", PERSONNEL_EMPLOYMENT_TYPE_LABEL as Record<string, string>),
      c("hire_date", "تاریخ استخدام", "date"), c("work_location", "محل کار"),
    ],
    source: { kind: "table", name: "personnel" },
  },
  {
    key: "hr_employment_history", family: "hr", title: "سوابق استخدام", description: "همهٔ نسخه‌های سابقهٔ استخدام (تغییر عنوان، واحد، نوع همکاری) به ترتیب تاریخ.",
    filters: ["status", "employment_type"],
    columns: [
      c("personnel_number", "شمارهٔ پرسنلی"), c("name", "نام و نام خانوادگی"),
      c("employment_type", "نوع همکاری", "enum", PERSONNEL_EMPLOYMENT_TYPE_LABEL as Record<string, string>),
      c("job_title", "عنوان شغلی"), c("department", "واحد"), c("start_date", "شروع", "date"), c("end_date", "پایان", "date"),
      c("status", "وضعیت سابقه", "enum", EMPLOYMENT_RECORD_STATUS_LABEL), c("work_schedule_type", "نوع ساعت کاری"),
    ],
    source: { kind: "table", name: "employment_records" },
  },
  /* ------------------------------ Payroll (amounts, per currency) ------------------------------ */
  {
    key: "payroll_compensation_history", family: "payroll", title: "سوابق حقوق و مزایا", description: "همهٔ نسخه‌های پروفایل حقوق هر فرد (مبلغ پایه، واحد پول، بازهٔ اعتبار).",
    filters: ["personnel"],
    columns: [
      c("personnel_number", "شمارهٔ پرسنلی"), c("personnel_name", "نام"), c("version_number", "نسخه", "int"),
      c("effective_from", "از", "date"), c("effective_to", "تا پیش از", "date"), c("base_salary", "حقوق پایه", "money"), CUR,
      c("payment_frequency", "دورهٔ پرداخت", "enum", PAYMENT_FREQUENCY_LABEL as Record<string, string>),
      c("hourly_rate", "نرخ ساعتی", "money"), c("line_count", "تعداد اجزا", "int"),
    ],
    source: { kind: "rpc", name: "payroll_report_compensation_history" },
  },
  {
    key: "payroll_register", family: "payroll", title: "دفتر حقوق", description: "نتیجهٔ حقوق همهٔ افراد یک دوره، با جمع هر واحد پول جدا.",
    filters: ["period", "currency"], required: ["period"],
    columns: [
      c("batch_number", "شمارهٔ دسته"), BATCH_STATUS, BASIS, CUR, c("personnel_number", "شمارهٔ پرسنلی"), c("personnel_name", "نام"),
      c("gross", "ناخالص", "money"), c("deductions", "کسورات", "money"), c("employer_cost", "هزینهٔ کارفرما", "money"), c("net", "خالص", "money"),
      c("is_complete", "کامل", "bool"), PAY_STATE("payment_state", "وضعیت پرداخت"), c("paid", "پرداخت‌شده", "money"), c("outstanding", "مانده", "money"),
    ],
    totalsColumns: [CUR, c("personnel_count", "تعداد", "int"), c("gross", "ناخالص", "money"), c("deductions", "کسورات", "money"), c("employer_cost", "هزینهٔ کارفرما", "money"), c("net", "خالص", "money")],
    source: { kind: "rpc", name: "payroll_report_register" },
  },
  {
    key: "payroll_by_period", family: "payroll", title: "حقوق به تفکیک دوره", description: "هر دوره و هر واحد پول یک ردیف (واحدهای پولی هرگز جمع نمی‌شوند).",
    filters: ["from", "to", "currency"],
    columns: [
      PERIOD, CUR, c("batches", "دسته", "int"), c("personnel_count", "تعداد", "int"), c("incomplete", "ناقص", "int"),
      c("gross", "ناخالص", "money"), c("deductions", "کسورات", "money"), c("net", "خالص", "money"), c("employer_cost", "هزینهٔ کارفرما", "money"),
      c("all_approved", "همه تأییدشده", "bool"), c("paid", "پرداخت‌شده", "money"), c("outstanding", "مانده", "money"),
    ],
    source: { kind: "rpc", name: "payroll_report_by_period" },
  },
  {
    key: "payroll_gross_net", family: "payroll", title: "ناخالص و خالص", description: "ناخالص، کسورات و خالص هر دوره به تفکیک واحد پول.",
    filters: ["from", "to", "currency"],
    columns: [PERIOD, CUR, c("personnel_count", "تعداد", "int"), c("gross", "ناخالص", "money"), c("deductions", "کسورات", "money"), c("net", "خالص", "money"), c("incomplete", "ناقص", "int")],
    source: { kind: "rpc", name: "payroll_report_by_period" },
  },
  {
    key: "payroll_employer_cost", family: "payroll", title: "هزینهٔ کارفرما", description: "هزینهٔ کارفرما (مثل سهم بیمه) در کنار ناخالص، هر دوره و واحد پول.",
    filters: ["from", "to", "currency"],
    columns: [PERIOD, CUR, c("personnel_count", "تعداد", "int"), c("gross", "ناخالص", "money"), c("employer_cost", "هزینهٔ کارفرما", "money")],
    source: { kind: "rpc", name: "payroll_report_by_period" },
  },
  {
    key: "payroll_by_personnel", family: "payroll", title: "حقوق به تفکیک فرد", description: "تاریخچهٔ حقوق یک نفر در دوره‌های مختلف.",
    filters: ["personnel", "from", "to"], required: ["personnel"],
    columns: [
      PERIOD, c("batch_number", "شمارهٔ دسته"), BATCH_STATUS, BASIS, CUR, c("gross", "ناخالص", "money"), c("deductions", "کسورات", "money"),
      c("employer_cost", "هزینهٔ کارفرما", "money"), c("net", "خالص", "money"), c("is_complete", "کامل", "bool"),
      PAY_STATE("payment_state", "وضعیت پرداخت"), c("paid", "پرداخت‌شده", "money"), c("payslip_revisions", "نسخه‌های فیش", "int"),
    ],
    source: { kind: "rpc", name: "payroll_report_by_personnel" },
  },
  {
    key: "payroll_components", family: "payroll", title: "حقوق به تفکیک جزء", description: "جمع هر جزء (مزایا، کسورات، هزینهٔ کارفرما) در یک دوره، به تفکیک واحد پول.",
    filters: ["period", "currency"], required: ["period"],
    columns: [
      c("component_type", "نوع", "enum", SALARY_COMPONENT_TYPE_LABEL as Record<string, string>), c("component_code", "کد"), c("component_name", "نام جزء"), CUR,
      c("personnel_count", "تعداد افراد", "int"), c("total", "جمع", "money"),
    ],
    source: { kind: "rpc", name: "payroll_report_components" },
  },
  {
    key: "payroll_payment_status", family: "payroll", title: "وضعیت پرداخت حقوق", description: "برای هر فرد: خالص، پرداخت‌شده (فقط پرداخت‌های قطعی)، پیش‌نویس و مانده.",
    filters: ["period", "currency"],
    columns: [
      PERIOD, c("batch_number", "شمارهٔ دسته"), CUR, c("personnel_number", "شمارهٔ پرسنلی"), c("personnel_name", "نام"),
      c("net", "خالص", "money"), c("paid", "پرداخت‌شده", "money"), c("drafted", "پیش‌نویس", "money"), c("outstanding", "مانده", "money"),
      PAY_STATE("payment_state", "وضعیت پرداخت"), c("last_payment_date", "آخرین پرداخت", "date"), c("overpaid", "بیش از خالص", "bool"), c("amount_changed", "مبلغ تغییر کرده", "bool"),
    ],
    totalsColumns: [CUR, c("net", "خالص", "money"), c("paid", "پرداخت‌شده", "money"), c("outstanding", "مانده", "money")],
    source: { kind: "rpc", name: "payroll_report_payments" },
  },
  {
    key: "payroll_outstanding", family: "payroll", title: "حقوق معوق", description: "فقط افرادی که هنوز مانده دارند.",
    filters: ["period", "currency"],
    columns: [
      PERIOD, c("batch_number", "شمارهٔ دسته"), CUR, c("personnel_number", "شمارهٔ پرسنلی"), c("personnel_name", "نام"),
      c("net", "خالص", "money"), c("paid", "پرداخت‌شده", "money"), c("outstanding", "مانده", "money"), PAY_STATE("payment_state", "وضعیت پرداخت"),
    ],
    totalsColumns: [CUR, c("net", "خالص", "money"), c("paid", "پرداخت‌شده", "money"), c("outstanding", "مانده", "money")],
    source: { kind: "rpc", name: "payroll_report_payments", fixed: { p_only_outstanding: true } },
  },
  {
    key: "payroll_reconciliation", family: "payroll", title: "تطبیق حقوق با حسابداری و پرداخت‌ها", description: "برای هر دستهٔ تأییدشده: خالص حقوق، مبلغ حقوق پرداختنی در سند حسابداری، و پرداخت‌شده؛ با نشانهٔ هر مغایرت.",
    filters: ["period"],
    columns: [
      PERIOD, c("batch_number", "شمارهٔ دسته"), CUR, c("personnel_count", "تعداد", "int"), c("total_net", "جمع خالص", "money"),
      c("total_deductions", "جمع کسورات", "money"), c("employer_cost", "هزینهٔ کارفرما", "money"),
      c("journal_status", "وضعیت سند", "enum", POSTING_STATUS_LABEL as Record<string, string>), c("journal_net_credit", "حقوق پرداختنی در سند", "money"),
      c("net_difference", "اختلاف با خالص", "money"), c("paid", "پرداخت‌شده", "money"), c("drafted", "پیش‌نویس پرداخت", "money"), c("outstanding", "مانده", "money"),
      c("flags", "مغایرت‌ها", "flags", RECON_FLAG_LABEL),
    ],
    source: { kind: "rpc", name: "payroll_report_reconciliation" },
  },
  {
    key: "payroll_payslips", family: "payroll", title: "تاریخچهٔ فیش‌های حقوقی", description: "چه کسی فیش دارد، آخرین نسخه، و آیا با وضعیت پرداخت واقعی به‌روز است.",
    filters: ["period"],
    columns: [
      PERIOD, c("batch_number", "شمارهٔ دسته"), CUR, c("personnel_number", "شمارهٔ پرسنلی"), c("personnel_name", "نام"),
      PAY_STATE("current_state", "وضعیت پرداخت فعلی"), c("revisions", "تعداد نسخه", "int"), c("latest_revision", "آخرین نسخه", "int"),
      PAY_STATE("latest_state", "وضعیت در آخرین نسخه"), c("latest_issued_at", "تاریخ صدور", "date"), c("issued", "صادر شده", "bool"), c("up_to_date", "به‌روز", "bool"),
    ],
    source: { kind: "rpc", name: "payroll_report_payslips" },
  },
];

export const reportByKey = (key: string): ReportDef | undefined => REPORTS.find((r) => r.key === key);
export const reportsOf = (family: ReportFamily) => REPORTS.filter((r) => r.family === family);
