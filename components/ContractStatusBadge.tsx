import { cn } from "@/lib/utils";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, type ContractStatus } from "@/lib/enums";

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return (
    <span className={cn("badge bg-paper", CONTRACT_STATUS_TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CONTRACT_STATUS_LABEL[status]}
    </span>
  );
}
