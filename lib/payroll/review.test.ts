import { describe, it, expect } from "vitest";
import { sortWarnings, groupWarningsByPersonnel, defaultRounding, canSubmitForReview } from "./review";

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
});
