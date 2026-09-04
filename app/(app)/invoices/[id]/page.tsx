import { notFound } from "next/navigation";
import { Download, Trash2, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { SalesDocumentStatusBadge } from "@/components/SalesDocumentStatusBadge";
import { Tabs } from "@/components/Tabs";
import { DetailActions } from "./DetailActions";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import { getDisplayUnit } from "@/app/actions/accounting-options";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { formatBytes } from "@/lib/utils";
import {
  SALES_DOCUMENT_TYPE_LABEL, SALES_DOCUMENT_ITEM_TYPE_LABEL, type SalesDocumentType, type SalesDocumentItemType,
  POSTING_STATUS_LABEL, POSTING_STATUS_TONE, type PostingStatus,
} from "@/lib/enums";
import type {
  SalesDocument, SalesDocumentItem, Company, Case, Contract, Attachment,
  SalesDocumentFinancialActivityRow, SalesDocumentFinancialSummary,
} from "@/lib/types/database";

export const dynamic = "force-dynamic";

const ACTIVITY_SOURCE_LABEL: Record<SalesDocumentFinancialActivityRow["source"], string> = {
  RECEIPT: "دریافت",
  PAYMENT: "پرداخت",
  JOURNAL_LINE: "سند حسابداری",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: doc } = await supabase.from("sales_documents").select("*").eq("id", id).single();
  if (!doc) notFound();
  const d = doc as SalesDocument;
  const isInvoice = d.type === "INVOICE";

  const [{ data: items }, { data: company }, { data: caseRow }, { data: contract }, { data: attachments }, unit, activityRes, summaryRes] =
    await Promise.all([
      supabase.from("sales_document_items").select("*").eq("sales_document_id", id).order("line_no"),
      d.company_id ? supabase.from("companies").select("id, legal_name").eq("id", d.company_id).single() : Promise.resolve({ data: null }),
      d.case_id ? supabase.from("cases").select("id, case_code, title").eq("id", d.case_id).single() : Promise.resolve({ data: null }),
      d.contract_id ? supabase.from("contracts").select("id, title, display_number, external_contract_number").eq("id", d.contract_id).single() : Promise.resolve({ data: null }),
      supabase.from("attachments").select("*").eq("entity_type", "SALES_DOCUMENT").eq("entity_id", id).order("created_at", { ascending: false }),
      getDisplayUnit(),
      isInvoice ? supabase.rpc("get_sales_document_financial_activity", { p_sales_document_id: id }) : Promise.resolve({ data: null }),
      isInvoice ? supabase.rpc("get_sales_document_financial_summary", { p_sales_document_id: id }) : Promise.resolve({ data: null }),
    ]);

  const itemRows = (items ?? []) as SalesDocumentItem[];
  const financialActivity = (activityRes.data ?? []) as SalesDocumentFinancialActivityRow[];
  const financialSummary = ((summaryRes.data as SalesDocumentFinancialSummary[] | null)?.[0] ?? {
    received_amount: 0,
    remaining_amount: d.total_amount,
  }) as SalesDocumentFinancialSummary;

  const atts = (attachments ?? []) as Attachment[];
  const signed = new Map<string, string>();
  await Promise.all(
    atts.map(async (a) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(a.storage_path, 3600);
      if (data?.signedUrl) signed.set(a.id, data.signedUrl);
    }),
  );

  const overviewTab = (
    <div className="space-y-6">
      <Card>
        <p className="mb-3 text-sm font-medium text-ink">اطلاعات سند</p>
        <div className="divide-y divide-paper-line/60">
          <Row label="نوع سند">{SALES_DOCUMENT_TYPE_LABEL[d.type as SalesDocumentType]}</Row>
          <Row label="شماره">{d.display_number ? toFaDigits(d.display_number) : "پیش‌نویس"}</Row>
          <Row label="طرف حساب">
            {company ? (
              <a href={`/companies`} className="text-seal hover:underline">{(company as Pick<Company, "legal_name">).legal_name}</a>
            ) : (
              d.customer_legal_name_snapshot
            )}
          </Row>
          <Row label="قرارداد مرتبط">
            {contract ? (
              <a href={`/contracts/${(contract as Pick<Contract, "id">).id}`} className="text-seal hover:underline">
                {(contract as Pick<Contract, "display_number" | "external_contract_number" | "title">).display_number ??
                  (contract as Pick<Contract, "display_number" | "external_contract_number" | "title">).external_contract_number}
                {" — "}
                {(contract as Pick<Contract, "title">).title}
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="پروندهٔ مرتبط">
            {caseRow ? `${(caseRow as Pick<Case, "case_code" | "title">).case_code ?? ""} — ${(caseRow as Pick<Case, "title">).title}` : "—"}
          </Row>
          <Row label="تاریخ صدور">{formatJalali(d.issue_date)}</Row>
          {isInvoice ? <Row label="سررسید پرداخت">{formatJalali(d.due_date)}</Row> : <Row label="تاریخ اعتبار">{formatJalali(d.validity_date)}</Row>}
          <Row label="تاریخ ثبت">{formatJalali(d.created_at)}</Row>
          {d.issued_at && <Row label="تاریخ صدور رسمی">{formatJalali(d.issued_at)}</Row>}
        </div>
      </Card>

      <Card>
        <p className="mb-3 text-sm font-medium text-ink">اطلاعات مشتری</p>
        <div className="divide-y divide-paper-line/60">
          <Row label="نام حقوقی">{d.customer_legal_name_snapshot}</Row>
          {d.customer_english_name_snapshot && <Row label="نام لاتین">{d.customer_english_name_snapshot}</Row>}
          {d.customer_registration_number_snapshot && <Row label="شماره ثبت">{d.customer_registration_number_snapshot}</Row>}
          {d.customer_national_id_snapshot && <Row label="شناسه/کد ملی">{d.customer_national_id_snapshot}</Row>}
          {d.customer_economic_code_snapshot && <Row label="کد اقتصادی">{d.customer_economic_code_snapshot}</Row>}
          {d.customer_address_snapshot && <Row label="نشانی">{d.customer_address_snapshot}</Row>}
          {d.customer_contact_person_snapshot && <Row label="نماینده/تماس">{d.customer_contact_person_snapshot}</Row>}
        </div>
      </Card>
    </div>
  );

  const itemsTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">اقلام سند</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="table-head">
              <th className="px-3 py-2">شرح</th>
              <th className="px-3 py-2">نوع</th>
              <th className="px-3 py-2">تعداد</th>
              <th className="px-3 py-2">قیمت واحد</th>
              <th className="px-3 py-2">تخفیف</th>
              <th className="px-3 py-2">مالیات</th>
              <th className="px-3 py-2 text-left">جمع</th>
            </tr>
          </thead>
          <tbody>
            {itemRows.map((it) => (
              <tr key={it.id} className="table-row">
                <td className="px-3 py-2 text-ink">{it.description}</td>
                <td className="px-3 py-2 text-ink-muted">{SALES_DOCUMENT_ITEM_TYPE_LABEL[it.item_type as SalesDocumentItemType]}</td>
                <td className="px-3 py-2 tnum text-ink-muted">{toFaDigits(String(it.quantity))} {it.unit ?? ""}</td>
                <td className="px-3 py-2 tnum text-ink-muted">{formatMoney(it.unit_price)}</td>
                <td className="px-3 py-2 tnum text-ink-muted">{formatMoney(it.discount_amount)}</td>
                <td className="px-3 py-2 tnum text-ink-muted">{formatMoney(it.tax_amount)}</td>
                <td className="px-3 py-2 text-left tnum text-ink">{formatMoney(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-paper/60">
              <td colSpan={6} className="px-3 py-2 text-left text-sm font-medium text-ink-muted">مبلغ نهایی</td>
              <td className="px-3 py-2 text-left tnum font-semibold text-seal">{formatMoney(d.total_amount)} {d.currency_code}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {(d.payment_terms || d.notes) && (
        <div className="mt-4 space-y-2 text-sm text-ink-muted">
          {d.payment_terms && <p><b className="text-ink">شرایط پرداخت: </b>{d.payment_terms}</p>}
          {d.notes && <p><b className="text-ink">یادداشت: </b>{d.notes}</p>}
        </div>
      )}
    </Card>
  );

  const paymentsTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">فعالیت مالی ثبت‌شده</p>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-paper p-3 text-center">
          <p className="text-xs text-ink-muted">دریافتی</p>
          <p className="tnum mt-1 text-sm font-semibold text-status-received">{formatMoney(financialSummary.received_amount, unit)}</p>
        </div>
        <div className="rounded-lg bg-paper p-3 text-center">
          <p className="text-xs text-ink-muted">مانده</p>
          <p className="tnum mt-1 text-sm font-semibold text-seal">{formatMoney(financialSummary.remaining_amount, unit)}</p>
        </div>
      </div>
      {financialActivity.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز فعالیت مالی ثبت‌شده‌ای برای این سند ثبت نشده است.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="table-head">
                <th className="px-3 py-2">تاریخ</th>
                <th className="px-3 py-2">نوع</th>
                <th className="px-3 py-2">شرح</th>
                <th className="px-3 py-2">شماره سند</th>
                <th className="px-3 py-2 text-left">مبلغ</th>
                <th className="px-3 py-2">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {financialActivity.map((row) => (
                <tr key={`${row.source}-${row.id}`} className="table-row">
                  <td className="px-3 py-2 tnum text-ink-muted">{formatJalali(row.document_date)}</td>
                  <td className="px-3 py-2 text-ink">{ACTIVITY_SOURCE_LABEL[row.source]}</td>
                  <td className="px-3 py-2 text-ink-muted">{row.description ?? "—"}</td>
                  <td className="px-3 py-2 tnum text-ink-muted" dir="ltr">{row.document_number ? toFaDigits(row.document_number) : "—"}</td>
                  <td className={`px-3 py-2 text-left tnum ${row.direction === "IN" ? "text-status-received" : "text-ink"}`}>
                    {row.direction === "IN" ? "+" : "-"}{formatMoney(row.amount, unit)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`badge ${POSTING_STATUS_TONE[row.status as PostingStatus]}`}>
                      {POSTING_STATUS_LABEL[row.status as PostingStatus]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  const attachmentsTab = (
    <Card>
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
        <Paperclip className="h-4 w-4" /> اسناد و فایل‌ها
      </p>
      {atts.length === 0 ? (
        <p className="mb-4 text-sm text-ink-muted">فایلی ثبت نشده است.</p>
      ) : (
        <ul className="mb-4 divide-y divide-paper-line/60">
          {atts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2">
              <span className="flex-1 text-sm text-ink">{a.file_name}</span>
              <span className="text-xs text-ink-muted tnum">{formatBytes(a.size_bytes)}</span>
              {signed.get(a.id) && (
                <a href={signed.get(a.id)} target="_blank" rel="noopener" className="btn-quiet p-1.5" aria-label="دانلود">
                  <Download className="h-4 w-4" />
                </a>
              )}
              <form action={deleteAttachmentForm}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="back_to" value={`/invoices/${id}`} />
                <button className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف">
                  <Trash2 className="h-4 w-4" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <AttachmentUploader entityType="SALES_DOCUMENT" entityId={id} />
    </Card>
  );

  const tabs = [
    { label: "نمای کلی", content: overviewTab },
    { label: "اقلام و مبالغ", content: itemsTab },
    ...(isInvoice ? [{ label: "پرداخت‌ها", content: paymentsTab }] : []),
    { label: "اسناد و فایل‌ها", content: attachmentsTab },
  ];

  return (
    <div>
      <PageHeader
        title={d.display_number ? toFaDigits(d.display_number) : "پیش‌نویس سند"}
        subtitle={`${SALES_DOCUMENT_TYPE_LABEL[d.type as SalesDocumentType]} — ${d.customer_legal_name_snapshot}`}
        action={<SalesDocumentStatusBadge status={d.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Tabs tabs={tabs} />
        </div>

        <div className="space-y-6">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اقدامات</p>
            <DetailActions id={d.id} status={d.status} type={d.type} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-paper-line/60 py-2.5 last:border-0">
      <span className="w-40 shrink-0 text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  );
}
