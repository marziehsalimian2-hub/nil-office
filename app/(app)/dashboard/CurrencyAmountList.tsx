import { formatMoney } from "@/lib/money";
import { CURRENCY_LABEL, type Currency } from "@/lib/enums";
import type { CurrencyAmount } from "@/lib/dashboard/types";

/** Never sums across currencies (spec §11/§17) — one labeled line per currency, exactly the format the spec's own example shows. */
export function CurrencyAmountList({ amounts, emptyText }: { amounts: CurrencyAmount[]; emptyText: string }) {
  if (amounts.length === 0) return <p className="text-sm text-ink-muted">{emptyText}</p>;
  return (
    <ul className="space-y-1">
      {amounts.map((a) => (
        <li key={a.currency_code} className="flex items-center justify-between text-sm">
          <span className="text-ink-muted">{CURRENCY_LABEL[a.currency_code as Currency] ?? a.currency_code}</span>
          <span className="tnum font-medium text-ink">{formatMoney(a.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
