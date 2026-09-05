import { cn } from "@/lib/utils";
import { TASK_STATUS_LABEL, TASK_STATUS_TONE, type TaskStatus } from "@/lib/enums";

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={cn("badge bg-paper", TASK_STATUS_TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}
