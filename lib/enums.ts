/** Enum values mirror the Postgres enum types; labels drive the Persian UI. */

export const CORR_STATUS = [
  "DRAFT",
  "REVIEW",
  "FINALIZED",
  "SENT",
  "WAITING_RESPONSE",
  "RESPONSE_RECEIVED",
  "CLOSED",
  "CANCELLED",
] as const;
export type CorrStatus = (typeof CORR_STATUS)[number];

export const CORR_STATUS_LABEL: Record<CorrStatus, string> = {
  DRAFT: "پیش‌نویس",
  REVIEW: "در حال بررسی",
  FINALIZED: "ثبت نهایی",
  SENT: "ارسال‌شده",
  WAITING_RESPONSE: "در انتظار پاسخ",
  RESPONSE_RECEIVED: "پاسخ دریافت شد",
  CLOSED: "بسته‌شده",
  CANCELLED: "ابطال‌شده",
};

/** Tailwind text color token per status (see tailwind.config `status.*`). */
export const CORR_STATUS_TONE: Record<CorrStatus, string> = {
  DRAFT: "status-draft",
  REVIEW: "status-review",
  FINALIZED: "status-final",
  SENT: "status-sent",
  WAITING_RESPONSE: "status-waiting",
  RESPONSE_RECEIVED: "status-received",
  CLOSED: "status-closed",
  CANCELLED: "status-cancelled",
};

export const PRIORITY = ["NORMAL", "URGENT", "CONFIDENTIAL"] as const;
export type Priority = (typeof PRIORITY)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
  NORMAL: "عادی",
  URGENT: "فوری",
  CONFIDENTIAL: "محرمانه",
};

export const LANGUAGE = ["FA", "EN"] as const;
export type Language = (typeof LANGUAGE)[number];
export const LANGUAGE_LABEL: Record<Language, string> = {
  FA: "فارسی",
  EN: "انگلیسی",
};

export const CASE_STATUS = ["ACTIVE", "WAITING", "CLOSED", "CANCELLED"] as const;
export type CaseStatus = (typeof CASE_STATUS)[number];
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  ACTIVE: "فعال",
  WAITING: "در انتظار",
  CLOSED: "بسته‌شده",
  CANCELLED: "لغوشده",
};

export const DOCUMENT_TYPE = [
  "PROCEDURE",
  "LOI",
  "ICPO",
  "CONTRACT",
  "ANALYSIS",
  "COMPANY_DOCUMENT",
  "BANK_DOCUMENT",
  "INVOICE",
  "OTHER",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPE)[number];
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  PROCEDURE: "رویه / پروسیجر",
  LOI: "LOI",
  ICPO: "ICPO",
  CONTRACT: "قرارداد",
  ANALYSIS: "آنالیز محصول",
  COMPANY_DOCUMENT: "مدارک شرکتی",
  BANK_DOCUMENT: "مدارک بانکی",
  INVOICE: "فاکتور",
  OTHER: "سایر",
};

export const FOLLOWUP_STATUS = ["OPEN", "DONE", "CANCELLED"] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUS)[number];
export const FOLLOWUP_STATUS_LABEL: Record<FollowupStatus, string> = {
  OPEN: "باز",
  DONE: "انجام‌شده",
  CANCELLED: "لغوشده",
};

export const LINK_RELATION = ["REPLY_TO", "RELATED_TO"] as const;
export type LinkRelation = (typeof LINK_RELATION)[number];
export const LINK_RELATION_LABEL: Record<LinkRelation, string> = {
  REPLY_TO: "پاسخ به",
  RELATED_TO: "مرتبط با",
};

export const DIRECTION_LABEL: Record<"OUTGOING" | "INCOMING", string> = {
  OUTGOING: "صادره",
  INCOMING: "وارده",
};

/* ============================ Cheque Management ============================ */

export const CHEQUE_DIRECTION_LABEL: Record<"PAYABLE" | "RECEIVABLE", string> = {
  PAYABLE: "پرداختی",
  RECEIVABLE: "دریافتی",
};

export const CHEQUE_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "موجود",
  DRAFT: "پیش‌نویس",
  PREPARED: "آماده‌شده",
  ISSUED: "صادرشده",
  DELIVERED: "تحویل‌شده",
  RECEIVED: "دریافت‌شده",
  DEPOSITED: "تودیع‌شده",
  CLEARED: "وصول‌شده",
  RETURNED: "برگشت‌خورده",
  CANCELLED: "لغوشده",
  VOID: "باطل‌شده",
};

export const CHEQUE_STATUS_TONE: Record<string, string> = {
  AVAILABLE: "status-draft",
  DRAFT: "status-draft",
  PREPARED: "status-review",
  ISSUED: "status-final",
  DELIVERED: "status-received",
  RECEIVED: "status-received",
  DEPOSITED: "status-waiting",
  CLEARED: "status-closed",
  RETURNED: "status-cancelled",
  CANCELLED: "status-cancelled",
  VOID: "status-cancelled",
};

export const CHEQUE_CURRENCY_LABEL: Record<string, string> = {
  IRR: "ریال",
  TOMAN: "تومان",
  USD: "دلار",
  EUR: "یورو",
  AED: "درهم",
  TRY: "لیر",
  CNY: "یوان",
};

/** Maps RPC/DB error codes to clear Persian messages (never raw SQL). */
export const ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHORIZED: "شما مجاز به انجام این عملیات نیستید.",
  NOT_FOUND: "رکورد مورد نظر یافت نشد.",
  ALREADY_NUMBERED: "برای این نامه قبلاً شماره صادر شده است.",
  NOT_ELIGIBLE: "این نامه در وضعیت قابل ثبت نهایی نیست.",
  SUBJECT_REQUIRED: "برای ثبت نهایی، درج موضوع الزامی است.",
  ONLY_OUTGOING_FINALIZE: "فقط نامه‌های صادره قابل ثبت نهایی هستند.",
  ONLY_INCOMING_REGISTER: "فقط نامه‌های وارده قابل ثبت شماره هستند.",
  INVALID_YEAR: "سال شمسی نامعتبر است.",
  ALREADY_CANCELLED: "این نامه قبلاً ابطال شده است.",
  SEQUENCE_NUMBER_IMMUTABLE: "شماره ثبت‌شده قابل تغییر نیست.",
  DISPLAY_NUMBER_IMMUTABLE: "شماره نامه قابل تغییر نیست.",
  USE_RPC_TO_FINALIZE: "ثبت نهایی فقط از مسیر مجاز امکان‌پذیر است.",
  ALREADY_POSTED: "این سند قبلاً ثبت قطعی شده است.",
  UNBALANCED: "سند تراز نیست؛ جمع بدهکار و بستانکار باید برابر باشد.",
  TOO_FEW_LINES: "سند باید حداقل دو ردیف داشته باشد.",
  NON_POSTING_ACCOUNT: "ثبت روی حساب غیرقابل‌ثبت یا غیرفعال مجاز نیست.",
  FISCAL_YEAR_CLOSED: "سال مالی بسته است؛ ثبت جدید مجاز نیست.",
  POSTED_ENTRY_IMMUTABLE: "سند ثبت‌قطعی‌شده قابل ویرایش یا حذف نیست.",
  CANNOT_DELETE_POSTED: "حذف سند ثبت‌شده مجاز نیست؛ از سند برگشت استفاده کنید.",
  DRAFTS_EXIST: "اسناد پیش‌نویس در این سال مالی وجود دارد.",
  MISSING_ACCOUNTS: "حساب‌های لازم برای ثبت مشخص نشده‌اند.",
  BANK_ACCOUNT_UNLINKED: "حساب بانکی به یک حساب حسابداری متصل نشده است.",
  INVALID_STATUS_TRANSITION: "تغییر وضعیت در این مرحله مجاز نیست.",
  INVALID_SCOPE: "دامنهٔ شماره‌گذاری نامعتبر است.",
  INVALID_VALUE: "مقدار واردشده نامعتبر است.",
  ONLY_NIL_ISSUED_FINALIZE: "فقط قراردادهای صادره توسط نیل قابل ثبت نهایی هستند.",
  CANNOT_DELETE_NON_DRAFT: "حذف این رکورد پس از خروج از پیش‌نویس مجاز نیست.",
  EXTERNAL_NUMBER_IMMUTABLE: "شمارهٔ اصلی قرارداد قابل تغییر نیست.",
  CUSTOMER_REQUIRED: "برای صدور، انتخاب طرف حساب (مشتری) الزامی است.",
  ONLY_PROFORMA_CONVERTIBLE: "فقط پیش‌فاکتور قابل تبدیل به فاکتور است.",
  ALREADY_CONVERTED: "این پیش‌فاکتور قبلاً به فاکتور تبدیل شده است.",
  USE_RPC_TO_CONVERT: "تبدیل به فاکتور فقط از مسیر مجاز امکان‌پذیر است.",
  ACCOUNTING_DEFAULTS_NOT_CONFIGURED: "ابتدا از تنظیمات، حساب‌های پیش‌فرض حسابداری (دریافتنی و درآمد) را مشخص کنید.",
  ACCOUNTING_DRAFT_ALREADY_EXISTS: "برای این فاکتور قبلاً پیش‌نویس حسابداری ساخته شده است.",
  ALREADY_CLOSED: "این فرصت قبلاً بسته شده است (موفق یا ازدست‌رفته).",
  LOST_REASON_REQUIRED: "برای ثبت ازدست‌رفته، انتخاب دلیل الزامی است.",
  NO_WON_STAGE: "برای این پایپ‌لاین، مرحلهٔ «موفق» تعریف نشده است.",
  NO_LOST_STAGE: "برای این پایپ‌لاین، مرحلهٔ «ازدست‌رفته» تعریف نشده است.",
  STAGE_PIPELINE_MISMATCH: "مرحلهٔ انتخاب‌شده متعلق به این پایپ‌لاین نیست.",
  USE_CLOSE_ACTION: "برای رسیدن به این مرحله از دکمهٔ «موفق»/«ازدست‌رفته» استفاده کنید.",
  TRADE_ONLY: "جزئیات معامله فقط برای فرصت‌های نوع «تجاری/بازرگانی» قابل ثبت است.",
  TASK_SELF_PARENT: "یک کار نمی‌تواند زیرمجموعهٔ خودش باشد.",
  SUBTASK_DEPTH_EXCEEDED: "زیرکار نمی‌تواند خودش زیرکار داشته باشد (حداکثر یک سطح).",
  USE_ACCEPT_OR_REJECT_ACTION: "برای پذیرش/رد، از دکمهٔ مربوطه استفاده کنید.",
  ALREADY_ACCEPTED: "این تحویل‌دادنی قبلاً پذیرفته شده است.",
  ACCEPTED_IS_TERMINAL: "تحویل‌دادنیِ پذیرفته‌شده قابل تغییر نیست.",
  REJECTION_REASON_REQUIRED: "برای رد کردن، درج دلیل الزامی است.",
  REVERSE_DEPENDENCY_EXISTS: "این دو کار قبلاً در جهت معکوس به هم وابسته شده‌اند.",

  // Trade Portal
  TOKEN_INVALID: "این لینک معتبر نیست.",
  TOKEN_EXPIRED: "اعتبار این لینک به پایان رسیده است.",
  ACCESS_REVOKED: "دسترسی این لینک لغو شده است.",
  OFFER_NOT_PUBLISHED: "این آفر هنوز منتشر نشده است.",
  OFFER_NOT_ACTIVE: "این آفر در حال حاضر فعال نیست.",
  INTEREST_DEADLINE_PASSED: "مهلت اعلام تمایل برای این آفر به پایان رسیده است.",
  DOCUMENT_DEADLINE_PASSED: "مهلت ارسال مدارک برای این آفر به پایان رسیده است.",
  DEADLINE_ALREADY_PASSED: "مهلت این آفر گذشته است؛ ابتدا مهلت را تمدید کنید.",
  DEADLINE_MUST_BE_FUTURE: "مهلت جدید باید در آینده باشد.",
  INTEREST_DEADLINE_AFTER_DOCUMENT_DEADLINE: "مهلت اعلام تمایل نمی‌تواند بعد از مهلت ارسال مدارک باشد.",
  DOCUMENT_DEADLINE_BEFORE_INTEREST_DEADLINE: "مهلت ارسال مدارک نمی‌تواند قبل از مهلت اعلام تمایل باشد.",
  INVALID_DEADLINE_TYPE: "نوع مهلت نامعتبر است.",
  BUYER_ALREADY_ASSIGNED: "این شرکت قبلاً به‌عنوان خریدار این آفر تعیین شده است.",
  INVALID_RESPONSE_TYPE: "نوع پاسخ نامعتبر است.",
  INVALID_DOCUMENT_TYPE: "نوع مدرک نامعتبر است.",
  INTEREST_REQUIRED_FOR_UPLOAD: "برای بارگذاری LOI/ICPO ابتدا باید تمایل خود را با گزینهٔ «علاقه‌مندم» اعلام کنید.",

  // Cheque Management
  INVALID_AMOUNT: "مبلغ واردشده نامعتبر است.",
  INVALID_CURRENCY: "واحد پول انتخاب‌شده نامعتبر است.",
  CHEQUE_NUMBER_REQUIRED: "شمارهٔ چک الزامی است.",
  CHEQUE_BOOK_REQUIRED: "برای چک پرداختی، انتخاب دسته‌چک الزامی است.",
  CHEQUE_BOOK_NOT_ACTIVE: "این دسته‌چک فعال نیست.",
  DRAWER_BANK_REQUIRED: "برای چک دریافتی، درج بانک صادرکننده الزامی است.",
  COMPANY_NOT_FOUND: "شرکت انتخاب‌شده یافت نشد.",
  COUNTERPARTY_REQUIRED: "درج نام طرف حساب (ذی‌نفع/صادرکننده) الزامی است.",
  BANK_ACCOUNT_NOT_FOUND: "حساب بانکی انتخاب‌شده یافت نشد.",
  CHEQUE_NOT_DRAFT: "این چک دیگر در وضعیت پیش‌نویس نیست و قابل ویرایش نیست.",
  CHEQUE_WRONG_DIRECTION: "این عملیات برای این نوع چک (دریافتی/پرداختی) مجاز نیست.",
  REASON_REQUIRED: "برای این عملیات، درج دلیل الزامی است.",
  IMMUTABLE_FIELD_CHANGED: "مبلغ، طرف حساب، تاریخ و شمارهٔ چک پس از صدور قابل تغییر نیستند.",

  // Cash Allocations / Verification (Receipts & Payments)
  NOT_VERIFIED: "این سند هنوز تأیید نشده است؛ پیش از ثبت قطعی باید نخست تأیید شود.",
  ALREADY_VERIFIED: "این سند قبلاً تأیید شده است.",
  CASH_DOC_NOT_DRAFT: "این سند دیگر پیش‌نویس نیست و قابل ویرایش/تخصیص نیست.",
  INVALID_SOURCE_KIND: "نوع سند نامعتبر است.",
  INVALID_TARGET_TYPE: "نوع هدف تخصیص نامعتبر است.",
  INVALID_ALLOCATION_AMOUNT: "مبلغ تخصیص باید بزرگ‌تر از صفر باشد.",
  ALLOCATION_TARGET_REQUIRED: "برای این نوع تخصیص، انتخاب سند/قرارداد هدف الزامی است.",
  ALLOCATION_ON_ACCOUNT_NO_TARGET: "تخصیص «در حساب» نباید هدف مشخصی داشته باشد.",
  SOURCE_OVER_ALLOCATED: "جمع تخصیص‌ها از مبلغ سند بیشتر است.",
  TARGET_OVER_ALLOCATED: "این تخصیص از مبلغ باقی‌ماندهٔ سند/قرارداد هدف بیشتر است.",

  // HR & Payroll (Personnel + Employment)
  FIRST_NAME_REQUIRED: "درج نام الزامی است.",
  LAST_NAME_REQUIRED: "درج نام خانوادگی الزامی است.",
  START_DATE_BEFORE_CURRENT_RECORD: "تاریخ شروع نمی‌تواند قبل از رکورد اشتغال فعلی باشد.",
  REHIRE_REQUIRES_EMPLOYMENT_DETAILS: "برای بازگشت به کار، درج سمت و نوع همکاری جدید الزامی است.",
  EMPLOYMENT_RECORD_CLOSED_IMMUTABLE: "این رکورد اشتغال بسته شده و دیگر قابل تغییر نیست.",
  EMPLOYMENT_RECORD_FIELD_IMMUTABLE: "این فیلد پس از ثبت رکورد اشتغال قابل تغییر نیست؛ برای اصلاح، رکورد جدید ثبت کنید.",

  // HR & Payroll — Phase 2 (configuration layer)
  PAYROLL_VERSION_CLOSED_IMMUTABLE: "این نسخه بسته شده و دیگر قابل تغییر نیست؛ برای اصلاح، نسخهٔ جدید ثبت کنید.",
  PAYROLL_VERSION_FIELD_IMMUTABLE: "این فیلد پس از ثبت نسخه قابل تغییر نیست؛ برای اصلاح، نسخهٔ جدید ثبت کنید.",
  PAYROLL_NO_DELETE: "حذف اطلاعات حقوق و دستمزد مجاز نیست؛ در صورت نیاز آن را غیرفعال کنید.",
  PAYROLL_START_BEFORE_CURRENT: "تاریخ شروع نمی‌تواند قبل از تاریخ شروع نسخهٔ فعلی باشد.",
  COMPONENT_CODE_INVALID: "کد جزء حقوقی باید با حرف لاتین بزرگ شروع شود و فقط شامل حروف بزرگ، رقم و خط زیر باشد.",
  COMPONENT_CODE_DUPLICATE: "این کد قبلاً برای جزء حقوقی دیگری استفاده شده است.",
  COMPONENT_CODE_IMMUTABLE: "کد و نوع جزء حقوقی پس از ثبت قابل تغییر نیست.",
  COMPONENT_NAME_REQUIRED: "درج نام فارسی جزء حقوقی الزامی است.",
  COMPONENT_INVALID_COMBINATION: "ترکیب روش محاسبه، مبلغ، درصد و مبنای قانونی انتخاب‌شده معتبر نیست.",
  COMPONENT_INACTIVE: "این جزء حقوقی غیرفعال است.",
  COMPONENT_NOT_EFFECTIVE: "برای این جزء حقوقی در تاریخ شروع انتخاب‌شده تعریف معتبری وجود ندارد.",
  COMPONENT_CURRENCY_MISMATCH: "واحد پول مبلغ پیش‌فرض این جزء با واحد پول حقوق یکسان نیست؛ مبلغ را دستی وارد کنید.",
  COMPONENT_OVERRIDE_NOT_ALLOWED: "برای این جزء، جایگزینی مبلغ یا درصد مجاز نیست.",
  COMPONENT_AMOUNT_MISSING: "برای این جزء، مبلغ یا درصد تعیین نشده است.",
  BASE_SALARY_IS_PROFILE_FIELD: "حقوق پایه در خود پروفایل ثبت می‌شود و به‌عنوان ردیف جزء حقوقی مجاز نیست.",
  LINE_DUPLICATE_COMPONENT: "هر جزء حقوقی را فقط یک‌بار می‌توان در هر نسخه افزود.",
  HOURLY_RATE_REQUIRED: "برای دورهٔ پرداخت ساعتی، نرخ ساعتی الزامی است.",
  EFFECTIVE_RANGE_INVALID: "بازهٔ اعتبار نامعتبر است؛ تاریخ پایان باید بعد از تاریخ شروع باشد.",
  RULE_SET_NAME_REQUIRED: "نام و حوزهٔ قانونی (Jurisdiction) الزامی است.",
  RULE_SET_NOT_DRAFT: "این مجموعه قانون دیگر پیش‌نویس نیست و قابل ویرایش نیست؛ برای اصلاح، نسخهٔ جدید بسازید.",
  RULE_SET_FIELD_IMMUTABLE: "این فیلد مجموعه قانون قابل تغییر نیست.",
  RULE_SET_EMPTY: "مجموعه قانون بدون هیچ قاعده‌ای قابل تأیید نیست.",
  RULE_SET_OVERLAP: "مجموعهٔ تأییدشدهٔ دیگری با همین حوزه، بازهٔ همپوشان و قاعدهٔ مشترک وجود دارد؛ ابتدا آن را بازنشسته کنید یا بازه را اصلاح کنید.",
  RULE_ENTRY_KEY_INVALID: "کلید قاعده باید با حرف لاتین کوچک شروع شود و فقط شامل حروف کوچک، رقم و خط زیر باشد.",
  RULE_ENTRY_VALUE_REQUIRED: "حداقل یکی از مقدار عددی یا مقدار ساختاریافته (JSON) باید وارد شود.",
  PAYMENT_DEST_IDENTIFIER_REQUIRED: "حداقل یکی از شمارهٔ حساب، شبا یا شمارهٔ کارت باید وارد شود.",
  PAYMENT_DEST_IBAN_INVALID: "شمارهٔ شبا نامعتبر است.",
  PAYMENT_DEST_CARD_INVALID: "شمارهٔ کارت نامعتبر است.",
  PAYMENT_DEST_FIELD_IMMUTABLE: "مشخصات حساب پس از ثبت قابل تغییر نیست؛ حساب را غیرفعال و حساب جدید ثبت کنید.",
  PAYMENT_DEST_DEACTIVATED: "این حساب غیرفعال شده و قابل فعال‌سازی مجدد نیست.",
  PAYROLL_PERIOD_INVALID: "ماه یا بازهٔ دورهٔ حقوقی با تقویم شمسی سازگار نیست.",
  PAYROLL_PERIOD_DUPLICATE: "برای این ماه قبلاً دورهٔ حقوقی ثبت شده است.",
  PAYROLL_PERIOD_OVERLAP: "بازهٔ این دوره با دورهٔ حقوقی دیگری همپوشانی دارد.",
  PAYROLL_PERIOD_CLOSED: "این دورهٔ حقوقی بسته است و قابل تغییر نیست.",
  PAYROLL_BATCH_DUPLICATE: "برای این دوره و واحد پول یک دستهٔ فعال وجود دارد؛ ابتدا آن را لغو کنید.",
  PAYROLL_BATCH_NOT_EDITABLE: "در وضعیت فعلی دسته، این تغییر مجاز نیست.",
  PAYROLL_BATCH_CANCELLED: "این دسته لغو شده و قابل تغییر نیست.",
  PAYROLL_BATCH_STALE: "کارکرد، حقوق یا تنظیمات پس از آخرین محاسبه تغییر کرده است؛ ابتدا دوباره محاسبه کنید.",
  PAYROLL_USE_CALCULATE: "برای محاسبه از دکمهٔ «محاسبه» استفاده کنید.",
  PAYROLL_ALREADY_REVIEWED: "این دسته قبلاً بررسی شده است.",
  PAYROLL_JURISDICTION_UNKNOWN: "برای این حوزهٔ قانونی مجموعه‌ای ثبت نشده است.",
  PAYROLL_ROUNDING_INVALID: "تنظیم گرد کردن نامعتبر است.",
  PAYROLL_WORK_DATA_INVALID: "مقادیر کارکرد نامعتبر است (روز ۰ تا ۳۱، ساعت ۰ تا ۷۴۴).",
  PAYROLL_INPUT_COMPONENT_INVALID: "این جزء از نوع «ورود دستی» نیست یا تکراری است.",
  PAYROLL_OVERRIDE_INVALID: "این استثنا مجاز نیست (واحد پول حقوق فرد با دسته یکسان نیست).",
  PAYROLL_NOT_CALCULATED: "این دسته هنوز محاسبه نشده است.",
};

export function persianError(message: string | undefined | null): string {
  if (!message) return "خطای نامشخص رخ داد.";
  for (const key of Object.keys(ERROR_MESSAGES)) {
    if (message.includes(key)) return ERROR_MESSAGES[key];
  }
  console.error("[persianError] unrecognized DB error:", message);
  return "انجام عملیات با خطا مواجه شد. لطفاً دوباره تلاش کنید.";
}

/* ============================ Accounting ================================= */

export const ACCOUNT_TYPE = ["ASSET","LIABILITY","EQUITY","REVENUE","EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPE)[number];
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  ASSET: "دارایی", LIABILITY: "بدهی", EQUITY: "حقوق صاحبان سهام",
  REVENUE: "درآمد", EXPENSE: "هزینه",
};

export const ACCOUNT_NATURE = ["DEBIT","CREDIT"] as const;
export type AccountNature = (typeof ACCOUNT_NATURE)[number];
export const ACCOUNT_NATURE_LABEL: Record<AccountNature, string> = {
  DEBIT: "بدهکار", CREDIT: "بستانکار",
};

export const ACCOUNT_LEVEL_LABEL: Record<number, string> = {
  1: "گروه", 2: "کل", 3: "معین", 4: "تفصیلی",
};

export const POSTING_STATUS = ["DRAFT","POSTED","REVERSED"] as const;
export type PostingStatus = (typeof POSTING_STATUS)[number];
export const POSTING_STATUS_LABEL: Record<PostingStatus, string> = {
  DRAFT: "پیش‌نویس", POSTED: "ثبت قطعی", REVERSED: "برگشت‌خورده",
};
export const POSTING_STATUS_TONE: Record<PostingStatus, string> = {
  DRAFT: "status-draft", POSTED: "status-final", REVERSED: "status-cancelled",
};

export const ALLOCATION_TARGET_TYPE = ["SALES_DOCUMENT", "CONTRACT", "ON_ACCOUNT"] as const;
export type AllocationTargetType = (typeof ALLOCATION_TARGET_TYPE)[number];
export const ALLOCATION_TARGET_TYPE_LABEL: Record<AllocationTargetType, string> = {
  SALES_DOCUMENT: "سند فروش (فاکتور/پیش‌فاکتور)",
  CONTRACT: "قرارداد (پیش‌پرداخت)",
  ON_ACCOUNT: "در حساب (بدون سند مشخص)",
};

export const FISCAL_YEAR_STATUS_LABEL: Record<string, string> = {
  OPEN: "باز", CLOSED: "بسته",
};

export const DETAIL_KIND = ["CUSTOMER","SUPPLIER","EMPLOYEE","SHAREHOLDER","OTHER"] as const;
export type DetailKind = (typeof DETAIL_KIND)[number];
export const DETAIL_KIND_LABEL: Record<DetailKind, string> = {
  CUSTOMER: "مشتری", SUPPLIER: "تأمین‌کننده", EMPLOYEE: "کارمند",
  SHAREHOLDER: "سهامدار", OTHER: "سایر",
};

export const BANK_KIND_LABEL: Record<string, string> = { BANK: "بانک", CASH: "صندوق" };

export const ACCOUNTING_ROLE = ["VIEW","CREATE","POST","ADMIN"] as const;
export type AccountingRole = (typeof ACCOUNTING_ROLE)[number];
export const ACCOUNTING_ROLE_LABEL: Record<AccountingRole, string> = {
  VIEW: "مشاهده", CREATE: "ثبت", POST: "ثبت قطعی", ADMIN: "مدیر مالی",
};

/* ============================ Contracts ================================== */

export const CONTRACT_STATUS = [
  "DRAFT",
  "UNDER_REVIEW",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
  "COMPLETED",
  "EXPIRED",
  "TERMINATED",
  "CANCELLED",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUS)[number];

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  DRAFT: "پیش‌نویس",
  UNDER_REVIEW: "در حال بررسی",
  APPROVED: "تأییدشده",
  ACTIVE: "فعال",
  SUSPENDED: "معلق",
  COMPLETED: "تکمیل‌شده",
  EXPIRED: "منقضی‌شده",
  TERMINATED: "فسخ‌شده",
  CANCELLED: "ابطال‌شده",
};

/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const CONTRACT_STATUS_TONE: Record<ContractStatus, string> = {
  DRAFT: "status-draft",
  UNDER_REVIEW: "status-review",
  APPROVED: "status-final",
  ACTIVE: "status-received",
  SUSPENDED: "status-waiting",
  COMPLETED: "status-closed",
  EXPIRED: "status-cancelled",
  TERMINATED: "status-cancelled",
  CANCELLED: "status-cancelled",
};

export const CONTRACT_KIND = ["NIL_ISSUED", "HISTORICAL"] as const;
export type ContractKind = (typeof CONTRACT_KIND)[number];
export const CONTRACT_KIND_LABEL: Record<ContractKind, string> = {
  NIL_ISSUED: "صادرشده توسط نیل",
  HISTORICAL: "قرارداد سابق",
};

export const CONTRACT_ROLE = ["VIEW", "CREATE", "APPROVE", "ADMIN"] as const;
export type ContractRole = (typeof CONTRACT_ROLE)[number];
export const CONTRACT_ROLE_LABEL: Record<ContractRole, string> = {
  VIEW: "مشاهده", CREATE: "ثبت", APPROVE: "تأیید", ADMIN: "مدیر قراردادها",
};

/* ============================ Invoices/Proforma ========================== */

export const SALES_DOCUMENT_TYPE = ["PROFORMA", "INVOICE"] as const;
export type SalesDocumentType = (typeof SALES_DOCUMENT_TYPE)[number];
export const SALES_DOCUMENT_TYPE_LABEL: Record<SalesDocumentType, string> = {
  PROFORMA: "پیش‌فاکتور",
  INVOICE: "فاکتور",
};

export const SALES_DOCUMENT_STATUS = [
  "DRAFT",
  "REVIEW",
  "APPROVED",
  "ISSUED",
  "ACCEPTED",
  "CONVERTED",
  "EXPIRED",
  "PARTIALLY_SETTLED",
  "SETTLED",
  "OVERDUE",
  "CANCELLED",
] as const;
export type SalesDocumentStatus = (typeof SALES_DOCUMENT_STATUS)[number];

export const SALES_DOCUMENT_STATUS_LABEL: Record<SalesDocumentStatus, string> = {
  DRAFT: "پیش‌نویس",
  REVIEW: "در حال بررسی",
  APPROVED: "تأییدشده",
  ISSUED: "صادرشده",
  ACCEPTED: "پذیرفته‌شده",
  CONVERTED: "تبدیل‌شده به فاکتور",
  EXPIRED: "منقضی‌شده",
  PARTIALLY_SETTLED: "تسویهٔ جزئی",
  SETTLED: "تسویه‌شده",
  OVERDUE: "معوق",
  CANCELLED: "ابطال‌شده",
};

/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const SALES_DOCUMENT_STATUS_TONE: Record<SalesDocumentStatus, string> = {
  DRAFT: "status-draft",
  REVIEW: "status-review",
  APPROVED: "status-final",
  ISSUED: "status-received",
  ACCEPTED: "status-received",
  CONVERTED: "status-closed",
  EXPIRED: "status-cancelled",
  PARTIALLY_SETTLED: "status-waiting",
  SETTLED: "status-closed",
  OVERDUE: "status-cancelled",
  CANCELLED: "status-cancelled",
};

export const SALES_DOCUMENT_ITEM_TYPE = ["GOODS", "SERVICE"] as const;
export type SalesDocumentItemType = (typeof SALES_DOCUMENT_ITEM_TYPE)[number];
export const SALES_DOCUMENT_ITEM_TYPE_LABEL: Record<SalesDocumentItemType, string> = {
  GOODS: "کالا",
  SERVICE: "خدمات",
};

export const INVOICE_ROLE = ["VIEW", "CREATE", "APPROVE", "ADMIN"] as const;
export type InvoiceRole = (typeof INVOICE_ROLE)[number];
export const INVOICE_ROLE_LABEL: Record<InvoiceRole, string> = {
  VIEW: "مشاهده", CREATE: "ثبت", APPROVE: "تأیید/صدور", ADMIN: "مدیر فاکتورها",
};

export const CURRENCY = ["IRR", "TOMAN", "USD", "EUR", "AED", "TRY", "CNY"] as const;
export type Currency = (typeof CURRENCY)[number];
export const CURRENCY_LABEL: Record<Currency, string> = {
  IRR: "ریال",
  TOMAN: "تومان",
  USD: "دلار آمریکا",
  EUR: "یورو",
  AED: "درهم امارات",
  TRY: "لیر ترکیه",
  CNY: "یوان چین",
};

/* ============================ CRM ========================================= */

export const CRM_COMPANY_STATUS = ["PROSPECT", "ACTIVE", "INACTIVE", "BLOCKED", "ARCHIVED"] as const;
export type CrmCompanyStatus = (typeof CRM_COMPANY_STATUS)[number];
export const CRM_COMPANY_STATUS_LABEL: Record<CrmCompanyStatus, string> = {
  PROSPECT: "مشتری بالقوه",
  ACTIVE: "فعال",
  INACTIVE: "غیرفعال",
  BLOCKED: "مسدود",
  ARCHIVED: "بایگانی‌شده",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const CRM_COMPANY_STATUS_TONE: Record<CrmCompanyStatus, string> = {
  PROSPECT: "status-waiting",
  ACTIVE: "status-received",
  INACTIVE: "status-draft",
  BLOCKED: "status-cancelled",
  ARCHIVED: "status-closed",
};

export const CRM_COMPANY_ROLE = [
  "CUSTOMER", "PROSPECT", "LEAD", "BUYER", "SELLER", "SUPPLIER",
  "PARTNER", "AGENT", "BROKER", "SERVICE_PROVIDER", "OTHER",
] as const;
export type CrmCompanyRole = (typeof CRM_COMPANY_ROLE)[number];
export const CRM_COMPANY_ROLE_LABEL: Record<CrmCompanyRole, string> = {
  CUSTOMER: "مشتری",
  PROSPECT: "مشتری بالقوه",
  LEAD: "سرنخ",
  BUYER: "خریدار",
  SELLER: "فروشنده",
  SUPPLIER: "تأمین‌کننده",
  PARTNER: "شریک تجاری",
  AGENT: "نماینده",
  BROKER: "واسطه",
  SERVICE_PROVIDER: "ارائه‌دهندهٔ خدمات",
  OTHER: "سایر",
};

export const CRM_CONTACT_ROLE = [
  "OWNER", "CEO", "MANAGING_DIRECTOR", "COMMERCIAL_MANAGER", "SALES",
  "PROCUREMENT", "FINANCE", "LEGAL", "TECHNICAL", "REPRESENTATIVE", "BROKER", "OTHER",
] as const;
export type CrmContactRole = (typeof CRM_CONTACT_ROLE)[number];
export const CRM_CONTACT_ROLE_LABEL: Record<CrmContactRole, string> = {
  OWNER: "مالک",
  CEO: "مدیرعامل",
  MANAGING_DIRECTOR: "مدیر اجرایی",
  COMMERCIAL_MANAGER: "مدیر بازرگانی",
  SALES: "فروش",
  PROCUREMENT: "خرید",
  FINANCE: "مالی",
  LEGAL: "حقوقی",
  TECHNICAL: "فنی",
  REPRESENTATIVE: "نماینده",
  BROKER: "واسطه",
  OTHER: "سایر",
};

export const CRM_OPPORTUNITY_TYPE = ["TRADE", "SERVICE", "PROJECT", "PARTNERSHIP", "AGENCY", "OTHER"] as const;
export type CrmOpportunityType = (typeof CRM_OPPORTUNITY_TYPE)[number];
export const CRM_OPPORTUNITY_TYPE_LABEL: Record<CrmOpportunityType, string> = {
  TRADE: "تجاری/بازرگانی",
  SERVICE: "خدماتی",
  PROJECT: "پروژه",
  PARTNERSHIP: "مشارکت",
  AGENCY: "نمایندگی",
  OTHER: "سایر",
};

export const CRM_OPPORTUNITY_PRIORITY = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type CrmOpportunityPriority = (typeof CRM_OPPORTUNITY_PRIORITY)[number];
export const CRM_OPPORTUNITY_PRIORITY_LABEL: Record<CrmOpportunityPriority, string> = {
  LOW: "کم", NORMAL: "عادی", HIGH: "بالا", URGENT: "فوری",
};

export const CRM_LOST_REASON = [
  "PRICE", "NO_RESPONSE", "COMPETITOR", "PAYMENT_TERMS", "DELIVERY",
  "COMPLIANCE", "PRODUCT_UNAVAILABLE", "CUSTOMER_CANCELLED", "OTHER",
] as const;
export type CrmLostReason = (typeof CRM_LOST_REASON)[number];
export const CRM_LOST_REASON_LABEL: Record<CrmLostReason, string> = {
  PRICE: "قیمت",
  NO_RESPONSE: "بی‌پاسخی مشتری",
  COMPETITOR: "رقیب",
  PAYMENT_TERMS: "شرایط پرداخت",
  DELIVERY: "تحویل",
  COMPLIANCE: "الزامات قانونی/تطبیقی",
  PRODUCT_UNAVAILABLE: "عدم موجودی کالا",
  CUSTOMER_CANCELLED: "انصراف مشتری",
  OTHER: "سایر",
};

export const CRM_ACTIVITY_TYPE = [
  "CALL", "EMAIL", "WHATSAPP", "TELEGRAM", "MEETING", "VIDEO_CALL", "NOTE",
  "NEGOTIATION", "QUOTATION_SENT", "QUOTATION_RECEIVED", "DOCUMENT_SENT", "DOCUMENT_RECEIVED", "OTHER",
] as const;
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPE)[number];
export const CRM_ACTIVITY_TYPE_LABEL: Record<CrmActivityType, string> = {
  CALL: "تماس تلفنی",
  EMAIL: "ایمیل",
  WHATSAPP: "واتساپ",
  TELEGRAM: "تلگرام",
  MEETING: "جلسه",
  VIDEO_CALL: "تماس تصویری",
  NOTE: "یادداشت",
  NEGOTIATION: "مذاکره",
  QUOTATION_SENT: "ارسال پیشنهاد قیمت",
  QUOTATION_RECEIVED: "دریافت پیشنهاد قیمت",
  DOCUMENT_SENT: "ارسال سند",
  DOCUMENT_RECEIVED: "دریافت سند",
  OTHER: "سایر",
};

export const CRM_ACTIVITY_DIRECTION_LABEL: Record<"INBOUND" | "OUTBOUND" | "INTERNAL", string> = {
  INBOUND: "دریافتی",
  OUTBOUND: "ارسالی",
  INTERNAL: "داخلی",
};

export const CRM_ROLE = ["VIEW", "CREATE", "APPROVE", "ADMIN"] as const;
export type CrmRole = (typeof CRM_ROLE)[number];
export const CRM_ROLE_LABEL: Record<CrmRole, string> = {
  VIEW: "مشاهده", CREATE: "ثبت", APPROVE: "تأیید/بستن فرصت", ADMIN: "مدیر CRM",
};

/* ============================ CRM Phase 2 ================================= */

export const CRM_TRADE_FREQUENCY = ["ONE_TIME", "MONTHLY"] as const;
export type CrmTradeFrequency = (typeof CRM_TRADE_FREQUENCY)[number];
export const CRM_TRADE_FREQUENCY_LABEL: Record<CrmTradeFrequency, string> = {
  ONE_TIME: "یک‌باره",
  MONTHLY: "ماهانه",
};

export const CRM_OPPORTUNITY_PARTY_ROLE = [
  "BUYER", "SELLER", "SUPPLIER", "BROKER", "AGENT", "END_BUYER", "END_SELLER", "LOGISTICS", "OTHER",
] as const;
export type CrmOpportunityPartyRole = (typeof CRM_OPPORTUNITY_PARTY_ROLE)[number];
export const CRM_OPPORTUNITY_PARTY_ROLE_LABEL: Record<CrmOpportunityPartyRole, string> = {
  BUYER: "خریدار",
  SELLER: "فروشنده",
  SUPPLIER: "تأمین‌کننده",
  BROKER: "واسطه",
  AGENT: "نماینده",
  END_BUYER: "خریدار نهایی",
  END_SELLER: "فروشندهٔ نهایی",
  LOGISTICS: "حمل‌ونقل",
  OTHER: "سایر",
};

export const CRM_QUOTATION_DIRECTION_LABEL: Record<"SENT" | "RECEIVED", string> = {
  SENT: "ارسالی",
  RECEIVED: "دریافتی",
};

/* ============================ Projects & Tasks ============================ */

export const PROJECT_TYPE = [
  "SOFTWARE", "CONSULTING", "SERVICE", "INTERNAL", "TRADE", "RESEARCH", "IMPLEMENTATION", "SUPPORT", "OTHER",
] as const;
export type ProjectType = (typeof PROJECT_TYPE)[number];
export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  SOFTWARE: "نرم‌افزاری",
  CONSULTING: "مشاوره",
  SERVICE: "خدماتی",
  INTERNAL: "داخلی",
  TRADE: "تجاری/بازرگانی",
  RESEARCH: "تحقیقاتی",
  IMPLEMENTATION: "پیاده‌سازی",
  SUPPORT: "پشتیبانی",
  OTHER: "سایر",
};

export const PROJECT_STATUS = ["DRAFT", "PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED", "ARCHIVED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "پیش‌نویس",
  PLANNED: "برنامه‌ریزی‌شده",
  ACTIVE: "فعال",
  ON_HOLD: "متوقف‌شده",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
  ARCHIVED: "بایگانی‌شده",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  DRAFT: "status-draft",
  PLANNED: "status-review",
  ACTIVE: "status-received",
  ON_HOLD: "status-waiting",
  COMPLETED: "status-closed",
  CANCELLED: "status-cancelled",
  ARCHIVED: "status-closed",
};

export const PM_PRIORITY = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type PmPriority = (typeof PM_PRIORITY)[number];
export const PM_PRIORITY_LABEL: Record<PmPriority, string> = {
  LOW: "کم", NORMAL: "عادی", HIGH: "بالا", URGENT: "فوری",
};

export const PHASE_STATUS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type PhaseStatus = (typeof PHASE_STATUS)[number];
export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  NOT_STARTED: "شروع‌نشده",
  IN_PROGRESS: "در حال انجام",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};

export const PROJECT_MILESTONE_STATUS = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type ProjectMilestoneStatus = (typeof PROJECT_MILESTONE_STATUS)[number];
export const PROJECT_MILESTONE_STATUS_LABEL: Record<ProjectMilestoneStatus, string> = {
  PLANNED: "برنامه‌ریزی‌شده",
  IN_PROGRESS: "در حال انجام",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};

export const PROJECT_MEMBER_ROLE = ["PROJECT_MANAGER", "MEMBER", "REVIEWER", "OBSERVER"] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLE)[number];
export const PROJECT_MEMBER_ROLE_LABEL: Record<ProjectMemberRole, string> = {
  PROJECT_MANAGER: "مدیر پروژه",
  MEMBER: "عضو",
  REVIEWER: "بازبین",
  OBSERVER: "ناظر",
};

export const TASK_STATUS = ["TODO", "IN_PROGRESS", "BLOCKED", "WAITING", "DONE", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "برای انجام",
  IN_PROGRESS: "در حال انجام",
  BLOCKED: "مسدود",
  WAITING: "در انتظار",
  DONE: "انجام‌شده",
  CANCELLED: "لغوشده",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const TASK_STATUS_TONE: Record<TaskStatus, string> = {
  TODO: "status-draft",
  IN_PROGRESS: "status-review",
  BLOCKED: "status-cancelled",
  WAITING: "status-waiting",
  DONE: "status-closed",
  CANCELLED: "status-cancelled",
};

export const PROJECT_ROLE = ["VIEW", "CREATE", "APPROVE", "ADMIN"] as const;
export type ProjectRole = (typeof PROJECT_ROLE)[number];
export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = {
  VIEW: "مشاهده", CREATE: "ثبت", APPROVE: "تأیید/صدور شماره", ADMIN: "مدیر پروژه‌ها",
};

/* ============================ Projects & Tasks Phase 2 ==================== */

export const DELIVERABLE_STATUS = ["PLANNED", "IN_PROGRESS", "READY_FOR_REVIEW", "ACCEPTED", "REJECTED", "CANCELLED"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUS)[number];
export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  PLANNED: "برنامه‌ریزی‌شده",
  IN_PROGRESS: "در حال انجام",
  READY_FOR_REVIEW: "آمادهٔ بررسی",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "ردشده",
  CANCELLED: "لغوشده",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const DELIVERABLE_STATUS_TONE: Record<DeliverableStatus, string> = {
  PLANNED: "status-draft",
  IN_PROGRESS: "status-review",
  READY_FOR_REVIEW: "status-waiting",
  ACCEPTED: "status-closed",
  REJECTED: "status-cancelled",
  CANCELLED: "status-cancelled",
};

/* ============================ Trade Portal ================================ */

export const TRADE_ROLE = ["VIEW", "CREATE", "APPROVE", "ADMIN"] as const;
export type TradeRole = (typeof TRADE_ROLE)[number];
export const TRADE_ROLE_LABEL: Record<TradeRole, string> = {
  VIEW: "مشاهده", CREATE: "ثبت/مدیریت خریداران", APPROVE: "انتشار/تأیید/تمدید مهلت", ADMIN: "مدیر پورتال معاملات",
};

export const TRADE_OFFER_STATUS = ["DRAFT", "ACTIVE", "EXPIRED", "CLOSED", "CANCELLED"] as const;
export type TradeOfferStatus = (typeof TRADE_OFFER_STATUS)[number];
export const TRADE_OFFER_STATUS_LABEL: Record<TradeOfferStatus, string> = {
  DRAFT: "پیش‌نویس",
  ACTIVE: "فعال",
  EXPIRED: "منقضی‌شده",
  CLOSED: "بسته‌شده",
  CANCELLED: "لغوشده",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const TRADE_OFFER_STATUS_TONE: Record<TradeOfferStatus, string> = {
  DRAFT: "status-draft",
  ACTIVE: "status-received",
  EXPIRED: "status-cancelled",
  CLOSED: "status-closed",
  CANCELLED: "status-cancelled",
};

export const TRADE_RESPONSE_TYPE = ["INTERESTED", "NOT_INTERESTED", "REQUEST_MORE_TIME"] as const;
export type TradeResponseType = (typeof TRADE_RESPONSE_TYPE)[number];
export const TRADE_RESPONSE_TYPE_LABEL: Record<TradeResponseType, string> = {
  INTERESTED: "علاقه‌مندم",
  NOT_INTERESTED: "تمایل ندارم",
  REQUEST_MORE_TIME: "درخواست زمان بیشتر دارم",
};

export const TRADE_DOCUMENT_TYPE = ["LOI", "ICPO"] as const;
export type TradeDocumentType = (typeof TRADE_DOCUMENT_TYPE)[number];
export const TRADE_DOCUMENT_TYPE_LABEL: Record<TradeDocumentType, string> = {
  LOI: "LOI (اعلام نیت خرید)",
  ICPO: "ICPO (سفارش خرید مشروط)",
};

export const TRADE_DEADLINE_TYPE = ["INTEREST", "DOCUMENT"] as const;
export type TradeDeadlineType = (typeof TRADE_DEADLINE_TYPE)[number];
export const TRADE_DEADLINE_TYPE_LABEL: Record<TradeDeadlineType, string> = {
  INTEREST: "مهلت اعلام تمایل",
  DOCUMENT: "مهلت ارسال LOI/ICPO",
};

/** Every event_type value the 0066 migration's CHECK constraint allows, for admin-timeline display. */
export const TRADE_EVENT_TYPE_LABEL: Record<string, string> = {
  OFFER_CREATED: "آفر ایجاد شد",
  OFFER_UPDATED: "آفر ویرایش شد",
  OFFER_PUBLISHED: "آفر منتشر شد",
  OFFER_VIEWED: "خریدار آفر را مشاهده کرد",
  BUYER_ASSIGNED: "خریدار تعیین شد",
  BUYER_ACCESS_CREATED: "لینک دسترسی صادر شد",
  BUYER_RESPONSE_SUBMITTED: "پاسخ خریدار ثبت شد",
  MORE_TIME_REQUESTED: "درخواست زمان بیشتر ثبت شد",
  DOCUMENT_UPLOADED: "مدرک بارگذاری شد",
  DEADLINE_EXTENDED: "مهلت تمدید شد",
  OFFER_EXPIRED: "آفر منقضی شد",
  OFFER_CLOSED: "آفر بسته شد",
  OFFER_CANCELLED: "آفر لغو شد",
  ACCESS_REVOKED: "دسترسی خریدار لغو شد",
};

/**
 * The exact legal disclaimer required on every Buyer Portal page
 * (spec §18) — must render verbatim, at normal size, never hidden.
 */
export const TRADE_LEGAL_DISCLAIMER =
  "این پیشنهاد صرفاً جهت بررسی و اعلام تمایل اولیه ارائه شده است. قیمت، موجودی و شرایط نهایی در زمان دریافت درخواست رسمی خریدار مجدداً توسط فروشنده تأیید خواهد شد. مشاهده یا تأیید این آفر به‌منزله رزرو کالا یا ایجاد تعهد قطعی برای طرفین نیست.";

/* ============================ Executive Dashboard =========================== */

export const ATTENTION_SEVERITY = ["INFO", "WARNING", "HIGH", "CRITICAL"] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITY)[number];
export const ATTENTION_SEVERITY_LABEL: Record<AttentionSeverity, string> = {
  INFO: "اطلاعاتی", WARNING: "هشدار", HIGH: "مهم", CRITICAL: "بحرانی",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const ATTENTION_SEVERITY_TONE: Record<AttentionSeverity, string> = {
  INFO: "status-review", WARNING: "status-waiting", HIGH: "status-cancelled", CRITICAL: "status-cancelled",
};

/**
 * Deterministic rule codes the Attention Engine can produce
 * (lib/dashboard/attention.ts) — every attention item traces back to
 * exactly one of these (spec §45/§46: rule-based, explainable, never
 * AI-labeled). CONTRACT_OBLIGATION_OVERDUE is intentionally absent —
 * Contract Obligations was never built in this codebase.
 */
export const ATTENTION_RULE_LABEL: Record<string, string> = {
  TASK_OVERDUE: "کار عقب‌افتاده",
  TASK_BLOCKED_URGENT: "کار فوری مسدودشده",
  FOLLOWUP_OVERDUE: "پیگیری عقب‌افتاده",
  PROJECT_DELAYED: "پروژهٔ عقب‌افتاده",
  PROJECT_AT_RISK: "پروژهٔ در معرض خطر",
  MILESTONE_OVERDUE: "مایلستون عقب‌افتاده",
  DELIVERABLE_OVERDUE: "تحویل‌دادنی عقب‌افتاده",
  INVOICE_OVERDUE: "فاکتور عقب‌افتاده از سررسید",
  CONTRACT_EXPIRING: "قرارداد نزدیک به پایان",
  CONTRACT_EXPIRED_STILL_ACTIVE: "قرارداد منقضی‌شدهٔ همچنان فعال",
  CRM_STALE: "فرصت تجاری بدون فعالیت",
  CRM_NEXT_ACTION_OVERDUE: "اقدام بعدی فرصت تجاری عقب‌افتاده",
};

/* ============================ Client Service Ledger — Phase 1 =========================== */

export const SERVICE_LEDGER_ROLE = ["VIEW", "CREATE", "APPROVE", "ADMIN"] as const;
export type ServiceLedgerRole = (typeof SERVICE_LEDGER_ROLE)[number];
export const SERVICE_LEDGER_ROLE_LABEL: Record<ServiceLedgerRole, string> = {
  VIEW: "مشاهده", CREATE: "ثبت", APPROVE: "تأیید", ADMIN: "مدیر خدمات مشتری",
};

export const CLIENT_SERVICE_STATUS = ["ACTIVE", "ON_HOLD", "CLOSED", "ARCHIVED"] as const;
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUS)[number];
export const CLIENT_SERVICE_STATUS_LABEL: Record<ClientServiceStatus, string> = {
  ACTIVE: "فعال", ON_HOLD: "متوقف‌شده", CLOSED: "بسته‌شده", ARCHIVED: "بایگانی‌شده",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const CLIENT_SERVICE_STATUS_TONE: Record<ClientServiceStatus, string> = {
  ACTIVE: "status-received", ON_HOLD: "status-waiting", CLOSED: "status-closed", ARCHIVED: "status-cancelled",
};

export const SERVICE_ARRANGEMENT_TYPE = [
  "RETAINER", "FIXED_FEE", "HOURLY", "PER_SERVICE", "PROJECT_BASED", "CONTRACT_INCLUDED", "CUSTOM",
] as const;
export type ServiceArrangementType = (typeof SERVICE_ARRANGEMENT_TYPE)[number];
export const SERVICE_ARRANGEMENT_TYPE_LABEL: Record<ServiceArrangementType, string> = {
  RETAINER: "قرارداد ماهانه (Retainer)",
  FIXED_FEE: "حق‌الزحمهٔ ثابت",
  HOURLY: "ساعتی",
  PER_SERVICE: "به‌ازای هر خدمت",
  PROJECT_BASED: "پروژه‌محور",
  CONTRACT_INCLUDED: "داخل قرارداد",
  CUSTOM: "سفارشی",
};

export const SERVICE_ARRANGEMENT_STATUS = ["DRAFT", "ACTIVE", "SUSPENDED", "COMPLETED", "CANCELLED"] as const;
export type ServiceArrangementStatus = (typeof SERVICE_ARRANGEMENT_STATUS)[number];
export const SERVICE_ARRANGEMENT_STATUS_LABEL: Record<ServiceArrangementStatus, string> = {
  DRAFT: "پیش‌نویس", ACTIVE: "فعال", SUSPENDED: "معلق", COMPLETED: "تکمیل‌شده", CANCELLED: "لغوشده",
};

export const BILLING_CYCLE = ["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"] as const;
export type BillingCycle = (typeof BILLING_CYCLE)[number];
export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: "ماهانه", QUARTERLY: "فصلی", ANNUAL: "سالانه", ONE_TIME: "یک‌باره",
};

export const SERVICE_ENTRY_STATUS = ["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type ServiceEntryStatus = (typeof SERVICE_ENTRY_STATUS)[number];
export const SERVICE_ENTRY_STATUS_LABEL: Record<ServiceEntryStatus, string> = {
  DRAFT: "پیش‌نویس", IN_PROGRESS: "در حال انجام", COMPLETED: "تکمیل‌شده", CANCELLED: "لغوشده",
};

/** All 8 spec values. INVOICED/WAIVED are reachable since Phase 2 (billing batches, waiver) but ONLY through the guarded paths (convert_billing_batch_to_sales_document RPC / the waive actions) — never through a generic entry/expense edit form. PARTIALLY_SETTLED/SETTLED are still unreachable (deliberately deferred — see the Phase 2 plan's "collection status is read via the linked sales_document instead" note). */
export const BILLING_STATUS = [
  "NON_BILLABLE", "INCLUDED", "BILLABLE", "READY_TO_BILL", "INVOICED", "PARTIALLY_SETTLED", "SETTLED", "WAIVED",
] as const;
/** Only the values a generic entry/expense edit FORM may ever write — WAIVED/INVOICED go through their own dedicated, guarded actions instead. */
export const BILLING_STATUS_PHASE1 = ["NON_BILLABLE", "INCLUDED", "BILLABLE", "READY_TO_BILL"] as const;
export type BillingStatus = (typeof BILLING_STATUS)[number];
export const BILLING_STATUS_LABEL: Record<BillingStatus, string> = {
  NON_BILLABLE: "غیرقابل مطالبه",
  INCLUDED: "داخل قرارداد/Retainer",
  BILLABLE: "قابل مطالبه",
  READY_TO_BILL: "آمادهٔ صورتحساب",
  INVOICED: "فاکتورشده",
  PARTIALLY_SETTLED: "بخشی وصول‌شده",
  SETTLED: "تسویه‌شده",
  WAIVED: "بخشوده‌شده",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const BILLING_STATUS_TONE: Record<BillingStatus, string> = {
  NON_BILLABLE: "status-cancelled",
  INCLUDED: "status-draft",
  BILLABLE: "status-waiting",
  READY_TO_BILL: "status-review",
  INVOICED: "status-final",
  PARTIALLY_SETTLED: "status-waiting",
  SETTLED: "status-closed",
  WAIVED: "status-cancelled",
};

export const EXPENSE_PAID_BY = ["NIL", "CLIENT", "EMPLOYEE", "OTHER"] as const;
export type ExpensePaidBy = (typeof EXPENSE_PAID_BY)[number];
export const EXPENSE_PAID_BY_LABEL: Record<ExpensePaidBy, string> = {
  NIL: "نیل", CLIENT: "مشتری", EMPLOYEE: "کارمند", OTHER: "سایر",
};

/* ============================ Client Service Ledger — Phase 2 (Billing) =========================== */

export const BILLING_BATCH_STATUS = ["DRAFT", "READY", "CONVERTED", "CANCELLED"] as const;
export type BillingBatchStatus = (typeof BILLING_BATCH_STATUS)[number];
export const BILLING_BATCH_STATUS_LABEL: Record<BillingBatchStatus, string> = {
  DRAFT: "پیش‌نویس", READY: "آماده", CONVERTED: "صادرشده", CANCELLED: "لغوشده",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const BILLING_BATCH_STATUS_TONE: Record<BillingBatchStatus, string> = {
  DRAFT: "status-draft", READY: "status-review", CONVERTED: "status-final", CANCELLED: "status-cancelled",
};

export const BILLING_BATCH_SOURCE_TYPE = ["SERVICE_ENTRY", "TIME_ENTRY", "EXPENSE", "MANUAL_ADJUSTMENT"] as const;
export type BillingBatchSourceType = (typeof BILLING_BATCH_SOURCE_TYPE)[number];
export const BILLING_BATCH_SOURCE_TYPE_LABEL: Record<BillingBatchSourceType, string> = {
  SERVICE_ENTRY: "حق‌الزحمهٔ خدمت", TIME_ENTRY: "زمان صرف‌شده", EXPENSE: "هزینه", MANUAL_ADJUSTMENT: "ردیف دستی",
};

/* ============================ Client Service Ledger — Phase 4 (PDF Report Builder) =========================== */

export const REPORT_TYPE = ["CLIENT_PERFORMANCE_REPORT", "CLIENT_FINANCIAL_REPORT", "CLIENT_FULL_REPORT", "CUSTOM_REPORT"] as const;
export type ReportType = (typeof REPORT_TYPE)[number];
export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  CLIENT_PERFORMANCE_REPORT: "گزارش عملکرد مشتری",
  CLIENT_FINANCIAL_REPORT: "گزارش مالی مشتری",
  CLIENT_FULL_REPORT: "گزارش کامل مشتری",
  CUSTOM_REPORT: "گزارش سفارشی",
};

export const REPORT_DETAIL_LEVEL = ["SUMMARY", "STANDARD", "DETAILED"] as const;
export type ReportDetailLevel = (typeof REPORT_DETAIL_LEVEL)[number];
export const REPORT_DETAIL_LEVEL_LABEL: Record<ReportDetailLevel, string> = {
  SUMMARY: "خلاصه", STANDARD: "استاندارد", DETAILED: "کامل",
};

export const REPORT_TEMPLATE_SCOPE = ["GLOBAL", "CLIENT"] as const;
export type ReportTemplateScope = (typeof REPORT_TEMPLATE_SCOPE)[number];
export const REPORT_TEMPLATE_SCOPE_LABEL: Record<ReportTemplateScope, string> = {
  GLOBAL: "سراسری (همهٔ مشتریان)", CLIENT: "اختصاصی این مشتری",
};

/** Matches allowed_report_sections()'s SQL array 1:1 (migration 0093) — client and server must never drift. */
export const REPORT_SECTION = [
  "COVER_PAGE", "EXECUTIVE_SUMMARY", "SERVICES_PERFORMED", "SERVICE_DATE", "SERVICE_CATEGORY",
  "SERVICE_DESCRIPTION", "SERVICE_PERFORMER", "TIME_SPENT", "CONTRACTS_RELATED", "PROJECTS_RELATED",
  "DIRECT_EXPENSES", "REIMBURSABLE_EXPENSES", "SERVICE_FEES", "CLAIMABLE_AMOUNTS", "INVOICES_PROFORMAS",
  "AMOUNTS_RECEIVED", "OUTSTANDING_AMOUNT", "BILLING_SUMMARY", "DOCUMENTS_REFERENCE", "PERIOD_SUMMARY",
  "CUSTOM_NOTES", "FINAL_SUMMARY",
] as const;
export type ReportSection = (typeof REPORT_SECTION)[number];
export const REPORT_SECTION_LABEL: Record<ReportSection, string> = {
  COVER_PAGE: "صفحهٔ عنوان",
  EXECUTIVE_SUMMARY: "خلاصهٔ مدیریتی",
  SERVICES_PERFORMED: "خدمات انجام‌شده",
  SERVICE_DATE: "تاریخ خدمت",
  SERVICE_CATEGORY: "دسته‌بندی خدمت",
  SERVICE_DESCRIPTION: "شرح خدمت",
  SERVICE_PERFORMER: "انجام‌دهندهٔ خدمت",
  TIME_SPENT: "زمان صرف‌شده",
  CONTRACTS_RELATED: "قراردادهای مرتبط",
  PROJECTS_RELATED: "پروژه‌های مرتبط",
  DIRECT_EXPENSES: "هزینه‌های مستقیم",
  REIMBURSABLE_EXPENSES: "هزینه‌های قابل بازپرداخت",
  SERVICE_FEES: "حق‌الزحمه‌های خدمات",
  CLAIMABLE_AMOUNTS: "مبالغ قابل مطالبه",
  INVOICES_PROFORMAS: "فاکتورها / پیش‌فاکتورها",
  AMOUNTS_RECEIVED: "مبالغ وصول‌شده",
  OUTSTANDING_AMOUNT: "مانده",
  BILLING_SUMMARY: "خلاصهٔ صورتحساب",
  DOCUMENTS_REFERENCE: "ارجاع مستندات",
  PERIOD_SUMMARY: "خلاصهٔ بازه",
  CUSTOM_NOTES: "یادداشت سفارشی",
  FINAL_SUMMARY: "جمع‌بندی پایانی",
};

/** Matches allowed_report_sections()'s field portion 1:1 — the "Services Performed" table's selectable columns. */
export const REPORT_FIELD = [
  "DATE", "CATEGORY", "SERVICE_TITLE", "DESCRIPTION", "PERFORMER",
  "DURATION", "SERVICE_FEE", "EXPENSE", "CLAIMABLE_AMOUNT", "BILLING_STATUS",
] as const;
export type ReportField = (typeof REPORT_FIELD)[number];
export const REPORT_FIELD_LABEL: Record<ReportField, string> = {
  DATE: "تاریخ",
  CATEGORY: "دسته‌بندی",
  SERVICE_TITLE: "عنوان خدمت",
  DESCRIPTION: "شرح",
  PERFORMER: "انجام‌دهنده",
  DURATION: "مدت‌زمان",
  SERVICE_FEE: "حق‌الزحمه",
  EXPENSE: "هزینه",
  CLAIMABLE_AMOUNT: "مبلغ قابل مطالبه",
  BILLING_STATUS: "وضعیت صورتحساب",
};

export const REPORT_FAMILY = ["CLIENT", "INTERNAL"] as const;
export type ReportFamily = (typeof REPORT_FAMILY)[number];
export const REPORT_FAMILY_LABEL: Record<ReportFamily, string> = {
  CLIENT: "گزارش مشتری", INTERNAL: "گزارش مدیریتی داخلی (محرمانه)",
};

/** Phase 5 — Internal Management Report only (spec §51). Matches allowed_report_sections('INTERNAL')'s extra 8 keys 1:1 (migration 0095). Never selectable for report_family='CLIENT' — enforced both client-side (ReportBuilderForm only renders these when family=INTERNAL) and at the DB trigger. */
export const REPORT_SECTION_INTERNAL = [
  "INTERNAL_TIME_COST", "DIRECT_NIL_COST", "REVENUE", "REIMBURSED_COST",
  "UNREIMBURSED_COST", "CONTRIBUTION_MARGIN", "PROFITABILITY_ANALYSIS", "INTERNAL_NOTES",
] as const;
export type ReportSectionInternal = (typeof REPORT_SECTION_INTERNAL)[number];
export const REPORT_SECTION_INTERNAL_LABEL: Record<ReportSectionInternal, string> = {
  INTERNAL_TIME_COST: "هزینهٔ داخلی زمان",
  DIRECT_NIL_COST: "هزینهٔ مستقیم NIL",
  REVENUE: "درآمد",
  REIMBURSED_COST: "هزینهٔ بازپرداخت‌شده",
  UNREIMBURSED_COST: "هزینهٔ بازپرداخت‌نشده",
  CONTRIBUTION_MARGIN: "حاشیهٔ مشارکت",
  PROFITABILITY_ANALYSIS: "تحلیل سودآوری",
  INTERNAL_NOTES: "یادداشت داخلی (محرمانه)",
};

/** Union of client + internal section keys — used for schema validation (a value like REVENUE must be accepted for an INTERNAL-family submission, not just tolerated by the DB trigger). */
export const ALL_REPORT_SECTIONS = [...REPORT_SECTION, ...REPORT_SECTION_INTERNAL] as const;
export const ALL_REPORT_SECTION_LABEL: Record<string, string> = { ...REPORT_SECTION_LABEL, ...REPORT_SECTION_INTERNAL_LABEL };

/** Default section/field selection per preset (§46 — a preset is only a DEFAULT, user can change it before generating). */
export const REPORT_TYPE_DEFAULT_SECTIONS: Record<ReportType, ReportSection[]> = {
  CLIENT_PERFORMANCE_REPORT: ["COVER_PAGE", "EXECUTIVE_SUMMARY", "SERVICES_PERFORMED", "TIME_SPENT", "PERIOD_SUMMARY", "FINAL_SUMMARY"],
  CLIENT_FINANCIAL_REPORT: ["COVER_PAGE", "EXECUTIVE_SUMMARY", "SERVICE_FEES", "DIRECT_EXPENSES", "REIMBURSABLE_EXPENSES", "CLAIMABLE_AMOUNTS", "BILLING_SUMMARY", "OUTSTANDING_AMOUNT", "FINAL_SUMMARY"],
  CLIENT_FULL_REPORT: [...REPORT_SECTION],
  CUSTOM_REPORT: ["COVER_PAGE", "EXECUTIVE_SUMMARY", "FINAL_SUMMARY"],
};
export const REPORT_TYPE_DEFAULT_FIELDS: Record<ReportType, ReportField[]> = {
  CLIENT_PERFORMANCE_REPORT: ["DATE", "CATEGORY", "SERVICE_TITLE", "PERFORMER", "DURATION"],
  CLIENT_FINANCIAL_REPORT: ["DATE", "SERVICE_TITLE", "SERVICE_FEE", "EXPENSE", "CLAIMABLE_AMOUNT", "BILLING_STATUS"],
  CLIENT_FULL_REPORT: [...REPORT_FIELD],
  CUSTOM_REPORT: ["DATE", "SERVICE_TITLE"],
};

/* ============================ External Correspondence Telegram Bot — Phase 1 =========================== */

export const EXTERNAL_CORRESPONDENCE_ROLE = ["VIEW", "CREATE", "APPROVE", "ADMIN"] as const;
export type ExternalCorrespondenceRole = (typeof EXTERNAL_CORRESPONDENCE_ROLE)[number];
export const EXTERNAL_CORRESPONDENCE_ROLE_LABEL: Record<ExternalCorrespondenceRole, string> = {
  VIEW: "مشاهده", CREATE: "بررسی", APPROVE: "ثبت/رد", ADMIN: "مدیر",
};

export const EXTERNAL_INTAKE_STATUS = [
  "DRAFT", "SUBMITTED", "PENDING_REVIEW", "ACCEPTED", "REJECTED",
  "NEEDS_INFORMATION", "REGISTERED", "UNDER_REVIEW", "REPLIED", "CLOSED",
] as const;
export type ExternalIntakeStatus = (typeof EXTERNAL_INTAKE_STATUS)[number];
/** Internal-facing labels (full detail — shown only in the NIL Office review UI, never to the external sender). */
export const EXTERNAL_INTAKE_STATUS_LABEL: Record<ExternalIntakeStatus, string> = {
  DRAFT: "پیش‌نویس",
  SUBMITTED: "ارسال‌شده",
  PENDING_REVIEW: "در انتظار بررسی",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "رد‌شده",
  NEEDS_INFORMATION: "نیازمند اطلاعات تکمیلی",
  REGISTERED: "ثبت‌شده",
  UNDER_REVIEW: "در حال بررسی",
  REPLIED: "پاسخ‌داده‌شده",
  CLOSED: "مختومه",
};
export const EXTERNAL_INTAKE_STATUS_TONE: Record<ExternalIntakeStatus, string> = {
  DRAFT: "status-draft",
  SUBMITTED: "status-review",
  PENDING_REVIEW: "status-waiting",
  ACCEPTED: "status-review",
  REJECTED: "status-cancelled",
  NEEDS_INFORMATION: "status-waiting",
  REGISTERED: "status-final",
  UNDER_REVIEW: "status-review",
  REPLIED: "status-final",
  CLOSED: "status-final",
};
/** Public-safe labels only (spec §33) — the bot NEVER shows internal workflow nuance (e.g. UNDER_REVIEW/ACCEPTED collapse into the same "در حال بررسی" the sender already understands). */
export const EXTERNAL_INTAKE_PUBLIC_STATUS_LABEL: Record<ExternalIntakeStatus, string> = {
  DRAFT: "در حال تکمیل",
  SUBMITTED: "دریافت شد",
  PENDING_REVIEW: "در انتظار بررسی",
  ACCEPTED: "در حال بررسی",
  REJECTED: "قابل ثبت نیست",
  NEEDS_INFORMATION: "نیازمند اطلاعات تکمیلی",
  REGISTERED: "ثبت شد",
  UNDER_REVIEW: "در حال بررسی",
  REPLIED: "پاسخ صادر شد",
  CLOSED: "مختومه",
};

export const EXTERNAL_SENDER_TYPE = ["INDIVIDUAL", "ORGANIZATION"] as const;
export type ExternalSenderType = (typeof EXTERNAL_SENDER_TYPE)[number];
export const EXTERNAL_SENDER_TYPE_LABEL: Record<ExternalSenderType, string> = {
  INDIVIDUAL: "شخص حقیقی", ORGANIZATION: "شرکت یا سازمان",
};

export const EXTERNAL_INTAKE_EVENT_TYPE_LABEL: Record<string, string> = {
  SUBMISSION_CREATED: "ایجاد پیش‌نویس",
  FILE_UPLOADED: "بارگذاری فایل",
  SUBMISSION_SUBMITTED: "ارسال مکاتبه",
  REVIEW_OPENED: "شروع بررسی",
  ACCEPTED: "پذیرفته‌شد",
  REJECTED: "رد شد",
  NEEDS_INFORMATION: "درخواست اطلاعات تکمیلی",
  ADDITIONAL_INFO_RECEIVED: "دریافت اطلاعات تکمیلی",
  OFFICIAL_CORRESPONDENCE_REGISTERED: "ثبت رسمی مکاتبه",
  COMPANY_LINKED: "پیوند به شرکت",
  CASE_LINKED: "پیوند به پرونده",
  FOLLOWUP_CREATED: "ایجاد پیگیری",
  ASSIGNED: "تعیین مسئول",
  REPLY_ISSUED: "صدور پاسخ",
  REPLY_DELIVERED: "ارسال پاسخ",
  STATUS_CHANGED: "تغییر وضعیت",
};

/* ============================ HR & Payroll — Phase 1 (Personnel + Employment) =========================== */

export const HR_ROLE = ["VIEW", "CREATE", "APPROVE", "ADMIN"] as const;
export type HrRole = (typeof HR_ROLE)[number];
export const HR_ROLE_LABEL: Record<HrRole, string> = {
  VIEW: "مشاهده", CREATE: "ثبت", APPROVE: "تأیید", ADMIN: "مدیر منابع انسانی",
};

export const PERSONNEL_STATUS = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED", "ARCHIVED"] as const;
export type PersonnelStatus = (typeof PERSONNEL_STATUS)[number];
export const PERSONNEL_STATUS_LABEL: Record<PersonnelStatus, string> = {
  ACTIVE: "فعال", ON_LEAVE: "مرخصی", SUSPENDED: "تعلیق", TERMINATED: "پایان‌یافته", ARCHIVED: "بایگانی‌شده",
};
/** Reuses the existing status.* Tailwind tone tokens — no new CSS. */
export const PERSONNEL_STATUS_TONE: Record<PersonnelStatus, string> = {
  ACTIVE: "status-received", ON_LEAVE: "status-waiting", SUSPENDED: "status-cancelled",
  TERMINATED: "status-cancelled", ARCHIVED: "status-closed",
};

export const PERSONNEL_EMPLOYMENT_TYPE = [
  "FULL_TIME", "PART_TIME", "CONTRACT", "CONSULTANT", "TEMPORARY", "INTERN", "OTHER",
] as const;
export type PersonnelEmploymentType = (typeof PERSONNEL_EMPLOYMENT_TYPE)[number];
export const PERSONNEL_EMPLOYMENT_TYPE_LABEL: Record<PersonnelEmploymentType, string> = {
  FULL_TIME: "تمام‌وقت", PART_TIME: "پاره‌وقت", CONTRACT: "قراردادی", CONSULTANT: "مشاور",
  TEMPORARY: "موقت", INTERN: "کارآموز", OTHER: "سایر",
};

/** Suggested categories for the HR Documents tab's filename-prefix picker — no DB column exists for this (matches precedent: attachments has no category column anywhere in this codebase). */
export const HR_DOCUMENT_CATEGORY = [
  "قرارداد کار", "مدارک هویتی", "گواهی‌نامه‌ها", "اسناد بیمه", "اسناد مالیاتی", "سایر",
] as const;
// NOTE: «اطلاعات بانکی» is deliberately NOT a suggested HR-document category — HR documents are readable by every
// HR-access user, while bank details are payroll-ADMIN-only (personnel_payment_destinations, 0115/0117).

/* ============================ HR & Payroll — Phase 2 (configuration layer) =========================== */

export const PAYROLL_ROLE = ["VIEW", "CREATE", "APPROVE", "ADMIN"] as const;
export type PayrollRole = (typeof PAYROLL_ROLE)[number];
export const PAYROLL_ROLE_LABEL: Record<PayrollRole, string> = {
  VIEW: "مشاهده", CREATE: "ثبت", APPROVE: "تأیید", ADMIN: "مدیر حقوق و دستمزد",
};

export const SALARY_COMPONENT_TYPE = ["EARNING", "DEDUCTION", "EMPLOYER_COST", "INFORMATIONAL"] as const;
export type SalaryComponentType = (typeof SALARY_COMPONENT_TYPE)[number];
export const SALARY_COMPONENT_TYPE_LABEL: Record<SalaryComponentType, string> = {
  EARNING: "مزایا (درآمد)", DEDUCTION: "کسورات", EMPLOYER_COST: "هزینهٔ کارفرما", INFORMATIONAL: "اطلاعاتی",
};

export const SALARY_CALCULATION_METHOD = ["FIXED", "PERCENTAGE", "QUANTITY_X_RATE", "FORMULA", "MANUAL_INPUT"] as const;
export type SalaryCalculationMethod = (typeof SALARY_CALCULATION_METHOD)[number];
export const SALARY_CALCULATION_METHOD_LABEL: Record<SalaryCalculationMethod, string> = {
  FIXED: "مبلغ ثابت", PERCENTAGE: "درصدی", QUANTITY_X_RATE: "مقدار × نرخ (محاسبه در فاز بعد)",
  FORMULA: "فرمول (محاسبه در فاز بعد)", MANUAL_INPUT: "ورود دستی در هر دوره",
};
/** Defined but NOT evaluated until the calculation phase — the UI shows a notice. */
export const DEFERRED_CALCULATION_METHODS: SalaryCalculationMethod[] = ["QUANTITY_X_RATE", "FORMULA"];

export const PAYROLL_PERCENTAGE_BASIS = ["BASE_SALARY", "GROSS_EARNINGS"] as const;
export type PayrollPercentageBasis = (typeof PAYROLL_PERCENTAGE_BASIS)[number];
export const PAYROLL_PERCENTAGE_BASIS_LABEL: Record<PayrollPercentageBasis, string> = {
  BASE_SALARY: "حقوق پایه", GROSS_EARNINGS: "جمع مزایا (ناخالص)",
};

export const PAYMENT_FREQUENCY = ["MONTHLY", "BIWEEKLY", "WEEKLY", "DAILY", "HOURLY", "OTHER"] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCY)[number];
export const PAYMENT_FREQUENCY_LABEL: Record<PaymentFrequency, string> = {
  MONTHLY: "ماهانه", BIWEEKLY: "دو‌هفته‌ای", WEEKLY: "هفتگی", DAILY: "روزانه", HOURLY: "ساعتی", OTHER: "سایر",
};

export const LEGAL_RULE_SET_STATUS = ["DRAFT", "REVIEWED", "APPROVED", "RETIRED"] as const;
export type LegalRuleSetStatus = (typeof LEGAL_RULE_SET_STATUS)[number];
export const LEGAL_RULE_SET_STATUS_LABEL: Record<LegalRuleSetStatus, string> = {
  DRAFT: "پیش‌نویس", REVIEWED: "بررسی‌شده", APPROVED: "تأییدشده", RETIRED: "بازنشسته",
};
export const LEGAL_RULE_SET_STATUS_TONE: Record<LegalRuleSetStatus, string> = {
  DRAFT: "status-draft", REVIEWED: "status-review", APPROVED: "status-final", RETIRED: "status-closed",
};

/** Suggestions ONLY (name + type) — no flags, no values, nothing is seeded in the DB. */
export const SUGGESTED_SALARY_COMPONENTS: { code: string; name_fa: string; type: SalaryComponentType }[] = [
  { code: "BASE_SALARY", name_fa: "حقوق پایه", type: "EARNING" },
  { code: "HOUSING_ALLOWANCE", name_fa: "حق مسکن", type: "EARNING" },
  { code: "FOOD_ALLOWANCE", name_fa: "حق خواروبار", type: "EARNING" },
  { code: "TRANSPORT_ALLOWANCE", name_fa: "حق ایاب‌وذهاب", type: "EARNING" },
  { code: "MANAGEMENT_ALLOWANCE", name_fa: "حق مدیریت", type: "EARNING" },
  { code: "JOB_ALLOWANCE", name_fa: "حق شغل", type: "EARNING" },
  { code: "OVERTIME", name_fa: "اضافه‌کاری", type: "EARNING" },
  { code: "BONUS", name_fa: "پاداش", type: "EARNING" },
  { code: "COMMISSION", name_fa: "پورسانت", type: "EARNING" },
  { code: "MISSION_ALLOWANCE", name_fa: "ماموریت", type: "EARNING" },
  { code: "OTHER_ALLOWANCE", name_fa: "سایر مزایا", type: "EARNING" },
  { code: "INSURANCE_EMPLOYEE", name_fa: "بیمهٔ سهم کارمند", type: "DEDUCTION" },
  { code: "TAX", name_fa: "مالیات", type: "DEDUCTION" },
  { code: "LOAN_DEDUCTION", name_fa: "کسر وام", type: "DEDUCTION" },
  { code: "ADVANCE_DEDUCTION", name_fa: "کسر مساعده", type: "DEDUCTION" },
  { code: "ABSENCE_DEDUCTION", name_fa: "کسر غیبت", type: "DEDUCTION" },
  { code: "OTHER_DEDUCTION", name_fa: "سایر کسورات", type: "DEDUCTION" },
];
/** Suggested rule KEYS only — never values. */
export const SUGGESTED_RULE_KEYS: { key: string; label_fa: string }[] = [
  { key: "minimum_wage", label_fa: "حداقل دستمزد" },
  { key: "insurance_employee_rate", label_fa: "نرخ بیمهٔ سهم کارمند" },
  { key: "insurance_employer_rate", label_fa: "نرخ بیمهٔ سهم کارفرما" },
  { key: "insurance_ceiling", label_fa: "سقف مشمول بیمه" },
  { key: "insurance_floor", label_fa: "کف مشمول بیمه" },
  { key: "tax_brackets", label_fa: "پله‌های مالیات" },
  { key: "overtime_coefficient", label_fa: "ضریب اضافه‌کاری" },
  { key: "severance_rules", label_fa: "قواعد سنوات" },
  { key: "bonus_rules", label_fa: "قواعد پاداش" },
];

/* ============================ HR & Payroll — Phase 3 (periods, batches, calculation) =========================== */

export const PAYROLL_BATCH_STATUS = ["DRAFT", "CALCULATED", "UNDER_REVIEW", "CANCELLED"] as const;
export type PayrollBatchStatus = (typeof PAYROLL_BATCH_STATUS)[number];
export const PAYROLL_BATCH_STATUS_LABEL: Record<PayrollBatchStatus, string> = {
  DRAFT: "پیش‌نویس", CALCULATED: "محاسبه‌شده", UNDER_REVIEW: "در حال بررسی", CANCELLED: "لغو‌شده",
};
export const PAYROLL_BATCH_STATUS_TONE: Record<PayrollBatchStatus, string> = {
  DRAFT: "status-draft", CALCULATED: "status-review", UNDER_REVIEW: "status-review", CANCELLED: "status-cancelled",
};

export const PAYROLL_PERIOD_STATUS = ["OPEN", "CLOSED"] as const;
export type PayrollPeriodStatus = (typeof PAYROLL_PERIOD_STATUS)[number];
export const PAYROLL_PERIOD_STATUS_LABEL: Record<PayrollPeriodStatus, string> = { OPEN: "باز", CLOSED: "بسته" };

export const PAYROLL_ROUNDING_MODE = ["HALF_UP", "DOWN", "UP"] as const;
export type PayrollRoundingMode = (typeof PAYROLL_ROUNDING_MODE)[number];
export const PAYROLL_ROUNDING_MODE_LABEL: Record<PayrollRoundingMode, string> = {
  HALF_UP: "گرد به نزدیک‌ترین (۵ به بالا)", DOWN: "گرد به پایین", UP: "گرد به بالا",
};

export const WORK_DATA_SOURCE = ["MANUAL", "PROJECT_WORKLOG", "IMPORT", "INTEGRATION", "ADJUSTMENT"] as const;
export type WorkDataSource = (typeof WORK_DATA_SOURCE)[number];
export const WORK_DATA_SOURCE_LABEL: Record<WorkDataSource, string> = {
  MANUAL: "ورود دستی", PROJECT_WORKLOG: "کارکرد پروژه", IMPORT: "درون‌ریزی", INTEGRATION: "یکپارچه‌سازی", ADJUSTMENT: "اصلاحیه",
};

/** Reasons (computed at read time) why the current calculation no longer matches live inputs. */
export const PAYROLL_STALE_REASON_LABEL: Record<string, string> = {
  WORK_DATA_CHANGED: "کارکرد تغییر کرده است",
  COMPENSATION_CHANGED: "حقوق و مزایای فرد تغییر کرده است",
  ELIGIBILITY_CHANGED: "فهرست افراد مشمول تغییر کرده است",
  SETTINGS_CHANGED: "تنظیمات دسته (حوزهٔ قانونی/گرد کردن) تغییر کرده است",
};

export const ELIGIBILITY_DECISION = ["INCLUDE", "EXCLUDE", "AUTO"] as const;
export type EligibilityDecision = (typeof ELIGIBILITY_DECISION)[number];
export const ELIGIBILITY_DECISION_LABEL: Record<EligibilityDecision, string> = {
  INCLUDE: "شمول اجباری", EXCLUDE: "خارج‌سازی", AUTO: "خودکار",
};

export const PAYROLL_LINE_METHOD_LABEL: Record<string, string> = {
  PROFILE_BASE: "حقوق پایهٔ پروفایل", FIXED: "مبلغ ثابت", PERCENTAGE: "درصدی",
  MANUAL_INPUT: "ورود دستی", QUANTITY_X_RATE: "مقدار × نرخ", FORMULA: "فرمول",
};
export const PAYROLL_AMOUNT_SOURCE_LABEL: Record<string, string> = {
  PROFILE: "پروفایل حقوق", COMPONENT_DEFAULT: "پیش‌فرض جزء", COMPENSATION_OVERRIDE: "جایگزین در پروفایل",
  MANUAL_INPUT: "ورود دستی", RULE: "قاعدهٔ قانونی", COMPONENT: "جزء",
};
