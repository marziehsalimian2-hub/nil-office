/**
 * Pure mirror of get_service_entry_claimable_amount()/
 * get_client_service_claimable_summary() (0085_service_ledger_functions.sql)
 * — same arithmetic, over already-fetched rows, with no DB round-trip.
 * The DB function stays the one AUTHORITATIVE source once a row exists
 * (spec's own "no financial total without source" rule); this helper
 * exists for places that want the same number before the row is even
 * saved yet — e.g. a running total in an advanced entry form once it
 * collects an hourly rate (Quick Add itself doesn't ask for one, so it
 * has nothing to preview here).
 */
export type ClaimableAmountInput = {
  serviceFee: number;
  timeEntries: { billable: boolean; durationMinutes: number; hourlyRateSnapshot: number | null }[];
  expenses: { isReimbursable: boolean; reimbursableAmount: number | null }[];
};

export type ClaimableAmountResult = {
  serviceFee: number;
  billableTimeAmount: number;
  reimbursableExpenseAmount: number;
  claimableTotal: number;
};

export function computeClaimableAmount(input: ClaimableAmountInput): ClaimableAmountResult {
  const billableTimeAmount = input.timeEntries.reduce((sum, t) => {
    if (!t.billable || t.hourlyRateSnapshot == null) return sum;
    return sum + (t.durationMinutes / 60) * t.hourlyRateSnapshot;
  }, 0);

  const reimbursableExpenseAmount = input.expenses.reduce((sum, e) => {
    if (!e.isReimbursable || e.reimbursableAmount == null) return sum;
    return sum + e.reimbursableAmount;
  }, 0);

  return {
    serviceFee: input.serviceFee,
    billableTimeAmount,
    reimbursableExpenseAmount,
    claimableTotal: input.serviceFee + billableTimeAmount + reimbursableExpenseAmount,
  };
}
