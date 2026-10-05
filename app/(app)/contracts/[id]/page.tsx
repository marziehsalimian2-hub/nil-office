import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDisplayUnit, loadAccountingOptions } from "@/app/actions/accounting-options";
import { loadContractOptions } from "@/app/actions/contract-options";
import { PageHeader, Card } from "@/components/ui";
import { EditableContractCard } from "./EditableContractCard";
import { ContractActions } from "./ContractActions";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, type ContractStatus } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { Contract, Company, Case, ContractType, Profile } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: contract } = await supabase.from("contracts").select("*").eq("id", id).single();
  if (!contract) notFound();
  const c = contract as Contract;

  const [{ data: type }, { data: company }, { data: relatedCase }, { data: responsible }, unit, opts] = await Promise.all([
    supabase.from("contract_types").select("id, label_fa").eq("id", c.contract_type_id).single(),
    c.party_company_id
      ? supabase.from("companies").select("id, legal_name").eq("id", c.party_company_id).single()
      : Promise.resolve({ data: null }),
    c.case_id
      ? supabase.from("cases").select("id, case_code, title").eq("id", c.case_id).single()
      : Promise.resolve({ data: null }),
    c.responsible_user_id
      ? supabase.from("profiles").select("id, full_name").eq("id", c.responsible_user_id).single()
      : Promise.resolve({ data: null }),
    getDisplayUnit(),
    loadContractOptions(),
  ]);

  const canEdit = c.status === "DRAFT" || c.status === "UNDER_REVIEW";
  const t = type as Pick<ContractType, "id" | "label_fa"> | null;
  const comp = company as Pick<Company, "id" | "legal_name"> | null;
  const cs = relatedCase as Pick<Case, "id" | "case_code" | "title"> | null;
  const resp = responsible as Pick<Profile, "id" | "full_name"> | null;

  return (
    <div>
      <PageHeader
        title={
          c.display_number
            ? toFaDigits(c.display_number)
            : c.is_historical
              ? `قرارداد تاریخی: ${c.original_contract_number ?? "—"}`
              : "پیش‌نویس قرارداد"
        }
        subtitle={c.title}
        action={<span className={`badge ${CONTRACT_STATUS_TONE[c.status as ContractStatus]}`}>{CONTRACT_STATUS_LABEL[c.status as ContractStatus]}</span>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <EditableContractCard
            id={id}
            canEdit={canEdit}
            types={opts.types.map((x) => ({ id: x.id, label: x.label_fa }))}
            companies={opts.companies.map((x) => ({ id: x.id, label: x.legal_name }))}
            cases={opts.cases.map((x) => ({ id: x.id, label: `${x.case_code ?? ""} ${x.title}`.trim() }))}
            profiles={opts.profiles.map((x) => ({ id: x.id, label: x.full_name ?? "—" }))}
            unit={unit}
            view={{
              title: c.title,
              contractTypeId: c.contract_type_id,
              typeLabel: t?.label_fa ?? null,
              partyCompanyId: c.party_company_id,
              partyLabel: comp?.legal_name ?? null,
              partyContactName: c.party_contact_name,
              caseId: c.case_id,
              caseLabel: cs ? `${cs.case_code} — ${cs.title}` : null,
              contractDate: c.contract_date,
              effectiveDate: c.effective_date,
              startDate: c.start_date,
              endDate: c.end_date,
              baseAmount: c.base_amount,
              taxAmount: c.tax_amount,
              totalAmount: c.total_amount,
              responsibleUserId: c.responsible_user_id,
              responsibleLabel: resp?.full_name ?? null,
              requiresGuarantee: c.requires_guarantee,
              autoRenewal: c.auto_renewal,
              description: c.description,
              internalNotes: c.internal_notes,
            }}
          />

          {c.is_historical && (
            <Card className="bg-paper/60">
              <p className="mb-1 text-sm font-medium text-ink">قرارداد تاریخی / سابق</p>
              <p className="text-sm text-ink-muted">
                شمارهٔ اصلی: {c.original_contract_number ?? "—"} — تاریخ اصلی: {formatJalali(c.original_contract_date)}
              </p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اقدامات</p>
            <ContractActions id={c.id} status={c.status as ContractStatus} />
          </Card>

          <Card>
            <p className="mb-3 text-sm font-medium text-ink">اطلاعات ثبت</p>
            <div className="space-y-2 text-sm text-ink-muted">
              <p>تاریخ ثبت: <span className="tnum">{formatJalali(c.created_at)}</span></p>
              {c.finalized_at && <p>تاریخ تأیید: <span className="tnum">{formatJalali(c.finalized_at)}</span></p>}
              {c.activated_at && <p>تاریخ فعال‌سازی: <span className="tnum">{formatJalali(c.activated_at)}</span></p>}
              {c.completed_at && <p>تاریخ تکمیل: <span className="tnum">{formatJalali(c.completed_at)}</span></p>}
              {c.terminated_at && <p>تاریخ فسخ: <span className="tnum">{formatJalali(c.terminated_at)}</span></p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
