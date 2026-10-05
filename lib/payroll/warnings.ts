/**
 * Calculation warnings are CODES ONLY (see payroll_calc_warnings, 0119): the engine never stores free text,
 * amounts or bank values. This is the single place codes become Persian text. Messages deliberately contain
 * no digits and no currency so nothing monetary can ever be rendered from a warning.
 */
export type WarningSeverity = "CRITICAL" | "WARNING" | "INFO";

export type PayrollWarning = {
  personnel_id?: string | null;
  severity: WarningSeverity;
  code: string;
  component_code?: string | null;
  rule_key?: string | null;
};

type Ctx = { component_code?: string | null; rule_key?: string | null };
const comp = (c: Ctx) => (c.component_code ? `«${c.component_code}»` : "");
const rule = (c: Ctx) => (c.rule_key ? `«${c.rule_key}»` : "");

export const PAYROLL_WARNING_META: Record<string, { severity: WarningSeverity; text: (c: Ctx) => string }> = {
  // ---- CRITICAL: block the later approval phase ----
  MISSING_COMPENSATION: { severity: "CRITICAL", text: () => "برای این فرد پروفایل حقوق و مزایای معتبر در این دوره ثبت نشده است؛ مبلغی محاسبه نشد." },
  UNSUPPORTED_PAYMENT_FREQUENCY: { severity: "CRITICAL", text: () => "دورهٔ پرداخت این فرد ماهانه نیست و در این نسخه محاسبه نمی‌شود." },
  UNSUPPORTED_METHOD: { severity: "CRITICAL", text: (c) => `روش محاسبهٔ جزء ${comp(c)} (فرمول، یا تعریف قدیمی «مقدار × نرخ» بدون پارامتر) پشتیبانی نمی‌شود؛ مبلغی محاسبه نشد.` },
  QUANTITY_MISSING: { severity: "CRITICAL", text: (c) => `مقدار جزء ${comp(c)} (مثلاً ساعت اضافه‌کاری یا روز غیبت) در کارکرد این ماه وارد نشده است؛ مبلغی محاسبه نشد (اگر مقدار واقعاً صفر است، صفر وارد کنید).` },
  RULE_MISSING: { severity: "CRITICAL", text: (c) => `قاعدهٔ ${rule(c)} برای این دوره (و حوزهٔ قانونی دسته) تأیید نشده است؛ مبلغی محاسبه نشد.` },
  RULE_CHANGES_IN_PERIOD: { severity: "CRITICAL", text: (c) => `قاعدهٔ ${rule(c)} در میانهٔ دوره تغییر کرده است؛ محاسبهٔ خودکار انجام نشد.` },
  RULE_AMBIGUOUS: { severity: "CRITICAL", text: (c) => `برای قاعدهٔ ${rule(c)} بیش از یک مقدار تأییدشده وجود دارد؛ محاسبه انجام نشد.` },
  RULE_VALUE_INVALID: { severity: "CRITICAL", text: (c) => `مقدار یا واحد قاعدهٔ ${rule(c)} برای این استفاده معتبر نیست (درصد: واحد PERCENT؛ ضریب: واحد RATIO؛ مبنای ماه: واحد HOURS یا DAYS هم‌خوان با مقدار جزء).` },
  CURRENCY_MISMATCH: { severity: "CRITICAL", text: (c) => `واحد پول ${c.component_code ? `جزء ${comp(c)}` : "حقوق این فرد"} با واحد پول دسته یکسان نیست؛ مبلغی محاسبه نشد.` },
  COMPONENT_AMOUNT_MISSING: { severity: "CRITICAL", text: (c) => `برای جزء ${comp(c)} مبلغ یا درصد تعریف نشده است.` },
  MANUAL_INPUT_MISSING: { severity: "CRITICAL", text: (c) => `مقدار ورود دستی جزء ${comp(c)} در کارکرد این ماه وارد نشده است (در صورت نبود، صفر وارد کنید).` },
  CIRCULAR_BASIS: { severity: "CRITICAL", text: (c) => `جزء ${comp(c)} از نوع مزایا است و مبنای آن جمع مزایا است (وابستگی دوری)؛ محاسبه نشد.` },
  GROSS_BASIS_INCOMPLETE: { severity: "CRITICAL", text: (c) => `جمع مزایا کامل نیست (برخی اقلام محاسبه نشده‌اند)؛ جزء ${comp(c)} با مبنای ناخالص محاسبه نشد.` },
  NEGATIVE_NET: { severity: "CRITICAL", text: () => "خالص پرداختی منفی است." },
  DUPLICATE_PAYROLL: { severity: "CRITICAL", text: () => "برای این فرد در همین دوره دستهٔ فعال دیگری هم محاسبه شده است." },
  NO_ELIGIBLE_PERSONNEL: { severity: "CRITICAL", text: () => "هیچ فرد مشمولی برای این دوره و واحد پول پیدا نشد." },
  // ---- WARNING ----
  MISSING_WORK_DATA: { severity: "WARNING", text: () => "کارکرد این ماه برای فرد ثبت نشده است." },
  MISSING_BANK_DESTINATION: { severity: "WARNING", text: () => "برای این فرد حساب پرداخت فعالی ثبت نشده است." },
  PARTIAL_PERIOD: { severity: "WARNING", text: () => "استخدام یا پایان همکاری در میانهٔ دوره است؛ حقوق به‌صورت کامل (بدون تناسب روزانه) محاسبه شد." },
  COMPENSATION_CHANGED_IN_PERIOD: { severity: "WARNING", text: () => "حقوق و مزایا در میانهٔ دوره تغییر کرده؛ نسخهٔ معتبر در پایان دوره به‌کار رفت." },
  ELIGIBILITY_OVERRIDDEN: { severity: "WARNING", text: () => "این فرد با استثنای دستی (شمول اجباری) در دسته قرار گرفته است." },
  PERSONNEL_SUSPENDED: { severity: "WARNING", text: () => "وضعیت این فرد «تعلیق» است." },
  COMPONENT_INACTIVE: { severity: "WARNING", text: (c) => `جزء ${comp(c)} غیرفعال شده ولی هنوز در پروفایل فرد هست.` },
  // ---- INFO ----
  HOURS_NOT_APPLIED: { severity: "INFO", text: () => "اضافه‌کاری، غیبت یا مرخصی بدون‌حقوق ثبت شده ولی هیچ جزء «مقدار × نرخ» در پروفایل این فرد از آن استفاده نمی‌کند؛ اثر مالی ندارد (در صورت نیاز جزء مربوط را به پروفایل اضافه کنید)." },
};

export const KNOWN_WARNING_CODES = Object.keys(PAYROLL_WARNING_META);

export function describeWarning(w: PayrollWarning): string {
  const meta = PAYROLL_WARNING_META[w.code];
  return meta ? meta.text(w) : `هشدار ناشناخته (${w.code})`;
}

export const WARNING_SEVERITY_LABEL: Record<WarningSeverity, string> = {
  CRITICAL: "بحرانی", WARNING: "هشدار", INFO: "اطلاع",
};

export const isBlocking = (w: { severity: string }) => w.severity === "CRITICAL";
export const blockingCount = (ws: { severity: string }[]) => ws.filter(isBlocking).length;
