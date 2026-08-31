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
  CANNOT_DELETE_NON_DRAFT: "حذف قرارداد پس از خروج از پیش‌نویس مجاز نیست.",
  EXTERNAL_NUMBER_IMMUTABLE: "شمارهٔ اصلی قرارداد قابل تغییر نیست.",
};

export function persianError(message: string | undefined | null): string {
  if (!message) return "خطای نامشخص رخ داد.";
  for (const key of Object.keys(ERROR_MESSAGES)) {
    if (message.includes(key)) return ERROR_MESSAGES[key];
  }
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
