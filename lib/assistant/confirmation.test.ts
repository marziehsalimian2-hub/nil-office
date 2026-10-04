import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPendingAction, confirmPendingAction, cancelPendingAction, isAffirmativePhrase, WRITE_EXECUTORS } from "./confirmation";
import { hashPayload } from "./security";
import { createHash } from "node:crypto";

/**
 * The Confirmation Engine against an in-memory fake of the two tables it touches. The fake also emulates the
 * 0133 immutability trigger (a claimed row can never move to another status), so the tests exercise the same
 * ordering constraint the real database enforces.
 */

type Row = Record<string, any>;

function makeDb(profiles: Row[]) {
  const tables: Record<string, Row[]> = { assistant_pending_actions: [], profiles };
  const rpcCalls: { fn: string; args: any }[] = [];
  let seq = 0;

  class Query {
    private mode: "select" | "update" | "insert" = "select";
    private filters: ((r: Row) => boolean)[] = [];
    private patch: Row = {};
    private inserted: Row | null = null;
    constructor(private table: string) {}
    select() { return this; }
    update(patch: Row) { this.mode = "update"; this.patch = patch; return this; }
    insert(row: Row) {
      this.mode = "insert";
      this.inserted = { id: `pa-${++seq}`, status: "PENDING", created_at: new Date().toISOString(), resolved_at: null, ...row };
      return this;
    }
    eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
    gt(col: string, val: string) { this.filters.push((r) => new Date(r[col]).getTime() > new Date(val).getTime()); return this; }
    private run(): { rows: Row[]; error: any } {
      const rows = tables[this.table];
      if (this.mode === "insert") { rows.push(this.inserted!); return { rows: [this.inserted!], error: null }; }
      const matched = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.mode === "update") {
        for (const r of matched) {
          if (this.table === "assistant_pending_actions" && r.status !== "PENDING" && this.patch.status && this.patch.status !== r.status) {
            return { rows: [], error: { message: "ASSISTANT_PENDING_FINAL" } };
          }
          Object.assign(r, this.patch);
        }
      }
      return { rows: matched, error: null };
    }
    single() { const { rows, error } = this.run(); return Promise.resolve(rows.length === 1 ? { data: rows[0], error } : { data: null, error: error ?? { code: "PGRST116" } }); }
    maybeSingle() { const { rows, error } = this.run(); return Promise.resolve({ data: rows[0] ?? null, error }); }
    then(resolve: (v: any) => unknown) { const { rows, error } = this.run(); return Promise.resolve({ data: rows, error }).then(resolve); }
  }

  const client = {
    from: (t: string) => new Query(t),
    rpc: (fn: string, args: any) => { rpcCalls.push({ fn, args }); return Promise.resolve({ data: null, error: null }); },
  } as unknown as SupabaseClient;

  const events = () => rpcCalls.filter((c) => c.fn === "assistant_audit").map((c) => c.args.p_event as string);
  return { client, tables, rpcCalls, events };
}

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const profile = (over: Row = {}) => ({ id: USER, role: "USER", is_active: true, ...over });

beforeAll(() => {
  process.env.ASSISTANT_PAYLOAD_SECRET = "test-secret-not-a-real-key";
});

let executed: { action: string; payload: unknown; userId: string }[];
beforeEach(() => {
  executed = [];
  for (const name of Object.keys(WRITE_EXECUTORS)) {
    WRITE_EXECUTORS[name] = vi.fn(async (payload: Record<string, unknown>, _s: SupabaseClient, userId: string) => {
      executed.push({ action: name, payload, userId });
      return { data: { id: `result-${name}` } };
    });
  }
});

const propose = (db: ReturnType<typeof makeDb>, action = "CREATE_TASK_DRAFT", payload: Record<string, unknown> = { title: "کار تست" }, userId = USER) =>
  createPendingAction(db.client, userId, action, payload, "پیش‌نمایش");

describe("proposal", () => {
  it("stores a keyed HMAC bound to user + action + payload and audits PROPOSED", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    const row = db.tables.assistant_pending_actions.find((r) => r.id === pendingActionId)!;
    expect(row.payload_hash).toBe(hashPayload({ title: "کار تست" }, USER, "CREATE_TASK_DRAFT"));
    expect(row.payload_hash).not.toBe(createHash("sha256").update(JSON.stringify({ title: "کار تست" })).digest("hex"));
    expect(db.events()).toContain("PROPOSED");
  });

  it("a newer proposal for the same action supersedes the older one", async () => {
    const db = makeDb([profile()]);
    const a = await propose(db);
    await propose(db, "CREATE_TASK_DRAFT", { title: "نسخهٔ دوم" });
    expect(db.tables.assistant_pending_actions.find((r) => r.id === a.pendingActionId)!.status).toBe("SUPERSEDED");
    const r = await confirmPendingAction(db.client, USER, a.pendingActionId);
    expect(r.ok).toBe(false);
    expect(executed).toHaveLength(0);
  });
});

describe("confirm — happy path and idempotency", () => {
  it("executes exactly once, marks CONFIRMED and audits", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    const r = await confirmPendingAction(db.client, USER, pendingActionId);
    expect(r).toMatchObject({ ok: true, actionName: "CREATE_TASK_DRAFT", resultId: "result-CREATE_TASK_DRAFT" });
    expect(executed).toHaveLength(1);
    expect(executed[0].payload).toEqual({ title: "کار تست" });
    expect(db.tables.assistant_pending_actions[0].status).toBe("CONFIRMED");
    expect(db.events()).toContain("CONFIRMED");
  });

  it("a double confirm (double tap / retry) never executes twice", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    const [a, b] = [await confirmPendingAction(db.client, USER, pendingActionId), await confirmPendingAction(db.client, USER, pendingActionId)];
    expect([a.ok, b.ok]).toEqual([true, false]);
    expect(executed).toHaveLength(1);
  });

  it("two truly concurrent confirms still execute once", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    const results = await Promise.all([confirmPendingAction(db.client, USER, pendingActionId), confirmPendingAction(db.client, USER, pendingActionId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(executed).toHaveLength(1);
  });
});

describe("confirm — ownership and expiry", () => {
  it("another user cannot confirm someone else's proposal", async () => {
    const db = makeDb([profile(), profile({ id: OTHER })]);
    const { pendingActionId } = await propose(db);
    const r = await confirmPendingAction(db.client, OTHER, pendingActionId);
    expect(r.ok).toBe(false);
    expect(executed).toHaveLength(0);
    expect(db.tables.assistant_pending_actions[0].status).toBe("PENDING");
  });

  it("an expired proposal cannot be confirmed", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    db.tables.assistant_pending_actions[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const r = await confirmPendingAction(db.client, USER, pendingActionId);
    expect(r.ok).toBe(false);
    expect(executed).toHaveLength(0);
    expect(db.events()).toContain("EXPIRED");
  });

  it("a cancelled proposal cannot be confirmed afterwards", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    expect((await cancelPendingAction(db.client, USER, pendingActionId)).ok).toBe(true);
    expect((await confirmPendingAction(db.client, USER, pendingActionId)).ok).toBe(false);
    expect(executed).toHaveLength(0);
    expect(db.events()).toContain("CANCELLED");
  });

  it("another user cannot cancel it either", async () => {
    const db = makeDb([profile(), profile({ id: OTHER })]);
    const { pendingActionId } = await propose(db);
    expect((await cancelPendingAction(db.client, OTHER, pendingActionId)).ok).toBe(false);
    expect(db.tables.assistant_pending_actions[0].status).toBe("PENDING");
  });
});

describe("confirm — payload binding (spec §39)", () => {
  it("a payload edited after proposal is rejected, cancelled, audited and never executed", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    db.tables.assistant_pending_actions[0].payload = { title: "کار دستکاری‌شده" }; // simulates bypassing the DB trigger
    const r = await confirmPendingAction(db.client, USER, pendingActionId);
    expect(r.ok).toBe(false);
    expect(executed).toHaveLength(0);
    expect(db.tables.assistant_pending_actions[0].status).toBe("CANCELLED");
    expect(db.events()).toContain("PAYLOAD_TAMPERED");
  });

  it("a hand-forged row (attacker-computed plain sha256) is rejected", async () => {
    const db = makeDb([profile()]);
    const payload = { title: "forged" };
    db.tables.assistant_pending_actions.push({
      id: "forged-1", user_id: USER, action_name: "CREATE_TASK_DRAFT", payload,
      payload_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      preview_text: "x", status: "PENDING", expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const r = await confirmPendingAction(db.client, USER, "forged-1");
    expect(r.ok).toBe(false);
    expect(executed).toHaveLength(0);
    expect(db.events()).toContain("PAYLOAD_TAMPERED");
  });

  it("a proposal re-pointed at a different action is rejected", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    db.tables.assistant_pending_actions[0].action_name = "CREATE_FOLLOWUP_DRAFT";
    expect((await confirmPendingAction(db.client, USER, pendingActionId)).ok).toBe(false);
    expect(executed).toHaveLength(0);
  });
});

describe("confirm — permission revalidation at execute time (spec §41)", () => {
  it("a user deactivated after proposing cannot execute", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    db.tables.profiles[0].is_active = false;
    const r = await confirmPendingAction(db.client, USER, pendingActionId);
    expect(r.ok).toBe(false);
    expect(executed).toHaveLength(0);
    expect(db.events()).toContain("PERMISSION_DENIED");
    expect(db.tables.assistant_pending_actions[0].status).toBe("CANCELLED");
  });

  it("a role demoted after proposing cannot execute a gated action", async () => {
    const db = makeDb([profile({ invoice_role: "CREATE" })]);
    const { pendingActionId } = await propose(db, "CREATE_INVOICE_DRAFT", { type: "INVOICE", company_id: "c", items: [] });
    db.tables.profiles[0].invoice_role = "VIEW";
    const r = await confirmPendingAction(db.client, USER, pendingActionId);
    expect(r.ok).toBe(false);
    expect(executed).toHaveLength(0);
    expect(db.events()).toContain("PERMISSION_DENIED");
  });

  it("a user who never had the tier cannot execute an injected proposal (issue needs APPROVE)", async () => {
    const db = makeDb([profile({ invoice_role: "CREATE" })]);
    const { pendingActionId } = await propose(db, "ISSUE_SALES_DOCUMENT", { sales_document_id: "d1" });
    expect((await confirmPendingAction(db.client, USER, pendingActionId)).ok).toBe(false);
    expect(executed).toHaveLength(0);
  });

  it("a still-authorised user executes a gated action", async () => {
    const db = makeDb([profile({ invoice_role: "APPROVE" })]);
    const { pendingActionId } = await propose(db, "ISSUE_SALES_DOCUMENT", { sales_document_id: "d1" });
    expect((await confirmPendingAction(db.client, USER, pendingActionId)).ok).toBe(true);
    expect(executed.map((e) => e.action)).toEqual(["ISSUE_SALES_DOCUMENT"]);
  });
});

describe("confirm — risk gating (spec §40)", () => {
  it("a bare «باشه» may confirm MEDIUM actions", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    expect((await confirmPendingAction(db.client, USER, pendingActionId, { viaPhrase: true })).ok).toBe(true);
  });

  it("a bare «باشه» can NEVER confirm a HIGH action; the button still can", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db, "FINALIZE_LETTER", { correspondence_id: "l1" });
    const viaPhrase = await confirmPendingAction(db.client, USER, pendingActionId, { viaPhrase: true });
    expect(viaPhrase.ok).toBe(false);
    if (!viaPhrase.ok) expect(viaPhrase.error).toContain("دکمه");
    expect(executed).toHaveLength(0);
    expect(db.tables.assistant_pending_actions[0].status).toBe("PENDING"); // not consumed — the button still works
    expect((await confirmPendingAction(db.client, USER, pendingActionId)).ok).toBe(true);
    expect(executed).toHaveLength(1);
  });

  it("the plain-text phrase list is deterministic", () => {
    expect(isAffirmativePhrase(" باشه ")).toBe(true);
    expect(isAffirmativePhrase("OK")).toBe(true);
    expect(isAffirmativePhrase("باشه ولی اول قیمت را عوض کن")).toBe(false);
  });
});

describe("confirm — executor failures are reported honestly", () => {
  it("an executor error is returned, audited as FAILED, and the row stays spent (no silent retry)", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    WRITE_EXECUTORS.CREATE_TASK_DRAFT = vi.fn(async () => ({ error: "شرکت یافت نشد" }));
    const r = await confirmPendingAction(db.client, USER, pendingActionId);
    expect(r).toEqual({ ok: false, error: "شرکت یافت نشد" });
    expect(db.events()).toContain("FAILED");
    expect((await confirmPendingAction(db.client, USER, pendingActionId)).ok).toBe(false);
  });

  it("an executor that throws becomes a generic message — no stack trace or internals", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db);
    WRITE_EXECUTORS.CREATE_TASK_DRAFT = vi.fn(async () => { throw new Error("duplicate key value violates constraint secret_table_pkey"); });
    const r = await confirmPendingAction(db.client, USER, pendingActionId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("secret_table_pkey");
    expect(db.events()).toContain("FAILED");
  });

  it("an unknown action name is refused without executing anything", async () => {
    const db = makeDb([profile()]);
    const { pendingActionId } = await propose(db, "DROP_ALL_TABLES", { x: 1 });
    expect((await confirmPendingAction(db.client, USER, pendingActionId)).ok).toBe(false);
    expect(executed).toHaveLength(0);
  });
});
