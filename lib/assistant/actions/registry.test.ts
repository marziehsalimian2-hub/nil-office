import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTION_REGISTRY, buildLlmTools } from "./registry";
import { WRITE_EXECUTORS } from "../confirmation";

/**
 * Structural guarantees of the Action Registry (Internal Assistant v1.0 spec §4/§41/§43). These tests exist
 * because three of these failure modes have each happened in production-adjacent testing:
 *   - a zod `.positive()/.gt()/.lt()` renders draft-04 `exclusiveMinimum: true`, Anthropic rejects the WHOLE
 *     tool list, and EVERY chat turn fails (not just that action);
 *   - Telegram runs as service_role, so an action with no `requiredAccess` has no permission check at all;
 *   - a write action with no executor (or an executor with no action) is a silent dead end.
 */

/**
 * Actions deliberately open to any ACTIVE user, each with the reason it is safe. Anything not listed here MUST
 * declare `requiredAccess`; adding a new ungated action (or removing a gate) fails this test until the list —
 * and therefore a human — is updated.
 */
const ANY_ACTIVE_USER: Record<string, string> = {
  // data every active user can already read on the web (RLS: p_*_read using is_active_user())
  SEARCH_COMPANY: "companies readable by any active user (p_companies_read, 0004)",
  SEARCH_CORRESPONDENCE: "correspondence readable by any active user (p_corr_read, 0004)",
  SEARCH_DOCUMENTS: "documents readable by any active user (p_docs_read, 0004)",
  GET_CORRESPONDENCE: "correspondence readable by any active user (p_corr_read, 0004)",
  GET_DOCUMENT_METADATA: "documents readable by any active user (p_docs_read, 0004)",
  LIST_FOLLOWUPS: "followups readable by any active user (p_followups_read, 0004)",
  CREATE_FOLLOWUP_DRAFT: "followups insertable by any active user (p_followups_write, 0004)",
  CREATE_TASK_DRAFT: "tasks insertable by any active user (p_tasks_write, 0054)",
  // scoped INSIDE the handler to the caller's own rows / role-gated sections
  LIST_MY_TASKS: "filters assigned_to = caller",
  GET_TASK: "without project access only the caller's own tasks (p_tasks_read, 0054) — scoped in the handler",
  SEARCH_TASKS: "without project access only the caller's own tasks (p_tasks_read, 0054) — scoped in the handler",
  GET_COMPANY_360: "each module section is included only when the caller holds that module's role",
  GET_TODAY_WORK: "lib/dashboard getters gate each section by role and scope to the caller",
  GET_ATTENTION_ITEMS: "lib/dashboard getters gate each section by role",
  GET_DAILY_BRIEF: "composition of the gated lib/dashboard getters",
  // outgoing letters / incoming registration: any active user on the web; proposals are own-draft-only
  CREATE_LETTER_DRAFT: "any active user may draft a letter (p_corr_write, 0004)",
  FINALIZE_LETTER: "finalize_correspondence is is_active_user() on the web; the action additionally limits it to the caller's own draft (or ADMIN)",
  REGISTER_INCOMING_LETTER: "register_incoming is is_active_user() on the web (0003/0004)",
  // the caller's own data, resolved server-side — no parameter names a person
  GET_MY_PAYSLIP: "own payslip only: owner = authenticated profile, enforced again inside the 0134 SECURITY DEFINER functions",
};

const tools = buildLlmTools();

describe("Action Registry — structure", () => {
  it("has unique action names that satisfy the Anthropic tool-name rule", () => {
    const names = ACTION_REGISTRY.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("every action has a Persian/precise description and a valid risk level", () => {
    for (const a of ACTION_REGISTRY) {
      expect(a.description.length, a.name).toBeGreaterThan(20);
      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"], a.name).toContain(a.riskLevel);
    }
  });

  it("no CRITICAL action is registered, and there is no generic SQL / database / eval tool", () => {
    for (const a of ACTION_REGISTRY) {
      expect(a.riskLevel, a.name).not.toBe("CRITICAL");
      expect(a.name, a.name).not.toMatch(/SQL|QUERY|EVAL|EXEC|RAW|SHELL|RUN_/i);
    }
  });

  it("accounting posting / reversal, cheque issue-clear-void and payroll approval/payment are NOT reachable", () => {
    const names = ACTION_REGISTRY.map((a) => a.name).join(" ");
    for (const forbidden of ["POST_", "REVERSE", "VERIFY_", "ALLOCAT", "SETTLE", "ISSUE_CHEQUE", "CLEAR_CHEQUE", "VOID_CHEQUE", "APPROVE_PAYROLL", "PAY_SALARY", "CALCULATE_PAYROLL", "BILLING_BATCH"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Action Registry — tool schemas (the recurring Anthropic whole-list failure)", () => {
  it("builds one tool per action", () => {
    expect(tools.length).toBe(ACTION_REGISTRY.length);
  });

  it("no schema contains a boolean exclusiveMinimum/exclusiveMaximum (zod .positive()/.negative()/.gt()/.lt())", () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if ((k === "exclusiveMinimum" || k === "exclusiveMaximum") && typeof v !== "number") offenders.push(`${path}.${k}=${String(v)}`);
          walk(v, `${path}.${k}`);
        }
      }
    };
    for (const t of tools) walk(t.inputSchema, t.name);
    expect(offenders).toEqual([]);
  });

  it("every tool input is a JSON-schema object", () => {
    for (const t of tools) expect(t.inputSchema.type, t.name).toBe("object");
  });

  it("the action sources never call .positive()/.negative()/.gt()/.lt() on a zod type", () => {
    const dir = join(process.cwd(), "lib", "assistant", "actions");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const code = readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
      expect(code, f).not.toMatch(/\.(positive|negative|gt|lt)\(/);
    }
  });
});

describe("Action Registry — permissions (Telegram runs as service_role: requiredAccess is the only gate)", () => {
  it("every action without requiredAccess is on the reviewed any-active-user allowlist (and vice versa)", () => {
    const ungated = ACTION_REGISTRY.filter((a) => !a.requiredAccess).map((a) => a.name).sort();
    expect(ungated).toEqual(Object.keys(ANY_ACTIVE_USER).sort());
  });

  it("the whole service-ledger family, company financials and invoicing are gated", () => {
    const gated = new Set(ACTION_REGISTRY.filter((a) => a.requiredAccess).map((a) => a.name));
    for (const n of [
      "GET_CLIENT_SERVICE_SUMMARY", "LIST_CLIENT_SERVICES", "SEARCH_SERVICE_ENTRIES", "GET_UNBILLED_WORK", "GET_REIMBURSABLE_EXPENSES",
      "CREATE_SERVICE_ENTRY_DRAFT", "ADD_TIME_ENTRY_DRAFT", "ADD_SERVICE_EXPENSE_DRAFT",
      "GET_CLIENT_SERVICE_PERIOD_NUMBERS", "LIST_CLIENT_REPORT_TEMPLATES", "GET_CLIENT_DEFAULT_REPORT_TEMPLATE", "GET_CLIENT_REPORT_HISTORY", "PREPARE_CLIENT_SERVICE_REPORT",
      "GET_COMPANY_FINANCIAL_SUMMARY", "CREATE_INVOICE_DRAFT", "ISSUE_SALES_DOCUMENT",
    ]) expect(gated.has(n), n).toBe(true);
  });

  it("official-number actions are HIGH; drafts are MEDIUM (the draft/finalize split)", () => {
    const risk = (n: string) => ACTION_REGISTRY.find((a) => a.name === n)?.riskLevel;
    expect(risk("CREATE_LETTER_DRAFT")).toBe("MEDIUM");
    expect(risk("CREATE_INVOICE_DRAFT")).toBe("MEDIUM");
    expect(risk("FINALIZE_LETTER")).toBe("HIGH");
    expect(risk("ISSUE_SALES_DOCUMENT")).toBe("HIGH");
    expect(risk("REGISTER_INCOMING_LETTER")).toBe("HIGH");
  });

  it("issuing an invoice needs the APPROVE tier, drafting only CREATE", () => {
    const create = ACTION_REGISTRY.find((a) => a.name === "CREATE_INVOICE_DRAFT")!;
    const issue = ACTION_REGISTRY.find((a) => a.name === "ISSUE_SALES_DOCUMENT")!;
    const profile = (invoice_role: string) => ({ role: "USER", invoice_role }) as never;
    expect(create.requiredAccess!(profile("CREATE"))).toBe(true);
    expect(issue.requiredAccess!(profile("CREATE"))).toBe(false);
    expect(issue.requiredAccess!(profile("APPROVE"))).toBe(true);
  });
});

describe("Action Registry — write actions and executors", () => {
  const writes = ACTION_REGISTRY.filter((a) => a.requiresConfirmation).map((a) => a.name).sort();

  it("every confirmable action has exactly one executor, and every executor belongs to a confirmable action", () => {
    expect(Object.keys(WRITE_EXECUTORS).sort()).toEqual(writes);
  });

  it("MEDIUM/HIGH actions always require confirmation; LOW actions never write", () => {
    for (const a of ACTION_REGISTRY) {
      if (a.riskLevel === "LOW") expect(a.requiresConfirmation, a.name).toBe(false);
      else expect(a.requiresConfirmation, a.name).toBe(true);
    }
  });

  it("the payslip action takes no person identifier (own payslip only)", () => {
    const t = tools.find((x) => x.name === "GET_MY_PAYSLIP")!;
    const props = Object.keys((t.inputSchema.properties as Record<string, unknown>) ?? {});
    for (const p of props) expect(p, p).not.toMatch(/person|employee|profile|user|personnel|name/i);
  });
});

describe("Action Registry — documentation", () => {
  it("every registered action is documented in docs/ASSISTANT_ACTION_REGISTRY.md", () => {
    const doc = readFileSync(join(process.cwd(), "docs", "ASSISTANT_ACTION_REGISTRY.md"), "utf8");
    const missing = ACTION_REGISTRY.map((a) => a.name).filter((n) => !doc.includes("`" + n + "`"));
    expect(missing).toEqual([]);
  });
});

describe("Action Registry — receipt / payment drafts (Slice 2): draft only, never verify / post / allocate", () => {
  const find = (n: string) => ACTION_REGISTRY.find((a) => a.name === n)!;
  const profile = (accounting_role: string | null, role = "USER") => ({ role, accounting_role }) as never;

  it("the cash actions exist, are MEDIUM drafts with confirmation, and the bank list is a LOW read", () => {
    for (const n of ["CREATE_RECEIPT_DRAFT", "CREATE_PAYMENT_DRAFT"]) {
      expect(find(n).riskLevel, n).toBe("MEDIUM");
      expect(find(n).requiresConfirmation, n).toBe(true);
    }
    expect(find("LIST_BANK_ACCOUNTS").riskLevel).toBe("LOW");
    expect(find("LIST_BANK_ACCOUNTS").requiresConfirmation).toBe(false);
  });

  it("drafting needs accounting CREATE / POST / ADMIN (or app ADMIN); a VIEW-only accountant or a non-accountant cannot", () => {
    for (const n of ["CREATE_RECEIPT_DRAFT", "CREATE_PAYMENT_DRAFT"]) {
      const gate = find(n).requiredAccess!;
      expect(gate(profile(null)), n).toBe(false);
      expect(gate(profile("VIEW")), n).toBe(false);
      expect(gate(profile("CREATE")), n).toBe(true);
      expect(gate(profile("POST")), n).toBe(true);
      expect(gate(profile(null, "ADMIN")), n).toBe(true);
    }
  });

  it("listing bank accounts needs any accounting role", () => {
    const gate = find("LIST_BANK_ACCOUNTS").requiredAccess!;
    expect(gate(profile(null))).toBe(false);
    expect(gate(profile("VIEW"))).toBe(true);
  });

  it("the bank list exposes no account number / IBAN column", () => {
    const code = readFileSync(join(process.cwd(), "lib", "assistant", "actions", "cash.ts"), "utf8");
    const select = /from\("bank_accounts"\)\.select\("([^"]+)"\)/.exec(code)?.[1] ?? "";
    expect(select).toContain("account_title");
    expect(select).not.toMatch(/account_number|iban/i);
  });

  it("neither the cash actions nor createCashDraftCore reference verify / post / allocation / journal operations", () => {
    const actions = readFileSync(join(process.cwd(), "lib", "assistant", "actions", "cash.ts"), "utf8");
    const accounting = readFileSync(join(process.cwd(), "app", "actions", "accounting.ts"), "utf8");
    const start = accounting.indexOf("export async function createCashDraftCore");
    const end = accounting.indexOf("/** Update a receipt/payment's fields", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const core = accounting.slice(start, end);
    const strip = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
    for (const [label, code] of [["cash.ts", strip(actions)], ["createCashDraftCore", strip(core)]] as const) {
      expect(code, label).not.toMatch(/post_receipt|post_payment|verify_receipt|verify_payment|set_cash_allocations|post_journal|journal_entr|reverse_/i);
    }
  });

  it("the draft insert never sets verification, numbering, journal or counterpart-account fields", () => {
    const accounting = readFileSync(join(process.cwd(), "app", "actions", "accounting.ts"), "utf8");
    const start = accounting.indexOf("export async function createCashDraftCore");
    const core = accounting.slice(start, accounting.indexOf("/** Update a receipt/payment's fields", start));
    const insert = /\.insert\(\{([\s\S]*?)\}\)\s*\.select\("id"\)/.exec(core)?.[1] ?? "";
    expect(insert).toContain('status: "DRAFT"');
    expect(insert).toContain("counterpart_account_id: null");
    expect(insert).not.toMatch(/verified_|display_number|sequence_number|journal_entry_id|POSTED/);
  });
});
