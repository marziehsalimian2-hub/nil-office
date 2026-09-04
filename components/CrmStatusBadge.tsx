import { cn } from "@/lib/utils";
import { CRM_COMPANY_STATUS_LABEL, CRM_COMPANY_STATUS_TONE, type CrmCompanyStatus } from "@/lib/enums";

export function CrmStatusBadge({ status }: { status: CrmCompanyStatus }) {
  return (
    <span className={cn("badge bg-paper", CRM_COMPANY_STATUS_TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CRM_COMPANY_STATUS_LABEL[status]}
    </span>
  );
}
