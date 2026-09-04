import { cn } from "@/lib/utils";

export function OpportunityStageBadge({
  name,
  isWon,
  isLost,
}: {
  name: string;
  isWon: boolean;
  isLost: boolean;
}) {
  const tone = isWon ? "status-received" : isLost ? "status-cancelled" : "status-review";
  return (
    <span className={cn("badge bg-paper", tone)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {name}
    </span>
  );
}
