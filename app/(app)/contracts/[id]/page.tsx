import { notFound } from "next/navigation";
import { Download, Trash2, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { ContractStatusBadge } from "@/components/ContractStatusBadge";
import { Tabs } from "@/components/Tabs";
import { EditableContractCard } from "./EditableContractCard";
import { DetailActions } from "./DetailActions";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import { getDisplayUnit } from "@/app/actions/accounting-options";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { formatBytes } from "@/lib/utils";
import { POSTING_STATUS_LABEL, POSTING_STATUS_TONE, type PostingStatus } from "@/lib/enums";
import type {
  Contract, ContractType, Company, Case, Profile, Attachment,
  ContractFinancialActivityRow, ContractFinancialSummary,
} from "@/lib/types/database";

export const dynamic = "force-dynamic";

const ACTIVITY_SOURCE_LABEL: Record<ContractFinancialActivityRow["source"], string> = {
  RECEIPT: "دریافت",
  PAYMENT: "پرداخت",
  JOURNAL_LINE: "سند حسابداری",
};

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const hasInvoiceAccess = profile.role === "ADMIN" || profile.invoice_role != null;
  const hasProjectAccess = profile.role === "ADMIN" || profile.project_role != null;

  const { data: contract } = await supabase.from("contracts").select("*").eq("id", id).single();
  if (!contract) notFound();
  const k = contract as Contract;

  const [{ data: types }, { data: companies }, { data: cases }, { data: profiles }, { data: attachments }, { data: activity }, { data: summaryRows }, unit] =
    await Promise.all([
      supabase.from("contract_types").select("id, name").eq("is_active", true).order("name"),
      supabase.from("companies").select("id, legal_name").order("legal_name"),
      supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name").eq("is_active", true),
      supabase.from("attachments").select("*").eq("entity_type", "CONTRACT").eq("entity_id", id).order("created_at", { ascending: false }),
      supabase.rpc("get_contract_financial_activity", { p_contract_id: id }),
      supabase.rpc("get_contract_financial_summary", { p_contract_id: id }),
      getDisplayUnit(),
    ]);

  const financialActivity = (activity ?? []) as ContractFinancialActivityRow[];
  const financialSummary = ((summaryRows as ContractFinancialSummary[] | null)?.[0] ?? {
    received_amount: 0,
    paid_amount: 0,
    outstanding_amount: k.total_amount,
  }) as ContractFinancialSummary;

  const typeName = new Map(((types ?? []) as Pick<ContractType, "id" | "name">[]).map((t) => [t.id, t.name]));
  const companyName = new Map(((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => [c.id, c.legal_name]));
  const caseById = new Map(((cases ?? []) as Pick<Case, "id" | "case_code" | "title">[]).map((c) => [c.id, c]));
  const profileName = new Map(((profiles ?? []) as Pick<Profile, "id" | "full_name">[]).map((p) => [p.id, p.full_name ?? "—"]));

  const relatedCase = k.case_id ? caseById.get(k.case_id) : null;
  const canEdit = k.status === "DRAFT" || k.status === "UNDER_REVIEW";

  const atts = (attachments ?? []) as Attachment[];
  const signed = new Map<string, string>();
  await Promise.all(
    atts.map(async (a) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(a.storage_path, 3600);
      if (data?.signedUrl) signed.set(a.id, data.signedUrl);
    }),
  );

  const overviewTab = (
    <EditableContractCard
      id={id}
      canEdit={canEdit}
      kind={k.kind}
      types={((types ?? []) as Pick<ContractType, "id" | "name">[]).map((t) => ({ id: t.id, label: t.name }))}
      companies={((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => ({ id: c.id, label: c.legal_name }))}
      cases={((cases ?? []) as Pick<Case, "id" | "case_code" | "title">[]).map((c) => ({
        id: c.id,
        label: `${c.case_code ?? ""} ${c.title}`.trim(),
      }))}
      profiles={((profiles ?? []) as Pick<Profile, "id" | "full_name">[]).map((p) => ({ id: p.id, label: p.full_name ?? "—" }))}
      view={{
        title: k.title,
        typeName: typeName.get(k.contract_type_id) ?? null,
        counterparty: k.counterparty_company_id ? (companyName.get(k.counterparty_company_id) ?? null) : null,
        counterpartyRepresentativeName: k.counterparty_representative_name,
        relatedCase: relatedCase ? { id: relatedCase.id, label: `${relatedCase.case_code ?? ""} — ${relatedCase.title}` } : null,
        responsibleName: k.responsible_user ? (profileName.get(k.responsible_user) ?? null) : null,
        signatoryName: k.signatory_id ? (profileName.get(k.signatory_id) ?? null) : null,
        signatoryLabel: k.signatory_label,
        externalContractNumber: k.external_contract_number,
        externalSourceNote: k.external_source_note,
        signedDate: k.signed_date,
        effectiveDate: k.effective_date,
        expiryDate: k.expiry_date,
        description: k.description,
        internalNotes: k.internal_notes,
        createdAt: k.created_at,
        finalizedAt: k.finalized_at,
      }}
      initial={{
        contract_type_id: k.contract_type_id,
        counterparty_company_id: k.counterparty_company_id,
        case_id: k.case_id,
        responsible_user: k.responsible_user,
        signatory_id: k.signatory_id,
        base_amount: k.base_amount,
        discount_amount: k.discount_amount,
        tax_amount: k.tax_amount,
        currency_code: k.currency_code,
      }}
    />
  );

  const financialTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">مبالغ توافق‌شدهٔ قرارداد</p>
      <div className="divide-y divide-paper-line/60">
        <div className="flex items-center justify-between py-2.5 text-sm">
          <span className="text-ink-muted">مبلغ پایه</span>
          <span className="tnum text-ink">{formatMoney(k.base_amount)}</span>
        </div>
        <div className="flex items-center justify-between py-2.5 text-sm">
          <span className="text-ink-muted">تخفیف</span>
          <span className="tnum text-ink">{formatMoney(k.discount_amount)}</span>
        </div>
        <div className="flex items-center justify-between py-2.5 text-sm">
          <span className="text-ink-muted">مالیات/ارزش‌افزوده</span>
          <span className="tnum text-ink">{formatMoney(k.tax_amount)}</span>
        </div>
        <div className="flex items-center justify-between py-2.5 text-sm font-semibold">
          <span className="text-ink">مبلغ نهایی</span>
          <span className="tnum text-seal">{formatMoney(k.total_amount)} {k.currency_code}</span>
        </div>
      </div>
    </Card>
  );

  const financialActivityTab = (
    <Card>
      <p className="mb-3 text-sm font-medium text-ink">فعالیت مالی ثبت‌شده</p>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-paper p-3 text-center">
          <p className="text-xs text-ink-muted">دریافتی</p>
          <p className="tnum mt-1 text-sm font-semibold text-status-received">{formatMoney(financialSummary.received_amount, unit)}</p>
        </div>
        <div className="rounded-lg bg-paper p-3 text-center">
          <p className="text-xs text-ink-muted">پرداختی</p>
          <p className="tnum mt-1 text-sm font-semibold text-ink">{formatMoney(financialSummary.paid_amount, unit)}</p>
        </div>
        <div className="rounded-lg bg-paper p-3 text-center">
          <p className="text-xs text-ink-muted">مانده</p>
          <p className="tnum mt-1 text-sm font-semibold text-seal">{formatMoney(financialSummary.outstanding_amount, unit)}</p>
        </div>
      </div>

      {financialActivity.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز فعالیت مالی ثبت‌شده‌ای برای این قرارداد ثبت نشده است.</p>
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
                <input type="hidden" name="back_to" value={`/contracts/${id}`} />
                <button className="btn-quiet p-1.5 text-status-cancelled" aria-label="حذف">
                  <Trash2 className="h-4 w-4" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <AttachmentUploader entityType="CONTRACT" entityId={id} />
    </Card>
  );

  return (
    <div>
      <PageHeader
        title={k.display_number ? toFaDigits(k.display_number) : k.external_contract_number ? toFaDigits(k.external_contract_number) : "پیش‌نویس قرارداد"}
        subtitle={k.title}
        action={<ContractStatusBadge status={k.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Tabs
            tabs={[
              { label: "نمای کلی", content: overviewTab },
              { label: "مالی", content: <div className="space-y-6">{financialTab}{financialActivityTab}</div> },
              { label: "اسناد و فایل‌ها", content: attachmentsTab },
            ]}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اقدامات</p>
            <DetailActions id={k.id} status={k.status} kind={k.kind} hasInvoiceAccess={hasInvoiceAccess} hasProjectAccess={hasProjectAccess} />
          </Card>

          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اطلاعات تکمیلی</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-muted">تاریخ پایان</span>
                <span className="tnum text-ink">{formatJalali(k.expiry_date)}</span>
              </div>
              {k.approved_at && (
                <div className="flex justify-between">
                  <span className="text-ink-muted">تاریخ تأیید</span>
                  <span className="tnum text-ink">{formatJalali(k.approved_at)}</span>
                </div>
              )}
              {k.approved_by && (
                <div className="flex justify-between">
                  <span className="text-ink-muted">تأییدکننده</span>
                  <span className="text-ink">{profileName.get(k.approved_by) ?? "—"}</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
