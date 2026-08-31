import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatJalali } from "@/lib/jalali";
import { formatMoney } from "@/lib/money";
import { CONTRACT_KIND_LABEL, CONTRACT_STATUS_LABEL, type ContractKind, type ContractStatus } from "@/lib/enums";
import { renderContractPdf } from "@/lib/pdf/renderContractPdf";

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function extOf(p: string): string {
  return p.slice(p.lastIndexOf(".") + 1).toLowerCase();
}

async function pathToDataUri(
  supabase: SupabaseClient,
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from("nil-files").download(storagePath);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = EXT_TO_MIME[extOf(storagePath)] ?? "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Loads everything needed to render a contract's letterhead summary sheet
 * (not the legal contract text itself — see spec exclusion on automatic
 * contract drafting) and returns the finished PDF bytes.
 */
export async function buildContractPdf(supabase: SupabaseClient, contractId: string): Promise<Buffer> {
  const { data: contract, error } = await supabase
    .from("contracts")
    .select(
      "id, title, kind, status, display_number, external_contract_number, contract_type_id, counterparty_company_id, case_id, signed_date, effective_date, expiry_date, base_amount, discount_amount, tax_amount, total_amount, currency_code, description, responsible_user, approved_by, approved_at, finalized_at, created_at",
    )
    .eq("id", contractId)
    .single();
  if (error || !contract) throw new Error("قرارداد یافت نشد.");

  const [{ data: settings }, typeRes, companyRes, caseRes, responsibleRes, approverRes] = await Promise.all([
    supabase.from("app_settings").select("letterhead_path, stamp_path").eq("id", 1).single(),
    supabase.from("contract_types").select("name").eq("id", contract.contract_type_id).single(),
    contract.counterparty_company_id
      ? supabase.from("companies").select("legal_name").eq("id", contract.counterparty_company_id).single()
      : Promise.resolve({ data: null }),
    contract.case_id
      ? supabase.from("cases").select("case_code, title").eq("id", contract.case_id).single()
      : Promise.resolve({ data: null }),
    contract.responsible_user
      ? supabase.from("profiles").select("full_name").eq("id", contract.responsible_user).single()
      : Promise.resolve({ data: null }),
    contract.approved_by
      ? supabase.from("profiles").select("full_name, signature_path").eq("id", contract.approved_by).single()
      : Promise.resolve({ data: null }),
  ]);

  const type = typeRes.data;
  const company = companyRes.data;
  const kase = caseRes.data;
  const responsible = responsibleRes.data;
  const approver = approverRes.data;

  const [letterheadDataUri, stampDataUri, signatureDataUri] = await Promise.all([
    pathToDataUri(supabase, settings?.letterhead_path),
    pathToDataUri(supabase, settings?.stamp_path),
    contract.approved_by ? pathToDataUri(supabase, approver?.signature_path) : Promise.resolve(null),
  ]);

  return renderContractPdf({
    displayNumber: contract.display_number ?? contract.external_contract_number,
    dateLabel: formatJalali(contract.finalized_at ?? contract.created_at),
    title: contract.title,
    typeLabel: type?.name ?? null,
    kindLabel: CONTRACT_KIND_LABEL[contract.kind as ContractKind],
    statusLabel: CONTRACT_STATUS_LABEL[contract.status as ContractStatus],
    counterpartyLabel: company?.legal_name ?? null,
    caseLabel: kase ? `${kase.case_code ?? ""} — ${kase.title}` : null,
    signedDateLabel: formatJalali(contract.signed_date),
    effectiveDateLabel: formatJalali(contract.effective_date),
    expiryDateLabel: formatJalali(contract.expiry_date),
    baseAmountLabel: formatMoney(contract.base_amount),
    discountAmountLabel: formatMoney(contract.discount_amount),
    taxAmountLabel: formatMoney(contract.tax_amount),
    totalAmountLabel: formatMoney(contract.total_amount),
    currencyCode: contract.currency_code,
    description: contract.description,
    responsibleLabel: responsible?.full_name ?? null,
    approverLabel: approver?.full_name ?? null,
    letterheadDataUri,
    stampDataUri,
    signatureDataUri,
  });
}
