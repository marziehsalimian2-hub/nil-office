import { cn } from "@/lib/utils";
import { PROJECT_HEALTH_LABEL, PROJECT_HEALTH_TONE, type ProjectHealth } from "@/lib/project-health";

export function ProjectHealthBadge({ health }: { health: ProjectHealth }) {
  return (
    <span className={cn("badge bg-paper", PROJECT_HEALTH_TONE[health])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {PROJECT_HEALTH_LABEL[health]}
    </span>
  );
}
