import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OPERATIONAL_PHRASE } from "./phrases";
import { NUMBERING_SCOPES } from "./schemas";

/**
 * Static guards over the migrations (the actual schema = source of truth). They make the manifest impossible to forget:
 * a table added by any later migration without a manifest row fails this test, and so does a destructive-looking shortcut.
 */
const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const sql = (f: string) => readFileSync(join(DIR, f), "utf8");
const all = files.map((f) => ({ f, s: strip(sql(f)) }));
const reset = strip(sql("0141_factory_reset.sql"));

function createdTables(): Set<string> {
  const out = new Set<string>();
  for (const { s } of all) for (const m of s.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/gi)) out.add(m[1]);
  return out;
}

type Row = { name: string; cls: string; a: string; b: string };
// Every migration from 0141 on may add manifest rows (a new module classifies its own tables in the migration that creates them);
// a later row for the same object wins, like the `on conflict do update` in SQL.
function manifest(): Row[] {
  const byName = new Map<string, Row>();
  for (const { f, s } of all) {
    if (f < "0141") continue;
    for (const ins of s.matchAll(/insert into public\.system_reset_manifest[\s\S]*?on conflict \(object_name\)/g)) {
      for (const m of ins[0].matchAll(/\('([a-z_0-9]+)',\s+'([a-z_]+)',\s+'(DELETE|PRESERVE|CONDITIONAL|NEVER_TOUCH)',\s+'([A-Z_]+)',\s+'([A-Z_]+)',/g)) {
        byName.set(m[1], { name: m[1], cls: m[3], a: m[4], b: m[5] });
      }
    }
  }
  return [...byName.values()];
}

function fkEdges(): [string, string][] {
  const edges: [string, string][] = [];
  for (const { s } of all) {
    for (const m of s.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\((.*?)\n\);/gis))
      for (const r of m[2].matchAll(/references\s+(?:public\.)?(\w+)/gi)) edges.push([m[1], r[1]]);
    for (const m of s.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column(?: if not exists)?[^;]*?references\s+(?:public\.)?(\w+)/gis)) edges.push([m[1], m[2]]);
    for (const m of s.matchAll(/alter table public\.(\w+)\s+add constraint[^;]*?foreign key[^;]*?references\s+(?:public\.)?(\w+)/gis)) edges.push([m[1], m[2]]);
  }
  return edges;
}

describe("reset manifest vs the actual schema", () => {
  const rows = manifest();
  const names = rows.map((r) => r.name);

  it("classifies EVERY table created by any migration — nothing is UNKNOWN", () => {
    const created = createdTables();
    expect([...created].filter((t) => !names.includes(t)), "tables missing from the reset manifest (add them to 0141 or a newer migration)").toEqual([]);
    expect(names.filter((n) => !created.has(n)), "manifest rows that are not tables").toEqual([]);
    expect(new Set(names).size).toBe(names.length);
    expect(rows.length).toBeGreaterThanOrEqual(117);
  });

  it("classification and mode agree", () => {
    for (const r of rows) {
      if (r.cls === "DELETE") expect(r.a, r.name).toBe("DELETE");
      if (r.cls === "PRESERVE") expect(r.a, r.name).toBe("PRESERVE");
      if (r.cls === "NEVER_TOUCH") expect([r.a, r.b], r.name).toEqual(["NEVER", "NEVER"]);
    }
  });

  it("the things that must survive are never in the delete set (mode A)", () => {
    const del = new Set(rows.filter((r) => r.a === "DELETE" || r.a === "TRUNCATE_KEEP").map((r) => r.name));
    for (const keep of [
      "profiles", "app_settings", "accounts", "fiscal_years", "bank_accounts", "number_sequences", "accounting_sequences", "activity_logs",
      "crm_pipelines", "crm_pipeline_stages", "contract_types", "service_categories", "cheque_print_templates", "cheque_print_template_fields",
      "salary_components", "salary_component_versions", "legal_rule_sets", "legal_rule_entries", "payroll_accounting_settings", "payroll_component_accounts",
      "assistant_channel_identities", "cheque_status_transitions", "personnel_status_transitions", "legal_rule_set_transitions", "payroll_batch_transitions",
      "system_reset_runs", "system_reset_run_events", "system_reset_plans", "system_reset_manifest", "system_reset_grants", "system_maintenance",
    ]) expect(del.has(keep), keep).toBe(false);
    for (const gone of ["journal_entries", "journal_entry_lines", "correspondence", "companies", "sales_documents", "personnel", "payroll_payslips", "cheques", "trade_offers", "assistant_pending_actions", "external_intakes", "attachments"])
      expect(del.has(gone), gone).toBe(true);
  });

  it("no table OUTSIDE the truncate set holds a foreign key to a table INSIDE it (TRUNCATE would fail) — mode A and mode B", () => {
    for (const idx of ["a", "b"] as const) {
      const set = new Set(rows.filter((r) => r[idx] === "DELETE" || r[idx] === "TRUNCATE_KEEP").map((r) => r.name));
      const blockers = fkEdges().filter(([from, to]) => set.has(to) && !set.has(from) && from !== to);
      expect(blockers, `mode ${idx}`).toEqual([]);
    }
  });
});

describe("reset migration safety", () => {
  it("never uses CASCADE, trigger disabling or replica mode", () => {
    expect(reset).not.toMatch(/truncate[^;]*cascade/i);       // (an FK "on delete cascade" on the permission table is unrelated to TRUNCATE)
    expect(reset).not.toMatch(/restart identity/i);
    expect(reset).not.toMatch(/session_replication_role/i);
    expect(reset).not.toMatch(/disable trigger/i);
    expect(reset).not.toMatch(/drop table|drop schema|delete from public\.(profiles|accounts|app_settings|fiscal_years)/i);
  });
  it("destructive functions are granted to service_role only; the lock probe is the single public function", () => {
    const grants = [...reset.matchAll(/grant\s+[^;]*?\s+to\s+([^;]+);/gi)].map((m) => m[1].trim().replace(/',\s*f\)$/, ""));
    const nonService = grants.filter((g) => g !== "service_role" && g !== "anon, authenticated, service_role");
    expect(nonService).toEqual([]);
    expect(reset).toMatch(/revoke all on function public\.system_maintenance_status\(\) from public;\s*grant execute on function public\.system_maintenance_status\(\) to anon, authenticated, service_role;/);
    expect(reset).toMatch(/revoke all on public\.system_reset_grants[\s\S]*?from public, anon, authenticated;/);
    // no browser-reachable path to the permission table
    expect(reset).not.toMatch(/create policy/i);
  });
  it("the typed phrase is enforced inside the database and matches the UI", () => {
    expect(reset).toContain(`'${OPERATIONAL_PHRASE}'`);
  });
  it("nothing is granted to anyone by the migration (permission is a deliberate manual grant)", () => {
    expect(reset).not.toMatch(/insert into public\.system_reset_grants/i);
  });
  it("TS numbering scopes match the database CHECK and the reset parameter allow-list", () => {
    const m118 = strip(sql("0118_payroll_numbering.sql")).match(/check \(scope in \(([^)]*)\)\)/i);
    const dbScopes = [...(m118?.[1] ?? "").matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
    expect([...NUMBERING_SCOPES].sort()).toEqual([...dbScopes].sort());
    const allow = [...(reset.match(/c_scopes text\[\] := array\[([^\]]*)\]/)?.[1] ?? "").matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
    expect([...allow].sort()).toEqual([...NUMBERING_SCOPES].sort());
  });
  it("the audit purge keeps security / system rows: those entity types are not in the delete aliases", () => {
    const aliases = [...(reset.match(/union select 'receipt' union select 'payment' union select 'journal_entry'/) ?? [])];
    expect(aliases.length).toBe(1);
    for (const keep of ["assistant", "system_reset", "number_sequences", "profiles", "fiscal_year"]) expect(reset).not.toMatch(new RegExp(`union select '${keep}'`));
  });
});

describe("Supabase pg-safeupdate", () => {
  it("every UPDATE / DELETE in the reset migrations has a WHERE clause (the API role refuses a bare one)", () => {
    for (const f of ["0141_factory_reset.sql", "0142_factory_reset_safeupdate_fix.sql"]) {
      let src = strip(sql(f));
      // 0141's system_reset_execute_db had a bare UPDATE (aborted the DB phase on first use); 0142 replaces that function — judge the CURRENT body only
      if (f.startsWith("0141")) {
        const a = src.indexOf("create or replace function public.system_reset_execute_db(");
        const b = src.indexOf("create or replace function public.system_reset_storage_pending(");
        expect(a).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(a);
        src = src.slice(0, a) + src.slice(b);
      }
      const bare: string[] = [];
      for (const m of src.matchAll(/(^|[\s;(])(update\s+public\.\w+(?:\s+\w+)?\s+set|delete\s+from\s+public\.\w+)\s[^;]*;/gi)) {
        if (!/\swhere\s/i.test(m[0])) bare.push(m[0].trim().slice(0, 100));
      }
      expect(bare, f).toEqual([]);
    }
  });
});

describe("storage rules", () => {
  const rules = all.filter(({ f }) => f >= "0141").flatMap(({ s }) => [...s.matchAll(/\('([a-z_/-]+\/)',\s+'(DELETE|PRESERVE)',/g)].map((m) => ({ prefix: m[1], action: m[2] })));
  it("branding and signatures are preserved", () => {
    expect(rules.find((r) => r.prefix === "settings/")?.action).toBe("PRESERVE");
    expect(rules.find((r) => r.prefix === "signatures/")?.action).toBe("PRESERVE");
  });
  it("every attachment entity prefix and every generated-file prefix used by the app has a DELETE rule", () => {
    const entities = new Set<string>();
    for (const { s } of all) {
      for (const m of s.matchAll(/create type (?:public\.)?attach_entity\s+as enum \(([^)]*)\)/gi)) for (const v of m[1].matchAll(/'([A-Z_]+)'/g)) entities.add(v[1]);
      for (const m of s.matchAll(/alter type (?:public\.)?attach_entity add value if not exists '([A-Z_]+)'/gi)) entities.add(m[1]);
    }
    expect(entities.size).toBeGreaterThanOrEqual(15);
    const del = new Set(rules.filter((r) => r.action === "DELETE").map((r) => r.prefix));
    for (const e of entities) expect(del.has(`${e.toLowerCase()}/`), `attachment prefix ${e.toLowerCase()}/`).toBe(true);
    for (const p of ["cash-evidence/", "payslips/", "client-service-reports/", "trade/", "external-correspondence/", "correspondence/"]) expect(del.has(p), p).toBe(true);
  });
});

describe("0142 replaces the DB phase with a WHERE on every UPDATE", () => {
  it("restates system_reset_execute_db and keeps the single-TRUNCATE design", () => {
    const fix = strip(sql("0142_factory_reset_safeupdate_fix.sql"));
    expect(fix).toContain("create or replace function public.system_reset_execute_db(");
    expect(fix).toMatch(/update public\.accounting_sequences set last_value = 0, updated_at = now\(\) where last_value >= 0;/);
    expect(fix).not.toMatch(/truncate[^;]*cascade/i);
    expect(fix).not.toMatch(/session_replication_role|disable trigger/i);
    expect(fix).toContain("lock table");
  });
});
