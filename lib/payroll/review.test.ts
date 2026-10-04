import { describe, it, expect } from "vitest";
import { sortWarnings, groupWarningsByPersonnel, defaultRounding, canSubmitForReview, canApproveBatch, accountingBlockers } from "./review";
import { PAYROLL_APPROVAL_BLOCKER_LABEL, PAYROLL_STALE_REASON_LABEL } from "@/lib/enums";

describe("review helpers", () => {
  it("sorts CRITICAL before WARNING before INFO, then by code", () => {
    const out = sortWarnings([
      { severity: "INFO", code: "B" }, { severity: "CRITICAL", code: "Z" },
      { severity: "WARNING", code: "A" }, { severity: "CRITICAL", code: "A" },
    ]);
    expect(out.map((w) => `${w.severity}:${w.code}`)).toEqual(["CRITICAL:A", "CRITICAL:Z", "WARNING:A", "INFO:B"]);
  });

  it("groups by personnel with batch-level warnings under the empty key", () => {
    const m = groupWarningsByPersonnel([
      { personnel_id: "p1", severity: "WARNING", code: "X" },
      { personnel_id: "p1", severity: "CRITICAL", code: "Y" },
      { personnel_id: null, severity: "CRITICAL", code: "NO_ELIGIBLE_PERSONNEL" },
    ]);
    expect(m.get("p1")?.map((w) => w.code)).toEqual(["Y", "X"]);
    expect(m.get("")?.length).toBe(1);
  });

  it("defaults rounding by currency (form pre-fill only)", () => {
    expect(defaultRounding("IRR")).toEqual({ scale: 0, mode: "HALF_UP" });
    expect(defaultRounding("TOMAN")).toEqual({ scale: 0, mode: "HALF_UP" });
    expect(defaultRounding("USD")).toEqual({ scale: 2, mode: "HALF_UP" });
    expect(defaultRounding(undefined)).toEqual({ scale: 2, mode: "HALF_UP" });
  });

  it("only a fresh CALCULATED batch can be submitted", () => {
    expect(canSubmitForReview("CALCULATED", [])).toBe(true);
    expect(canSubmitForReview("CALCULATED", ["WORK_DATA_CHANGED"])).toBe(false);
    expect(canSubmitForReview("DRAFT", [])).toBe(false);
    expect(canSubmitForReview("UNDER_REVIEW", [])).toBe(false);
  });

  it("final approval is only offered for UNDER_REVIEW with no blockers", () => {
    expect(canApproveBatch("UNDER_REVIEW", [])).toBe(true);
    expect(canApproveBatch("UNDER_REVIEW", ["STALE"])).toBe(false);
    expect(canApproveBatch("CALCULATED", [])).toBe(false);
    expect(canApproveBatch("APPROVED", [])).toBe(false);
  });

  it("orders accounting blockers and has labels for every DB blocker/stale code", () => {
    const base = { base_currency: "IRR", currency_ok: true, settings_ok: true, missing_components: [], journal: null, can_draft: true };
    expect(accountingBlockers(base)).toEqual([]);
    expect(accountingBlockers({ ...base, currency_ok: false, settings_ok: false, missing_components: [{ code: "X", name: "x" }] }))
      .toEqual(["CURRENCY_NOT_BASE", "SETTINGS_MISSING", "COMPONENTS_UNMAPPED"]);
    for (const c of ["NOT_REVIEWED", "STALE", "CRITICAL", "EMPTY"]) expect(PAYROLL_APPROVAL_BLOCKER_LABEL[c]).toBeTruthy();
    for (const c of ["WORK_DATA_CHANGED", "COMPENSATION_CHANGED", "ELIGIBILITY_CHANGED", "SETTINGS_CHANGED", "RULES_CHANGED"])
      expect(PAYROLL_STALE_REASON_LABEL[c]).toBeTruthy();
  });
});
