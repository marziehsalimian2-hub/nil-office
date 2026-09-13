"use client";

import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { recordChequePrint } from "@/app/actions/cheques";

/**
 * Records the print (test or real) BEFORE opening the browser print
 * dialog — audited regardless of whether the user completes/cancels the
 * physical print. A real print of an ISSUED+ cheque is server-gated
 * (record_cheque_print RPC) — a rejection here shows a Persian error
 * instead of opening the print dialog.
 */
export function PrintTrigger({ chequeId, templateId, isTestPrint }: { chequeId: string; templateId: string; isTestPrint: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handlePrint() {
    startTransition(async () => {
      const result = await recordChequePrint(chequeId, isTestPrint, templateId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
      window.print();
    });
  }

  return (
    <div className="no-print flex flex-col items-start gap-2">
      <button type="button" className="btn-seal" onClick={handlePrint} disabled={pending}>
        <Printer className="h-4 w-4" /> {isTestPrint ? "چاپ آزمایشی" : "چاپ"}
      </button>
      {error && <p className="text-sm text-status-cancelled">{error}</p>}
    </div>
  );
}
