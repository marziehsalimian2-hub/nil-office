import { cn } from "@/lib/utils";
import { SALES_DOCUMENT_STATUS_LABEL, SALES_DOCUMENT_STATUS_TONE, type SalesDocumentStatus } from "@/lib/enums";

export function SalesDocumentStatusBadge({ status }: { status: SalesDocumentStatus }) {
  return (
    <span className={cn("badge bg-paper", SALES_DOCUMENT_STATUS_TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {SALES_DOCUMENT_STATUS_LABEL[status]}
    </span>
  );
}
