import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Static guards over 0151 (assistant suggestions) and over the assistant code's "suggest only" contract. */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/0151_board_ai_drafts.sql").replace(/--[^\n]*/g, "");

describe("0151 board assistant (static guards)", () => {
  it("RLS on, service_role granted, the browser cannot delete or insert a TELEGRAM / foreign suggestion", () => {
    expect(sql).toContain("alter table public.board_ai_drafts enable row level security");
    expect(sql).toMatch(/grant select, insert, update, delete on public\.board_ai_drafts to service_role;/);
    expect(sql).toMatch(/grant select, insert, update on public\.board_ai_drafts to authenticated;/);
    expect(sql).toMatch(/with check \(public\.can_create_board\(\) and source = 'WEB' and created_by = auth\.uid\(\) and status = 'PENDING'\)/);
  });
  it("a suggestion is immutable; apply needs CREATE, a PENDING suggestion and a DRAFT meeting", () => {
    expect(sql).toContain("BOARD_AI_DRAFT_IMMUTABLE");
    const apply = sql.slice(sql.indexOf("function public.board_apply_ai_draft("));
    expect(apply.slice(0, 1500)).toContain("can_create_board()");
    expect(apply.slice(0, 1500)).toContain("d.status <> 'PENDING'");
    expect(apply.slice(0, 1500)).toContain("m.status <> 'DRAFT'");
    expect(apply).toContain("for update");
  });
  it("the bot drafter check is service_role only and requires a linked profile with the CREATE tier", () => {
    expect(sql).toMatch(/revoke all on function public\.board_member_drafter_profile\(uuid\) from public, anon, authenticated;/);
    const fn = sql.slice(sql.indexOf("function public.board_member_drafter_profile("), sql.indexOf("$$;", sql.indexOf("function public.board_member_drafter_profile(")));
    expect(fn).toContain("board_telegram_links");
    expect(fn).toContain("p.board_role in ('CREATE', 'APPROVE', 'ADMIN')");
  });
  it("no UPDATE/DELETE without WHERE (Supabase pg-safeupdate)", () => {
    const bare: string[] = [];
    for (const m of sql.matchAll(/(^|[\s;(])(update\s+public\.\w+(?:\s+\w+)?\s+set|delete\s+from\s+public\.\w+)\s[^;]*;/gi)) {
      if (!/\swhere\s/i.test(m[0])) bare.push(m[0].trim().slice(0, 100));
    }
    expect(bare).toEqual([]);
  });
});

describe("assistant code: suggest only", () => {
  const draft = read("lib/board/assistant/draft.ts");
  const actions = read("app/actions/board-assistant.ts");
  const bot = read("lib/board/telegram/handleUpdate.ts");
  it("the drafting code never writes the minutes or approves anything", () => {
    for (const forbidden of ["board_approve_meeting", "board_resolutions\").insert", "board_agenda_items\").insert", "board_close_resolution"]) {
      expect(draft, forbidden).not.toContain(forbidden);
      expect(bot, forbidden).not.toContain(forbidden);
    }
    expect(actions).not.toContain("board_approve_meeting");
  });
  it("one forced tool call, notes passed as data, a token cap applied", () => {
    expect(draft).toContain("forceTool: TOOL.name");
    expect(draft).toContain("<notes>");
    expect(draft).toContain("evaluateCaps(");
    expect(draft).toContain("normalizeDraft(");
  });
  it("apply never trusts item content from the browser — it rebuilds from the stored suggestion", () => {
    expect(actions).toContain('.select("id, meeting_id, status, suggestion")');
    expect(actions).not.toMatch(/f\.get\(`agenda_\$\{a\.key\}_discussion`\)/);
  });
  it("the bot refuses audio and only drafters see / use the notes flow", () => {
    expect(bot).toContain("msg.voice || msg.audio || msg.video_note");
    expect(bot.match(/drafterProfile\(service, member\.id\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
