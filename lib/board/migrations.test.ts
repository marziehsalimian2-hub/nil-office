import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Static guards over the Board Secretariat migrations (0144-0149). There is no local database: these catch the classes of mistakes
 * this codebase has actually shipped before (restating an OLD policy body, a missing service_role grant, a bare UPDATE/DELETE under
 * pg-safeupdate, confidential rows under the generic tg_audit, INSERT arity).
 */
const DIR = join(process.cwd(), "supabase", "migrations");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const read = (f: string) => strip(readFileSync(join(DIR, f), "utf8").replace(/\r\n/g, "\n"));   // CRLF on a Windows checkout
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const board = files.filter((f) => f >= "0144" && f < "0150");
const all = board.map(read).join("\n");
const TABLES = ["board_settings", "board_members", "board_meetings", "board_agenda_items", "board_attendance", "board_resolutions", "board_audit_log"];

/** body of the newest CREATE POLICY <name> in any migration before `before` */
function latestPolicy(name: string, before: string): string {
  let body = "";
  for (const f of files.filter((x) => x < before)) {
    const s = read(f);
    for (const m of s.matchAll(new RegExp(`create policy ${name}\\b[\\s\\S]*?;`, "g"))) body = m[0];
  }
  return body;
}
const clauses = (policy: string) => policy.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("and "));

describe("board migrations (static guards)", () => {
  it("are the six expected files", () => {
    expect(board).toEqual([
      "0144_board_attach_entity.sql", "0145_board_role.sql", "0146_board_tables.sql", "0147_board_functions.sql", "0148_board_rls.sql",
      "0149_board_verify_storage_reset.sql",
    ]);
  });

  it("RLS on every board table, and service_role is granted on every one (0072 gotcha)", () => {
    for (const t of TABLES) {
      expect(all, t).toContain(`alter table public.${t}`);
      expect(all, t).toMatch(new RegExp(`enable row level security;[\\s\\S]*`));
    }
    const rls = read("0148_board_rls.sql");
    const svc = [...rls.matchAll(/grant [^;]*? on ([^;]*?) to service_role;/g)].map((m) => m[1]).join(",");
    for (const t of TABLES) expect(svc, t).toContain(`public.${t}`);
    expect(rls).not.toMatch(/grant [^;]*(insert|update|delete)[^;]* on public\.board_audit_log to authenticated/);
    expect(rls).toMatch(/revoke all on [^;]*board_audit_log from anon;/);
  });

  it("confidential board rows never go through the generic tg_audit() (activity_logs is readable by every user)", () => {
    expect(all).not.toMatch(/execute function public\.tg_audit\(\)/);
    expect(all).toContain("execute function public.tg_board_audit()");
    expect(all).toContain("BOARD_AUDIT_APPEND_ONLY");
  });

  it("no UPDATE/DELETE without WHERE (Supabase pg-safeupdate)", () => {
    const bare: string[] = [];
    for (const m of all.matchAll(/(^|[\s;(])(update\s+public\.\w+(?:\s+\w+)?\s+set|delete\s+from\s+public\.\w+)\s[^;]*;/gi)) {
      if (!/\swhere\s/i.test(m[0])) bare.push(m[0].trim().slice(0, 100));
    }
    expect(bare).toEqual([]);
  });

  it("the approval RPC is the only path to APPROVED, numbers are continuous and issued under a lock", () => {
    const fn = read("0147_board_functions.sql");
    expect(fn).toContain("can_approve_board()");
    expect(fn).toContain("pg_advisory_xact_lock(hashtext('board_meeting_number'))");
    expect(fn).toMatch(/greatest\(coalesce\(max\(x\.meeting_number\), 0\), coalesce\(v_base, 0\)\) \+ 1/);
    expect(fn).toContain("set_config('nil.board_approve', 'on', true)");
    expect(fn).toContain("set_config('nil.board_approve', 'off', true)");
    for (const code of ["BOARD_APPROVE_MISSING_FIELDS", "BOARD_APPROVE_NO_AGENDA", "BOARD_APPROVE_NO_DISCUSSION", "BOARD_APPROVE_ATTENDANCE_INCOMPLETE", "BOARD_APPROVE_OFFICIALS_ABSENT", "BOARD_RESOLUTION_DUE_BEFORE_MEETING"]) {
      expect(fn, code).toContain(code);
    }
    expect(fn).toContain("foreach f in array array['_board_minutes_snapshot(uuid)', '_board_log(uuid,text,uuid,text,jsonb)'] loop");
    expect(fn).toContain("execute format('revoke all on function public.%s from public, anon, authenticated', f);");
    const tables = read("0146_board_tables.sql");
    expect(tables).toContain("BOARD_MEETING_LOCKED");
    expect(tables).toContain("BOARD_APPROVAL_RPC_ONLY");
    expect(tables).toMatch(/\(to_jsonb\(new\) - 'follow_status' - 'updated_at'\) = \(to_jsonb\(old\) - 'follow_status' - 'updated_at'\)/);
  });

  it("p_profiles_update_self keeps EVERY earlier role frozen and adds board_role", () => {
    const prev = latestPolicy("p_profiles_update_self", "0145");
    const now = latestPolicy("p_profiles_update_self", "0150");
    for (const c of clauses(prev)) expect(now, c).toContain(c);
    expect(now).toMatch(/and board_role\s+is not distinct from \(select board_role\s+from public\.profiles where id = auth\.uid\(\)\)/);
  });

  it("attachments + storage policies restate their CURRENT bodies (no earlier carve-out silently dropped)", () => {
    for (const p of ["p_attach_read", "p_attach_write", "p_attach_delete", "p_storage_read", "p_storage_insert", "p_storage_update", "p_storage_delete"]) {
      const prev = latestPolicy(p, "0144");
      const now = latestPolicy(p, "0150");
      expect(prev, p).not.toBe("");
      for (const c of clauses(prev)) expect(now, `${p}: ${c}`).toContain(c.replace(/\s+--.*$/, ""));
    }
    expect(latestPolicy("p_attach_read", "0150")).toContain("entity_type <> 'BOARD_MEETING' or public.has_board_access()");
    expect(latestPolicy("p_storage_read", "0150")).toContain("name not like 'verified/%' or public.has_board_access() or not public._board_is_minutes_file(name)");
  });

  it("NIL Verify: board minutes disclose ONLY the meeting number and date publicly", () => {
    const v = read("0149_board_verify_storage_reset.sql");
    const branch = v.slice(v.indexOf("elsif p_type = 'BOARD_MINUTES' then\n    select * into bm"), v.indexOf("raise exception 'VERIFY_INVALID' using errcode = '22000';\nend; $$;"));
    expect(branch).toContain("'meeting_date'");
    for (const forbidden of ["snapshot", "attendance", "agenda", "resolution", "general_notes", "invitees", "board_members", "location"]) {
      expect(branch, forbidden).not.toContain(forbidden);
    }
    // the other three gates/snapshots are restated unchanged
    const orig = read("0143_nil_verify.sql");
    for (const piece of ["if not public.can_approve_invoice()", "if not public.can_approve_contract()", "if v_s.show_contract_amount then", "'counterparty', (select co.legal_name"]) {
      expect(orig).toContain(piece);
      expect(v).toContain(piece);
    }
  });

  it("every INSERT ... VALUES row has as many expressions as target columns", () => {
    for (const ins of all.matchAll(/insert into public\.(\w+)\s*\(([^)]*)\)\s*values\s*([\s\S]*?)(?:\bon conflict\b|returning|;)/gi)) {
      const cols = ins[2].split(",").map((c) => c.trim()).filter(Boolean).length;
      const body = ins[3];
      let depth = 0, inStr = false, cur = "";
      const tuples: string[] = [];
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (inStr) { cur += ch; if (ch === "'") { if (body[i + 1] === "'") { cur += "'"; i++; } else inStr = false; } continue; }
        if (ch === "'") { inStr = true; cur += ch; continue; }
        if (ch === "(") { depth++; if (depth === 1) { cur = ""; continue; } }
        if (ch === ")") { depth--; if (depth === 0) { tuples.push(cur); cur = ""; continue; } }
        if (depth >= 1) cur += ch;
      }
      for (const tup of tuples) {
        let d = 0, q = false, n = 1;
        for (let i = 0; i < tup.length; i++) {
          const ch = tup[i];
          if (q) { if (ch === "'") { if (tup[i + 1] === "'") i++; else q = false; } continue; }
          if (ch === "'") q = true; else if (ch === "(") d++; else if (ch === ")") d--; else if (ch === "," && d === 0) n++;
        }
        expect(n, `${ins[1]}: ${tup.slice(0, 50)}`).toBe(cols);
      }
    }
  });
});

describe("0150 board follow-up (static guards)", () => {
  const sql = read("0150_board_followup.sql");
  const NEW = ["board_resolution_updates", "board_resolution_files", "board_telegram_links", "board_link_tokens", "board_notifications", "board_bot_updates", "board_bot_state"];

  it("RLS on every new table; service_role granted; no browser write path", () => {
    for (const t of NEW) expect(sql, t).toContain(`alter table public.${t}`);
    const svc = [...sql.matchAll(/grant [^;]*? on ([^;]*?) to service_role;/g)].map((m) => m[1]).join(",");
    for (const t of NEW) expect(svc, t).toContain(`public.${t}`);
    // privilege list = the words between «grant» and «on» (a table NAME such as board_resolution_updates must not count)
    expect(sql).not.toMatch(/grant\s+[a-z, ]*\b(insert|update|delete)\b[a-z, ]*\s+on\s[^;]*to authenticated/i);
    expect(sql).not.toMatch(/create policy [^;]* for (insert|update|delete|all)/i);
  });
  it("bot / cron functions are service_role only", () => {
    const serviceOnly = sql.match(/foreach f in array array\[\s*([^\]]*)\]\s*loop\s*execute format\('revoke all on function public\.%s from public, anon, authenticated'/);
    for (const fn of ["board_member_report_progress", "board_consume_link_token", "board_enqueue_reminders", "board_claim_notifications", "_board_apply_followup", "_board_enqueue"]) {
      expect(serviceOnly?.[1], fn).toContain(fn);
    }
  });
  it("tokens: only a SHA-256 column, never the raw token", () => {
    expect(sql).toMatch(/token_hash\s+text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).not.toMatch(/\btoken\s+text\b/);
  });
  it("the restated child guard keeps every earlier rule and adds the follow-up flag", () => {
    for (const piece of ["BOARD_FIELD_IMMUTABLE", "BOARD_APPROVAL_RPC_ONLY", "BOARD_MEETING_LOCKED", "nil.board_approve", "(to_jsonb(new) - 'follow_status' - 'updated_at') = (to_jsonb(old) - 'follow_status' - 'updated_at')"]) {
      expect(sql, piece).toContain(piece);
    }
    expect(sql).toContain("current_setting('nil.board_follow', true)");
    expect(sql).toContain("BOARD_FOLLOWUP_RPC_ONLY");
  });
  it("closing / reopening needs the APPROVE tier; members can only report on resolutions they own", () => {
    const close = sql.slice(sql.indexOf("function public.board_close_resolution("));
    expect(close.slice(0, 400)).toContain("can_approve_board()");
    const member = sql.slice(sql.indexOf("function public.board_member_report_progress("));
    expect(member.slice(0, 900)).toContain("r.owner_member_id = p_member");
    expect(member.slice(0, 900)).toContain("board_telegram_links");
  });
  it("no UPDATE/DELETE without WHERE (Supabase pg-safeupdate)", () => {
    const bare: string[] = [];
    for (const m of sql.matchAll(/(^|[\s;(])(update\s+public\.\w+(?:\s+\w+)?\s+set|delete\s+from\s+public\.\w+)\s[^;]*;/gi)) {
      if (!/\swhere\s/i.test(m[0])) bare.push(m[0].trim().slice(0, 100));
    }
    expect(bare).toEqual([]);
  });
});
