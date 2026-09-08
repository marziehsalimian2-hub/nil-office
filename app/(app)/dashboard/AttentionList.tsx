import Link from "next/link";
import { ATTENTION_SEVERITY_TONE, type AttentionSeverity } from "@/lib/enums";
import { cn } from "@/lib/utils";
import type { AttentionItem } from "@/lib/dashboard/types";

const SEVERITY_DOT: Record<AttentionSeverity, string> = {
  CRITICAL: "bg-status-cancelled", HIGH: "bg-status-cancelled", WARNING: "bg-status-waiting", INFO: "bg-status-review",
};

/** Renders the Attention Center list — every item traces to a deterministic rule_code (spec §46), shown as a title tooltip for traceability. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-muted">هیچ مورد فوری نیازمند توجه نیست.</p>;
  }
  return (
    <ul className="divide-y divide-paper-line/60">
      {items.map((item) => (
        <li key={item.id} className="py-2.5">
          <Link href={item.navigation_target} className="group flex items-start gap-2.5">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[item.severity])} title={item.rule_code} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink group-hover:text-seal">{item.title}</span>
              <span className="mt-0.5 block text-xs text-ink-muted">{item.description}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
