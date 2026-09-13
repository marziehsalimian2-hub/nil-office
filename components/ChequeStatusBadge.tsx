import { cn } from "@/lib/utils";
import { CHEQUE_STATUS_LABEL, CHEQUE_STATUS_TONE } from "@/lib/enums";

export function ChequeStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("badge bg-paper", CHEQUE_STATUS_TONE[status] ?? "status-draft")}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CHEQUE_STATUS_LABEL[status] ?? status}
    </span>
  );
}
