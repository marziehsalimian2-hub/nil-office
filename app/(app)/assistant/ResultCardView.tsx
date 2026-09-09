import Link from "next/link";
import { FileText, FolderKanban, FileSignature, Receipt, Building2, Target, AlertTriangle, CalendarClock, Send, Handshake, ListChecks } from "lucide-react";
import type { ResultCard } from "@/lib/assistant/actions/types";

const ICON: Record<ResultCard["kind"], typeof FileText> = {
  task: ListChecks,
  project: FolderKanban,
  contract: FileSignature,
  invoice: Receipt,
  company: Building2,
  opportunity: Target,
  attention: AlertTriangle,
  followup: CalendarClock,
  correspondence: Send,
  trade_offer: Handshake,
};

/** One generic card renderer for every result-card kind (task/project/contract/invoice/company/opportunity/attention/followup/correspondence/trade_offer) — every card is a real link to the real entity page (spec §29/§30), never a dead end. */
export function ResultCardView({ card }: { card: ResultCard }) {
  const Icon = ICON[card.kind] ?? FileText;
  return (
    <Link href={card.href} className="flex items-start gap-2.5 rounded-lg border border-paper-line bg-paper-card px-3 py-2.5 text-sm hover:border-seal">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
      <span className="min-w-0">
        <span className="block truncate text-ink">{card.title}</span>
        {card.subtitle && <span className="block truncate text-xs text-ink-muted">{card.subtitle}</span>}
      </span>
    </Link>
  );
}
