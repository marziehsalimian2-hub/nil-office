import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, type ProjectStatus } from "@/lib/enums";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={cn("badge bg-paper", PROJECT_STATUS_TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {PROJECT_STATUS_LABEL[status]}
    </span>
  );
}
