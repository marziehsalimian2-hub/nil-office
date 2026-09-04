/**
 * Hand-maintained database types. Regenerate with the Supabase CLI
 * (`supabase gen types typescript`) once your project is linked, if you
 * prefer fully generated types — the shapes below match the migrations.
 */

export type AppRole = "ADMIN" | "USER";
export type Direction = "OUTGOING" | "INCOMING";
export type CorrStatusT =
  | "DRAFT"
  | "REVIEW"
  | "FINALIZED"
  | "SENT"
  | "WAITING_RESPONSE"
  | "RESPONSE_RECEIVED"
  | "CLOSED"
  | "CANCELLED";
export type PriorityT = "NORMAL" | "URGENT" | "CONFIDENTIAL";
export type LanguageT = "FA" | "EN";
export type CaseStatusT = "ACTIVE" | "WAITING" | "CLOSED" | "CANCELLED";
export type DocumentTypeT =
  | "PROCEDURE"
  | "LOI"
  | "ICPO"
  | "CONTRACT"
  | "ANALYSIS"
  | "COMPANY_DOCUMENT"
  | "BANK_DOCUMENT"
  | "INVOICE"
  | "OTHER";
export type FollowupStatusT = "OPEN" | "DONE" | "CANCELLED";
export type LinkRelationT = "REPLY_TO" | "RELATED_TO";
export type AttachEntity = "CORRESPONDENCE" | "DOCUMENT" | "CASE" | "CONTRACT" | "SALES_DOCUMENT";

export type AccountingRoleT = "VIEW" | "CREATE" | "POST" | "ADMIN";
export type ContractRoleT = "VIEW" | "CREATE" | "APPROVE" | "ADMIN";

export interface Profile {
  id: string;
  full_name: string | null;
  title: string | null;
  role: AppRole;
  accounting_role: AccountingRoleT | null;
  contract_role: ContractRoleT | null;
  invoice_role: InvoiceRoleT | null;
  is_active: boolean;
  signature_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  legal_name: string;
  english_name: string | null;
  country: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Case {
  id: string;
  case_code: string | null;
  title: string;
  case_type: string | null;
  company_id: string | null;
  description: string | null;
  responsible_user: string | null;
  start_date: string | null;
  status: CaseStatusT;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Correspondence {
  id: string;
  direction: Direction;
  sequence_number: number | null;
  display_number: string | null;
  year: number | null;
  language: LanguageT;
  subject: string | null;
  sender_company_id: string | null;
  recipient_company_id: string | null;
  recipient_name: string | null;
  case_id: string | null;
  created_by: string;
  signatory_id: string | null;
  signatory_label: string | null;
  assigned_to: string | null;
  status: CorrStatusT;
  priority: PriorityT;
  requires_response: boolean;
  followup_date: string | null;
  sent_received_method: string | null;
  sent_received_at: string | null;
  external_letter_number: string | null;
  external_letter_date: string | null;
  draft_text: string | null;
  internal_notes: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CorrespondenceLink {
  id: string;
  from_correspondence_id: string;
  to_correspondence_id: string;
  relation_type: LinkRelationT;
  created_by: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  title: string;
  document_type: DocumentTypeT;
  case_id: string | null;
  company_id: string | null;
  document_date: string | null;
  received_date: string | null;
  version: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  entity_type: AttachEntity;
  entity_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface Followup {
  id: string;
  title: string;
  due_date: string;
  assigned_to: string | null;
  correspondence_id: string | null;
  case_id: string | null;
  status: FollowupStatusT;
  note: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NumberSequence {
  id: string;
  scope: "OUTGOING" | "INCOMING" | "CASE";
  year: number;
  last_value: number;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export interface SearchResult {
  entity_type: string;
  id: string;
  title: string;
  subtitle: string | null;
  extra: string | null;
  created_at: string;
}

/* ============================ Accounting ================================= */

export type PostingStatusT = "DRAFT" | "POSTED" | "REVERSED";
export type AccountTypeT = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type AccountNatureT = "DEBIT" | "CREDIT";
export type FiscalYearStatusT = "OPEN" | "CLOSED";

export interface AppSettings {
  id: number;
  base_currency_code: string;
  display_unit: "RIAL" | "TOMAN";
  letterhead_path: string | null;
  stamp_path: string | null;
  updated_at: string;
}

export interface FiscalYear {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  status: FiscalYearStatusT;
  created_at: string;
  closed_at: string | null;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  nature: AccountNatureT;
  account_type: AccountTypeT;
  is_active: boolean;
  allows_posting: boolean;
  created_at: string;
  updated_at: string;
}

export interface DetailAccount {
  id: string;
  code: string | null;
  name: string;
  kind: "CUSTOMER" | "SUPPLIER" | "EMPLOYEE" | "SHAREHOLDER" | "OTHER";
  company_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface JournalEntry {
  id: string;
  fiscal_year_id: string;
  document_number: string | null;
  document_date: string;
  description: string | null;
  status: PostingStatusT;
  reference: string | null;
  reversal_of: string | null;
  created_by: string | null;
  posted_by: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  detail_account_id: string | null;
  description: string | null;
  debit: number;
  credit: number;
  company_id: string | null;
  case_id: string | null;
  contract_id: string | null;
  sales_document_id: string | null;
  currency_code: string | null;
  foreign_amount: number | null;
  exchange_rate: number | null;
  line_no: number | null;
  created_at: string;
}

export interface BankAccount {
  id: string;
  kind: "BANK" | "CASH";
  bank_name: string | null;
  branch: string | null;
  account_title: string;
  account_number: string | null;
  iban: string | null;
  currency_code: string;
  account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Receipt {
  id: string;
  receipt_date: string;
  payer: string | null;
  amount: number;
  currency_code: string;
  bank_account_id: string | null;
  counterpart_account_id: string | null;
  detail_account_id: string | null;
  method: string | null;
  reference: string | null;
  description: string | null;
  company_id: string | null;
  case_id: string | null;
  contract_id: string | null;
  sales_document_id: string | null;
  fiscal_year_id: string | null;
  status: PostingStatusT;
  journal_entry_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  payment_date: string;
  payee: string | null;
  amount: number;
  currency_code: string;
  bank_account_id: string | null;
  counterpart_account_id: string | null;
  detail_account_id: string | null;
  method: string | null;
  reference: string | null;
  description: string | null;
  company_id: string | null;
  case_id: string | null;
  contract_id: string | null;
  sales_document_id: string | null;
  fiscal_year_id: string | null;
  status: PostingStatusT;
  journal_entry_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrialBalanceRow {
  account_id: string;
  code: string;
  name: string;
  account_type: AccountTypeT;
  nature: AccountNatureT;
  total_debit: number;
  total_credit: number;
  balance: number;
  fiscal_year_id: string | null;
}

export interface PostedLine {
  id: string;
  account_id: string;
  detail_account_id: string | null;
  debit: number;
  credit: number;
  company_id: string | null;
  case_id: string | null;
  journal_entry_id: string;
  document_number: string | null;
  document_date: string;
  fiscal_year_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountTypeT;
  nature: AccountNatureT;
}

/* ============================ Contracts ================================== */

export type ContractStatusT =
  | "DRAFT"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "ACTIVE"
  | "SUSPENDED"
  | "COMPLETED"
  | "EXPIRED"
  | "TERMINATED"
  | "CANCELLED";
export type ContractKindT = "NIL_ISSUED" | "HISTORICAL";

export interface ContractType {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Contract {
  id: string;
  contract_type_id: string;
  title: string;
  kind: ContractKindT;
  sequence_number: number | null;
  display_number: string | null;
  year: number | null;
  external_contract_number: string | null;
  external_source_note: string | null;
  counterparty_company_id: string | null;
  counterparty_representative_name: string | null;
  case_id: string | null;
  status: ContractStatusT;
  effective_date: string | null;
  expiry_date: string | null;
  signed_date: string | null;
  base_amount: number | null;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  currency_code: string;
  description: string | null;
  internal_notes: string | null;
  responsible_user: string | null;
  signatory_id: string | null;
  signatory_label: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractFinancialActivityRow {
  source: "RECEIPT" | "PAYMENT" | "JOURNAL_LINE";
  id: string;
  document_date: string;
  document_number: string | null;
  description: string | null;
  amount: number;
  direction: "IN" | "OUT";
  status: PostingStatusT;
  currency_code: string | null;
  journal_entry_id: string | null;
}

export interface ContractFinancialSummary {
  received_amount: number;
  paid_amount: number;
  outstanding_amount: number;
}

/* ============================ Invoices/Proforma =========================== */

export type SalesDocumentTypeT = "PROFORMA" | "INVOICE";
export type SalesDocumentStatusT =
  | "DRAFT"
  | "REVIEW"
  | "APPROVED"
  | "ISSUED"
  | "ACCEPTED"
  | "CONVERTED"
  | "EXPIRED"
  | "PARTIALLY_SETTLED"
  | "SETTLED"
  | "OVERDUE"
  | "CANCELLED";
export type SalesDocumentItemTypeT = "GOODS" | "SERVICE";
export type InvoiceRoleT = "VIEW" | "CREATE" | "APPROVE" | "ADMIN";

export interface SalesDocument {
  id: string;
  type: SalesDocumentTypeT;
  status: SalesDocumentStatusT;
  sequence_number: number | null;
  display_number: string | null;
  year: number | null;
  company_id: string | null;
  contract_id: string | null;
  case_id: string | null;
  converted_from_id: string | null;
  converted_to_id: string | null;
  converted_at: string | null;
  issue_date: string | null;
  due_date: string | null;
  validity_date: string | null;
  currency_code: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_terms: string | null;
  notes: string | null;
  customer_legal_name_snapshot: string;
  customer_english_name_snapshot: string | null;
  customer_registration_number_snapshot: string | null;
  customer_national_id_snapshot: string | null;
  customer_economic_code_snapshot: string | null;
  customer_address_snapshot: string | null;
  customer_postal_code_snapshot: string | null;
  customer_contact_person_snapshot: string | null;
  customer_email_snapshot: string | null;
  customer_phone_snapshot: string | null;
  signatory_id: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  issued_by: string | null;
  issued_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesDocumentItem {
  id: string;
  sales_document_id: string;
  line_no: number;
  item_type: SalesDocumentItemTypeT;
  description: string;
  unit: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  line_total: number;
  created_at: string;
  updated_at: string;
}

export interface SalesDocumentFinancialActivityRow {
  source: "RECEIPT" | "PAYMENT" | "JOURNAL_LINE";
  id: string;
  document_date: string;
  document_number: string | null;
  description: string | null;
  amount: number;
  direction: "IN" | "OUT";
  status: PostingStatusT;
  currency_code: string | null;
  journal_entry_id: string | null;
}

export interface SalesDocumentFinancialSummary {
  received_amount: number;
  remaining_amount: number;
}
