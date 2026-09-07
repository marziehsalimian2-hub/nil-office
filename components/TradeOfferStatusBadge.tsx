import { cn } from "@/lib/utils";
import { TRADE_OFFER_STATUS_LABEL, TRADE_OFFER_STATUS_TONE, type TradeOfferStatus } from "@/lib/enums";

export function TradeOfferStatusBadge({ status }: { status: TradeOfferStatus }) {
  return (
    <span className={cn("badge bg-paper", TRADE_OFFER_STATUS_TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {TRADE_OFFER_STATUS_LABEL[status]}
    </span>
  );
}
