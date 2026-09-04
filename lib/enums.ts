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
  CANNOT_DELETE_NON_DRAFT: "حذف این رکورد پس از خروج از پیش‌نویس مجاز نیست.",
  EXTERNAL_NUMBER_IMMUTABLE: "شمارهٔ اصلی قرارداد قابل تغییر نیست.",
  CUSTOMER_REQUIRED: "برای صدور، انتخاب طرف حساب (مشتری) الزامی است.",
  ONLY_PROFORMA_CONVERTIBLE: "فقط پیش‌فاکتور قابل تبدیل به فاکتور است.",
  ALREADY_CONVERTED: "این پیش‌فاکتور قبلاً به فاکتور تبدیل شده است.",
  USE_RPC_TO_CONVERT: "تبدیل به فاکتور فقط از مسیر مجاز امکان‌پذیر است.",
  ALREADY_CLOSED: "این فرصت قبلاً بسته شده است (موفق یا ازدست‌رفته).",
  LOST_REASON_REQUIRED: "برای ثبت ازدست‌رفته، انتخاب دلیل الزامی است.",
  NO_WON_STAGE: "برای این پایپ‌لاین، مرحلهٔ «موفق» تعریف نشده است.",
  NO_LOST_STAGE: "برای این پایپ‌لاین، مرحلهٔ «ازدست‌رفته» تعریف نشده است.",
  STAGE_PIPELINE_MISMATCH: "مرحلهٔ انتخاب‌شده متعلق به این پایپ‌لاین نیست.",
  USE_CLOSE_ACTION: "برای رسیدن به این مرحله از دکمهٔ «موفق»/«ازدست‌رفته» استفاده کنید.",
  TRADE_ONLY: "جزئیات معامله فقط برای فرصت‌های نوع «تجاری/بازرگانی» قابل ثبت است.",
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
