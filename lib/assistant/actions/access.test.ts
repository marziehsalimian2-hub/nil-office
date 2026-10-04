import { describe, it, expect } from "vitest";
import type { Profile } from "@/lib/types/database";
import {
  hasServiceLedgerAccess, hasProjectAccess, canCreateInvoice, canApproveInvoice, canViewCompanyFinancials, withAccess, htmlToPlainText,
} from "./access";
import type { ActionDefinition } from "./types";

const p = (over: Partial<Profile> = {}) => ({ role: "USER", is_active: true, ...over }) as unknown as Profile;

describe("permission predicates mirror the SQL helpers", () => {
  it("service ledger: ADMIN or any service_ledger_role", () => {
    expect(hasServiceLedgerAccess(p())).toBe(false);
    expect(hasServiceLedgerAccess(p({ service_ledger_role: "VIEW" }))).toBe(true);
    expect(hasServiceLedgerAccess(p({ role: "ADMIN" }))).toBe(true);
  });
  it("project: ADMIN or any project_role", () => {
    expect(hasProjectAccess(p())).toBe(false);
    expect(hasProjectAccess(p({ project_role: "VIEW" }))).toBe(true);
  });
  it("invoice: CREATE tier creates a draft, only APPROVE/ADMIN may issue", () => {
    expect(canCreateInvoice(p({ invoice_role: "VIEW" }))).toBe(false);
    expect(canCreateInvoice(p({ invoice_role: "CREATE" }))).toBe(true);
    expect(canApproveInvoice(p({ invoice_role: "CREATE" }))).toBe(false);
    expect(canApproveInvoice(p({ invoice_role: "APPROVE" }))).toBe(true);
    expect(canApproveInvoice(p({ role: "ADMIN" }))).toBe(true);
  });
  it("company financials: ADMIN or an accounting / invoice / contract role only", () => {
    expect(canViewCompanyFinancials(p())).toBe(false);
    expect(canViewCompanyFinancials(p({ crm_role: "ADMIN" }))).toBe(false);
    expect(canViewCompanyFinancials(p({ accounting_role: "VIEW" }))).toBe(true);
    expect(canViewCompanyFinancials(p({ invoice_role: "VIEW" }))).toBe(true);
    expect(canViewCompanyFinancials(p({ contract_role: "VIEW" }))).toBe(true);
  });
  it("payroll / HR roles grant nothing here", () => {
    expect(canViewCompanyFinancials(p({ payroll_role: "ADMIN", hr_role: "ADMIN" }))).toBe(false);
    expect(hasServiceLedgerAccess(p({ payroll_role: "ADMIN" }))).toBe(false);
  });
});

describe("withAccess", () => {
  const a = { name: "A" } as unknown as ActionDefinition<any>;
  const b = { name: "B", requiredAccess: () => false } as unknown as ActionDefinition<any>;
  it("adds the gate only where an action has none of its own", () => {
    const [ga, gb] = withAccess([a, b], () => true);
    expect(ga.requiredAccess?.(p())).toBe(true);
    expect(gb.requiredAccess?.(p())).toBe(false);
  });
});

describe("htmlToPlainText", () => {
  it("turns stored letter HTML into readable chat text", () => {
    expect(htmlToPlainText("<p>سلام</p><p>متن &amp; ادامه<br/>خط بعد</p>")).toBe("سلام\nمتن & ادامه\nخط بعد");
  });
  it("is safe on null/empty", () => {
    expect(htmlToPlainText(null)).toBe("");
    expect(htmlToPlainText("")).toBe("");
  });
});
