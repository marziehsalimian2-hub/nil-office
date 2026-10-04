import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The core calls revalidatePath; outside a Next request that throws, so stub the Next-only modules.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createCashDraftCore, type CashDraftPayload } from "@/app/actions/accounting";
import { sha256Hex } from "./cashDraft";

type Call = { op: string; table?: string; row?: Record<string, unknown>; fn?: string; path?: string };

function fakeSupabase(opts: {
  profile?: Record<string, unknown> | null;
  dup?: { hard: unknown[]; soft: unknown[] } | null;
  dupError?: boolean;
  uploadError?: boolean;
  insertError?: string;
}) {
  const calls: Call[] = [];
  const profile = opts.profile === undefined ? { role: "USER", accounting_role: "CREATE", is_active: true } : opts.profile;
  const client = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: table === "profiles" ? profile : null, error: null }),
        single: () => Promise.resolve(opts.insertError ? { data: null, error: { message: opts.insertError } } : { data: { id: "new-id" }, error: null }),
        insert: (row: Record<string, unknown>) => { calls.push({ op: "insert", table, row }); return chain; },
        delete: () => { calls.push({ op: "delete", table }); return chain; },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    },
    rpc(fn: string) {
      calls.push({ op: "rpc", fn });
      if (opts.dupError) return Promise.resolve({ data: null, error: { message: "boom" } });
      return Promise.resolve({ data: opts.dup === undefined ? { hard: [], soft: [] } : opts.dup, error: null });
    },
    storage: {
      from: () => ({
        upload: (path: string) => { calls.push({ op: "upload", path }); return Promise.resolve({ error: opts.uploadError ? { message: "storage down" } : null }); },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const USER = "11111111-1111-4111-8111-111111111111";
const payload = (over: Partial<CashDraftPayload> = {}): CashDraftPayload => ({
  kind: "RECEIPT", amount: "100000000", currency: "IRR", date: new Date().toISOString().slice(0, 10), counterparty: "شرکت الف",
  company_id: null, contract_id: null, bank_account_id: null, fiscal_year_id: null, method: "TRANSFER", reference: "TRK-1",
  description: null, confirmed_not_duplicate: false, evidence_base64: null, evidence_mime: null, evidence_sha256: null, ...over,
});

const HARD = { kind: "RECEIPT", id: "r0", status: "DRAFT", display_number: null, date: "2026-10-01", amount: "100000000", currency: "IRR", counterparty: "شرکت الف", reason: "SAME_REFERENCE" };

let calls: Call[];
beforeEach(() => { calls = []; });

describe("createCashDraftCore — draft only", () => {
  it("inserts a DRAFT with no counterpart account, an exact string amount and created_by = the user", async () => {
    const f = fakeSupabase({});
    const r = await createCashDraftCore(f.client, USER, payload());
    expect(r).toEqual({ data: { id: "new-id" } });
    const ins = f.calls.find((c) => c.op === "insert" && c.table === "receipts")!;
    expect(ins.row).toMatchObject({ status: "DRAFT", amount: "100000000", currency_code: "IRR", counterpart_account_id: null, created_by: USER, payer: "شرکت الف" });
    expect(ins.row).not.toHaveProperty("journal_entry_id");
    expect(ins.row).not.toHaveProperty("verified_at");
  });

  it("a payment goes to payments with payee / payment_date", async () => {
    const f = fakeSupabase({});
    await createCashDraftCore(f.client, USER, payload({ kind: "PAYMENT" }));
    const ins = f.calls.find((c) => c.op === "insert")!;
    expect(ins.table).toBe("payments");
    expect(ins.row).toHaveProperty("payee", "شرکت الف");
    expect(ins.row).toHaveProperty("payment_date");
  });

  it("only ever calls the duplicate-lookup RPC — never verify / post / allocate", async () => {
    const f = fakeSupabase({});
    await createCashDraftCore(f.client, USER, payload());
    const rpcs = f.calls.filter((c) => c.op === "rpc").map((c) => c.fn);
    expect(rpcs).toEqual(["assistant_cash_duplicates"]);
    for (const fn of rpcs) expect(fn).not.toMatch(/post_|verify_|allocation|journal/i);
  });
});

describe("createCashDraftCore — validation at execute time (the payload is model-derived)", () => {
  it("refuses an ambiguous amount, a zero amount and a future date", async () => {
    for (const p of [payload({ amount: "1.500.000" }), payload({ amount: "0" }), payload({ date: "2999-01-01" }), payload({ kind: "OTHER" as never })]) {
      const f = fakeSupabase({});
      const r = await createCashDraftCore(f.client, USER, p);
      expect(r, JSON.stringify(p)).toHaveProperty("error");
      expect(f.calls.some((c) => c.op === "insert")).toBe(false);
    }
  });

  it("refuses a user without accounting CREATE access (revoked after the proposal)", async () => {
    for (const profile of [{ role: "USER", accounting_role: "VIEW", is_active: true }, { role: "USER", accounting_role: null, is_active: true }, { role: "ADMIN", accounting_role: null, is_active: false }, null]) {
      const f = fakeSupabase({ profile });
      const r = await createCashDraftCore(f.client, USER, payload());
      expect(r).toHaveProperty("error");
      expect(f.calls.some((c) => c.op === "insert")).toBe(false);
    }
  });

  it("an ADMIN may create", async () => {
    const f = fakeSupabase({ profile: { role: "ADMIN", accounting_role: null, is_active: true } });
    expect(await createCashDraftCore(f.client, USER, payload())).toHaveProperty("data");
  });
});

describe("createCashDraftCore — duplicates", () => {
  it("a HARD duplicate without the explicit flag is refused and nothing is inserted", async () => {
    const f = fakeSupabase({ dup: { hard: [HARD], soft: [] } });
    const r = await createCashDraftCore(f.client, USER, payload());
    expect(r).toHaveProperty("error");
    expect(f.calls.some((c) => c.op === "insert")).toBe(false);
  });
  it("with confirmed_not_duplicate the same case goes through", async () => {
    const f = fakeSupabase({ dup: { hard: [HARD], soft: [] } });
    expect(await createCashDraftCore(f.client, USER, payload({ confirmed_not_duplicate: true }))).toHaveProperty("data");
  });
  it("SOFT matches never block", async () => {
    const f = fakeSupabase({ dup: { hard: [], soft: [{ ...HARD, reason: "SAME_DAY_AMOUNT" }] } });
    expect(await createCashDraftCore(f.client, USER, payload())).toHaveProperty("data");
  });
  it("fails CLOSED when the duplicate lookup itself fails", async () => {
    const f = fakeSupabase({ dupError: true });
    const r = await createCashDraftCore(f.client, USER, payload());
    expect(r).toHaveProperty("error");
    expect(f.calls.some((c) => c.op === "insert")).toBe(false);
  });
});

describe("createCashDraftCore — evidence", () => {
  const bytes = Buffer.from("%PDF-1.4 fake receipt");
  const evidence = { evidence_base64: bytes.toString("base64"), evidence_mime: "application/pdf", evidence_sha256: sha256Hex(bytes) };

  it("archives the file privately with its hash and links it to the draft", async () => {
    const f = fakeSupabase({});
    expect(await createCashDraftCore(f.client, USER, payload(evidence))).toEqual({ data: { id: "new-id" } });
    const up = f.calls.find((c) => c.op === "upload")!;
    expect(up.path).toMatch(/^cash-evidence\/receipt\/new-id\/\d+\.pdf$/);
    const att = f.calls.find((c) => c.op === "insert" && c.table === "attachments")!;
    expect(att.row).toMatchObject({ entity_type: "RECEIPT", entity_id: "new-id", mime_type: "application/pdf", sha256: evidence.evidence_sha256, uploaded_by: USER });
  });

  it("a tampered file (hash mismatch) is refused before anything is inserted", async () => {
    const f = fakeSupabase({});
    const r = await createCashDraftCore(f.client, USER, payload({ ...evidence, evidence_base64: Buffer.from("something else").toString("base64") }));
    expect(r).toHaveProperty("error");
    expect(f.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("an unsupported MIME type is refused", async () => {
    const f = fakeSupabase({});
    expect(await createCashDraftCore(f.client, USER, payload({ ...evidence, evidence_mime: "application/x-msdownload" }))).toHaveProperty("error");
  });

  it("if the evidence cannot be archived the draft is rolled back — no draft without its evidence", async () => {
    const f = fakeSupabase({ uploadError: true });
    const r = await createCashDraftCore(f.client, USER, payload(evidence));
    expect(r).toHaveProperty("error");
    expect(f.calls.some((c) => c.op === "delete" && c.table === "receipts")).toBe(true);
  });

  it("a voice/text draft (no file) archives nothing", async () => {
    const f = fakeSupabase({});
    await createCashDraftCore(f.client, USER, payload());
    expect(f.calls.some((c) => c.op === "upload")).toBe(false);
  });
});
