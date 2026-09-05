"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trophy, XCircle, ArrowRightCircle, FileCheck2, Receipt, Link2, FolderKanban } from "lucide-react";
import {
  moveOpportunityStage,
  closeOpportunityWon,
  closeOpportunityLost,
  createContractFromOpportunity,
  linkExistingContract,
  createProformaFromOpportunity,
  type ActionState,
} from "@/app/actions/crm-opportunities";
import { createProjectFromOpportunity } from "@/app/actions/projects";
import { FormError, Field } from "@/components/form";
import { CRM_LOST_REASON, CRM_LOST_REASON_LABEL } from "@/lib/enums";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Stage = { id: string; name: string; is_won: boolean; is_lost: boolean };
type ContractOpt = { id: string; label: string };

export function DetailActions({
  id,
  stages,
  currentStageId,
  isClosed,
  hasInvoiceAccess,
  hasProjectAccess,
  hasContract,
  otherContracts,
}: {
  id: string;
  stages: Stage[];
  currentStageId: string;
  isClosed: boolean;
  hasInvoiceAccess: boolean;
  hasProjectAccess: boolean;
  hasContract: boolean;
  otherContracts: ContractOpt[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [showLost, setShowLost] = useState(false);
  const [showLinkContract, setShowLinkContract] = useState(false);

  function run(action: Action, fields: Record<string, string>) {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    startTransition(async () => {
      const res = await action(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        router.refresh();
      }
    });
  }

  function submitLost(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.append("id", id);
    startTransition(async () => {
      const res = await closeOpportunityLost(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setShowLost(false);
        router.refresh();
      }
    });
  }

  function submitLinkContract(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.append("opportunity_id", id);
    startTransition(async () => {
      const res = await linkExistingContract(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setError(undefined);
        setShowLinkContract(false);
        router.refresh();
      }
    });
  }

  const openStages = stages.filter((s) => !s.is_won && !s.is_lost);

  return (
    <div className="space-y-3">
      <FormError message={error} />

      {!isClosed && (
        <Field label="جابه‌جایی مرحله">
          <select
            className="input"
            defaultValue={currentStageId}
            disabled={pending}
            onChange={(e) => run(moveOpportunityStage, { id, stage_id: e.target.value })}
          >
            {openStages.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        </Field>
      )}

      <div className="flex flex-wrap gap-2">
        {!isClosed && (
          <>
            <button disabled={pending} className="btn-seal" onClick={() => run(closeOpportunityWon, { id })}>
              <Trophy className="h-4 w-4" /> موفق
            </button>
            <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => setShowLost((v) => !v)}>
              <XCircle className="h-4 w-4" /> ازدست‌رفته
            </button>
          </>
        )}

        {hasInvoiceAccess && (
          <>
            {!hasContract && (
              <button disabled={pending} className="btn-ghost" onClick={() => run(createContractFromOpportunity, { opportunity_id: id })}>
                <FileCheck2 className="h-4 w-4" /> ایجاد قرارداد
              </button>
            )}
            {!hasContract && otherContracts.length > 0 && (
              <button disabled={pending} className="btn-ghost" onClick={() => setShowLinkContract((v) => !v)}>
                <Link2 className="h-4 w-4" /> اتصال قرارداد موجود
              </button>
            )}
            <button disabled={pending} className="btn-ghost" onClick={() => run(createProformaFromOpportunity, { opportunity_id: id })}>
              <Receipt className="h-4 w-4" /> صدور پیش‌فاکتور
            </button>
          </>
        )}

        {hasProjectAccess && (
          <button disabled={pending} className="btn-ghost" onClick={() => run(createProjectFromOpportunity, { opportunity_id: id })}>
            <FolderKanban className="h-4 w-4" /> ایجاد پروژه
          </button>
        )}
      </div>

      {showLost && (
        <form onSubmit={submitLost} className="space-y-3 rounded-lg border border-paper-line bg-paper/40 p-3">
          <Field label="دلیل ازدست‌رفتن" required>
            <select name="lost_reason" required className="input">
              {CRM_LOST_REASON.map((r) => (<option key={r} value={r}>{CRM_LOST_REASON_LABEL[r]}</option>))}
            </select>
          </Field>
          <Field label="توضیح"><textarea name="lost_reason_note" rows={2} className="input" /></Field>
          <button type="submit" disabled={pending} className="btn-seal">
            <ArrowRightCircle className="h-4 w-4" /> ثبت ازدست‌رفته
          </button>
        </form>
      )}

      {showLinkContract && (
        <form onSubmit={submitLinkContract} className="space-y-3 rounded-lg border border-paper-line bg-paper/40 p-3">
          <Field label="قرارداد موجود">
            <select name="contract_id" required className="input">
              <option value="">— انتخاب —</option>
              {otherContracts.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
            </select>
          </Field>
          <button type="submit" disabled={pending} className="btn-primary">اتصال</button>
        </form>
      )}
    </div>
  );
}
