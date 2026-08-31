import { notFound } from "next/navigation";
import { Download, Trash2, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { ContractStatusBadge } from "@/components/ContractStatusBadge";
import { Tabs } from "@/components/Tabs";
import { EditableContractCard } from "./EditableContractCard";
import { DetailActions } from "./DetailActions";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { deleteAttachmentForm } from "@/app/actions/attachments";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { formatBytes } from "@/lib/utils";
import type { Contract, ContractType, Company, Case, Profile, Attachment } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: contract } = await supabase.from("contracts").select("*").eq("id", id).single();
  if (!contract) notFound();
  const k = contract as Contract;

  const [{ data: types }, { data: companies }, { data: cases }, { data: profiles }, { data: attachments }] =
    await Promise.all([
      supabase.from("contract_types").select("id, name").eq("is_active", true).order("name"),
      supabase.from("companies").select("id, legal_name").order("legal_name"),
      supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name").eq("is_active", true),
      supabase.from("attachments").select("*").eq("entity_type", "CONTRACT").eq("entity_id", id).order("created_at", { ascending: false }),
    ]);

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
        relatedCase: relatedCase ? { id: relatedCase.id, label: `${relatedCase.case_code ?? ""} — ${relatedCase.title}` } : null,
        responsibleName: k.responsible_user ? (profileName.get(k.responsible_user) ?? null) : null,
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
      <p className="mt-4 text-xs text-ink-muted">
        دریافت‌ها و پرداخت‌های واقعیِ این قرارداد از بخش حسابداری (پس از اتصال در فازهای بعدی) نمایش داده خواهد شد؛ این اعداد صرفاً مفاد توافق‌شدهٔ قرارداد هستند.
      </p>
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
              { label: "مالی", content: financialTab },
              { label: "اسناد و فایل‌ها", content: attachmentsTab },
            ]}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اقدامات</p>
            <DetailActions id={k.id} status={k.status} kind={k.kind} />
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
