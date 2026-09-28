import { describe, it, expect } from "vitest";
import { computeClaimableAmount } from "./claimableAmount";

describe("computeClaimableAmount", () => {
  it("sums service fee + billable time value + reimbursable expenses", () => {
    const result = computeClaimableAmount({
      serviceFee: 1_000_000,
      timeEntries: [{ billable: true, durationMinutes: 120, hourlyRateSnapshot: 500_000 }],
      expenses: [{ isReimbursable: true, reimbursableAmount: 200_000 }],
    });
    expect(result.billableTimeAmount).toBe(1_000_000);
    expect(result.reimbursableExpenseAmount).toBe(200_000);
    expect(result.claimableTotal).toBe(1_000_000 + 1_000_000 + 200_000);
  });

  it("excludes non-billable time and non-reimbursable expenses", () => {
    const result = computeClaimableAmount({
      serviceFee: 0,
      timeEntries: [{ billable: false, durationMinutes: 60, hourlyRateSnapshot: 1_000_000 }],
      expenses: [{ isReimbursable: false, reimbursableAmount: 500_000 }],
    });
    expect(result.billableTimeAmount).toBe(0);
    expect(result.reimbursableExpenseAmount).toBe(0);
    expect(result.claimableTotal).toBe(0);
  });

  it("treats a time entry with no snapshotted rate yet as zero-valued, not an error", () => {
    const result = computeClaimableAmount({
      serviceFee: 0,
      timeEntries: [{ billable: true, durationMinutes: 90, hourlyRateSnapshot: null }],
      expenses: [],
    });
    expect(result.billableTimeAmount).toBe(0);
  });

  it("handles an empty entry (no time, no expenses) as just the service fee", () => {
    const result = computeClaimableAmount({ serviceFee: 250_000, timeEntries: [], expenses: [] });
    expect(result.claimableTotal).toBe(250_000);
  });
});
