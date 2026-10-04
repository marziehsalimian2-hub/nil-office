import { describe, it, expect } from "vitest";
import { hrHeadcount } from "./dashboard";

describe("hrHeadcount", () => {
  const rows = [
    { employment_status: "ACTIVE", hire_date: "2026-03-21", termination_date: null },
    { employment_status: "ACTIVE", hire_date: "2026-10-01", termination_date: null },
    { employment_status: "ON_LEAVE", hire_date: "2020-01-01", termination_date: null },
    { employment_status: "SUSPENDED", hire_date: "2020-01-01", termination_date: null },
    { employment_status: "TERMINATED", hire_date: "2019-01-01", termination_date: "2026-09-25" },
    { employment_status: "TERMINATED", hire_date: "2019-01-01", termination_date: "2026-01-01" },
    { employment_status: "ARCHIVED", hire_date: "2018-01-01", termination_date: "2022-01-01" },
  ];

  it("counts by status", () => {
    const h = hrHeadcount(rows, "2026-10-04");
    expect([h.total, h.active, h.on_leave, h.suspended, h.terminated, h.archived]).toEqual([7, 2, 1, 1, 2, 1]);
  });

  it("counts hires and terminations inside the 30-day window only", () => {
    const h = hrHeadcount(rows, "2026-10-04");
    expect(h.since).toBe("2026-09-04");
    expect(h.new_hires).toBe(1);        // 2026-10-01; the March hire is outside the window
    expect(h.terminations).toBe(1);     // 2026-09-25; January and 2022 are outside
  });

  it("ignores future-dated hires and handles an empty list", () => {
    expect(hrHeadcount([{ employment_status: "ACTIVE", hire_date: "2026-12-01", termination_date: null }], "2026-10-04").new_hires).toBe(0);
    expect(hrHeadcount([], "2026-10-04")).toMatchObject({ total: 0, active: 0, new_hires: 0, terminations: 0 });
  });
});
