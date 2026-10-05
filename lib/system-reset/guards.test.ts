import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetEnvironment, productionResetAllowed, resetGuard } from "./env";
import { OPERATIONAL_PHRASE, fullResetPhrase, phraseMatches } from "./phrases";
import { armSchema, cancelSchema, dryRunSchema, executeSchema, runSchema, NUMBERING_SCOPES, DEFAULT_BASELINES } from "./schemas";
import { chunk, isPreservedStoragePath, isSafeStoragePath, splitRemovable } from "./storage";
import { allowedDuringMaintenance, isMaintenanceLocked, _resetMaintenanceCache } from "./maintenance";
import { buildResetReport } from "./report";

describe("environment guard (server-side only)", () => {
  it("a missing or invalid NIL_ENVIRONMENT is treated as production — the strictest", () => {
    expect(resetEnvironment(undefined)).toBe("production");
    expect(resetEnvironment("")).toBe("production");
    expect(resetEnvironment("staging")).toBe("production");
    expect(resetEnvironment("UAT ")).toBe("uat");
    expect(resetEnvironment("development")).toBe("development");
  });
  it("production is blocked unless the server explicitly allows it", () => {
    expect(resetGuard("production", false)).toEqual({ allowed: false, reason: "PRODUCTION_BLOCKED" });
    expect(resetGuard("production", true)).toEqual({ allowed: true });
    expect(resetGuard("uat", false)).toEqual({ allowed: true });
  });
  it("only the exact string «true» enables a production reset", () => {
    expect(productionResetAllowed(undefined)).toBe(false);
    expect(productionResetAllowed("1")).toBe(false);
    expect(productionResetAllowed("TRUE")).toBe(false);
    expect(productionResetAllowed("true")).toBe(true);
  });
});

describe("typed confirmation", () => {
  it("operational phrase is exact; full reset needs a stronger environment-specific one", () => {
    expect(phraseMatches("OPERATIONAL", "uat", OPERATIONAL_PHRASE)).toBe(true);
    expect(phraseMatches("OPERATIONAL", "uat", "reset nil office")).toBe(false);
    expect(phraseMatches("OPERATIONAL", "uat", "")).toBe(false);
    expect(phraseMatches("OPERATIONAL", "uat", null)).toBe(false);
    expect(fullResetPhrase("uat")).toBe("FULL FACTORY RESET UAT");
    expect(phraseMatches("FULL", "uat", OPERATIONAL_PHRASE)).toBe(false);
    expect(phraseMatches("FULL", "uat", "FULL FACTORY RESET UAT")).toBe(true);
    expect(phraseMatches("FULL", "production", "FULL FACTORY RESET UAT")).toBe(false);
  });
});

describe("strict request schemas — the browser can never send a scope", () => {
  const baselines = Object.fromEntries(NUMBERING_SCOPES.map((s) => [s, String(DEFAULT_BASELINES[s])]));
  it("accepts mode + baselines only", () => {
    expect(dryRunSchema.safeParse({ mode: "OPERATIONAL", baselines }).success).toBe(true);
    expect(DEFAULT_BASELINES.OUTGOING).toBe(69);
    expect(DEFAULT_BASELINES.INCOMING).toBe(18);
    expect(DEFAULT_BASELINES.INVOICE).toBe(0);
  });
  it("rejects table lists, SQL, storage paths and any other extra field", () => {
    for (const extra of [{ tables_to_delete: ["profiles"] }, { sql: "truncate profiles" }, { storage_paths: ["settings/letterhead.png"] }, { raw_sql: "x" }]) {
      expect(dryRunSchema.safeParse({ mode: "OPERATIONAL", baselines, ...extra }).success).toBe(false);
      expect(executeSchema.safeParse({ plan_id: "0bfe144c-f0a1-40ca-8010-cf6fca5ae7d9", token: "x".repeat(40), ...extra }).success).toBe(false);
      expect(cancelSchema.safeParse({ plan_id: "0bfe144c-f0a1-40ca-8010-cf6fca5ae7d9", ...extra }).success).toBe(false);
      expect(runSchema.safeParse({ run_id: "0bfe144c-f0a1-40ca-8010-cf6fca5ae7d9", ...extra }).success).toBe(false);
    }
  });
  it("rejects an unknown numbering scope and out-of-range baselines", () => {
    expect(dryRunSchema.safeParse({ mode: "OPERATIONAL", baselines: { ...baselines, EVIL: "1" } }).success).toBe(false);
    expect(dryRunSchema.safeParse({ mode: "OPERATIONAL", baselines: { ...baselines, OUTGOING: "-1" } }).success).toBe(false);
    expect(dryRunSchema.safeParse({ mode: "OPERATIONAL", baselines: { ...baselines, OUTGOING: "1.5" } }).success).toBe(false);
    expect(dryRunSchema.safeParse({ mode: "NUKE", baselines }).success).toBe(false);
  });
  it("arming needs the backup attestation and the explicit second confirmation", () => {
    const ok = {
      plan_id: "0bfe144c-f0a1-40ca-8010-cf6fca5ae7d9", phrase: OPERATIONAL_PHRASE, second_confirm: true as const,
      backup_reference: "backup-2026-10-05", backup_timestamp: "2026-10-05T08:00:00.000Z", backup_status: "CONFIRMED_BY_ADMIN" as const,
    };
    expect(armSchema.safeParse(ok).success).toBe(true);
    expect(armSchema.safeParse({ ...ok, second_confirm: false }).success).toBe(false);
    expect(armSchema.safeParse({ ...ok, backup_status: "VERIFIED" }).success).toBe(false);
    expect(armSchema.safeParse({ ...ok, backup_reference: "ab" }).success).toBe(false);
    expect(armSchema.safeParse({ ...ok, backup_timestamp: "yesterday" }).success).toBe(false);
  });
});

describe("storage safety net", () => {
  it("branding and signatures can never be removed, whatever a list says", () => {
    expect(isPreservedStoragePath("settings/letterhead.png")).toBe(true);
    expect(isPreservedStoragePath("signatures/u1.png")).toBe(true);
    expect(isPreservedStoragePath("correspondence/x.pdf")).toBe(false);
    const { removable, refused } = splitRemovable(["correspondence/a.pdf", "settings/letterhead.png", "signatures/s.png", "payslips/p/1.pdf"]);
    expect(removable).toEqual(["correspondence/a.pdf", "payslips/p/1.pdf"]);
    expect(refused).toEqual(["settings/letterhead.png", "signatures/s.png"]);
  });
  it("refuses traversal, absolute and malformed paths", () => {
    for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", "a\\b", "a/./b", "a\0b", "x".repeat(2000)]) expect(isSafeStoragePath(bad), bad).toBe(false);
    expect(isSafeStoragePath("trade/offers/1/buyers/2/3/file.pdf")).toBe(true);
    expect(splitRemovable(["../secret"]).refused).toEqual(["../secret"]);
  });
  it("chunks without losing or duplicating items", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("maintenance lock probe", () => {
  beforeEach(() => {
    _resetMaintenanceCache();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads {locked:true}, caches for a few seconds and fails OPEN on errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ locked: true }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await isMaintenanceLocked(1000)).toBe(true);
    expect(await isMaintenanceLocked(2000)).toBe(true);     // cached
    expect(fetchMock).toHaveBeenCalledTimes(1);
    _resetMaintenanceCache();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await isMaintenanceLocked(10_000)).toBe(false);
    _resetMaintenanceCache();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await isMaintenanceLocked(20_000)).toBe(false);
  });
  it("keeps only the reset console, login and static assets reachable", () => {
    expect(allowedDuringMaintenance("/settings/system/factory-reset")).toBe(true);
    expect(allowedDuringMaintenance("/login")).toBe(true);
    expect(allowedDuringMaintenance("/correspondence/new")).toBe(false);
    expect(allowedDuringMaintenance("/api/telegram/webhook")).toBe(false);
  });
});

describe("reset report", () => {
  it("carries counts and ids only, and is COMPLETED only when every check passed", () => {
    const run = {
      id: "r1", mode: "OPERATIONAL", environment: "uat", backup_reference: "bk-1", manifest_version: 1,
      started_at: "2026-10-05T10:00:00Z", completed_at: "2026-10-05T10:01:00Z",
      counts_before: { correspondence: 5, "preserve:accounts": 40 },
      counts_deleted: { correspondence: 5, invoices: 0, _audit_rows: 12, _storage_items: 3 },
      storage_cleanup: { total: 3, done: 3, pending: 0, failed: 0 },
    };
    const scan = { preserved: 2, unknown: 1, unknown_sample: ["weird/x.bin"], delete_remaining: 0 };
    const ok = buildResetReport(run, { current_year: 1405, baselines: { OUTGOING: 69 } }, [{ key: "A", ok: true }], scan, ["UNKNOWN_STORAGE_OBJECTS_KEPT"]);
    expect(ok.final_status).toBe("COMPLETED");
    expect(ok.rows_deleted).toBe(5);
    expect(ok.audit_rows_deleted).toBe(12);
    expect(ok.rows_preserved).toEqual({ accounts: 40 });
    expect(ok.files).toMatchObject({ deleted: 3, preserved: 2, unknown: 1 });
    const bad = buildResetReport(run, { current_year: 1405, baselines: {} }, [{ key: "A", ok: true }, { key: "B", ok: false }], scan, []);
    expect(bad.final_status).toBe("FAILED");
    expect(JSON.stringify(ok)).not.toMatch(/password|secret|token|service_role/i);
  });
});
