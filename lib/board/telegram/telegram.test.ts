import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLinkUrl, generateLinkToken, hashLinkToken, LINK_TOKEN_RE, parseStartToken, safeEqual, verifyBoardCronSecret, verifyBoardWebhookSecret } from "./security";
import {
  MAIN_MENU, minutesKeyboard, myResolutionsKeyboard, notificationText, parseCallback, resolutionActionsKeyboard, resolutionDetailText, type ResRow,
} from "./messages";

const ID = "6f1c0a52-8b0e-4bfe-9a49-2d0d2b6d1a11";
const res: ResRow = { id: ID, resolution_number: "12-3", text: "تهیهٔ گزارش مالی", due_date: "2026-10-30", expected_output: "فایل گزارش", follow_status: "IN_PROGRESS" };

describe("link tokens", () => {
  it("are 256-bit base64url, unique, fit a /start payload, and only the SHA-256 is derived for storage", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = generateLinkToken();
      expect(LINK_TOKEN_RE.test(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(100);
    expect(hashLinkToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkToken("abc")).toBe(hashLinkToken("abc"));
  });
  it("deep link only with a valid bot username", () => {
    const t = generateLinkToken();
    expect(buildLinkUrl(t, "@NilBoard_bot")).toBe(`https://t.me/NilBoard_bot?start=${t}`);
    expect(buildLinkUrl(t, "")).toBeNull();
    expect(buildLinkUrl(t, "bad name")).toBeNull();
    expect(buildLinkUrl("short", "NilBoard_bot")).toBeNull();
  });
  it("/start parsing is exact", () => {
    const t = generateLinkToken();
    expect(parseStartToken(`/start ${t}`)).toBe(t);
    expect(parseStartToken("/start")).toBeNull();
    expect(parseStartToken(`/start ${t} extra`)).toBeNull();
    expect(parseStartToken(`hello /start ${t}`)).toBeNull();
  });
});

describe("secrets", () => {
  const env = { ...process.env };
  beforeEach(() => { process.env.BOARD_TELEGRAM_WEBHOOK_SECRET = "w".repeat(32); process.env.BOARD_CRON_SECRET = "c".repeat(32); });
  afterEach(() => { process.env = { ...env }; });
  it("constant-time compare, refuses missing / short configuration", () => {
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(verifyBoardWebhookSecret("w".repeat(32))).toBe(true);
    expect(verifyBoardWebhookSecret("w".repeat(31))).toBe(false);
    expect(verifyBoardWebhookSecret(null)).toBe(false);
    expect(verifyBoardCronSecret("c".repeat(32))).toBe(true);
    process.env.BOARD_CRON_SECRET = "short";
    expect(verifyBoardCronSecret("short")).toBe(false);
    delete process.env.BOARD_TELEGRAM_WEBHOOK_SECRET;
    expect(verifyBoardWebhookSecret("anything")).toBe(false);
  });
});

describe("callbacks", () => {
  it("strict parser: only known shapes, uuids and the three report statuses", () => {
    expect(parseCallback("my")).toEqual({ t: "my" });
    expect(parseCallback(`res:${ID}`)).toEqual({ t: "res", id: ID });
    expect(parseCallback(`min:${ID}`)).toEqual({ t: "min", id: ID });
    expect(parseCallback(`st:${ID}:PENDING_REVIEW`)).toEqual({ t: "st", id: ID, status: "PENDING_REVIEW" });
    for (const bad of [`st:${ID}:DONE`, `res:${ID}x`, "res:1 or 1=1", `res:${ID.toUpperCase()}`, "", undefined, "admin", `st:${ID}:IN_PROGRESS:x`]) {
      expect(parseCallback(bad as string)).toBeNull();
    }
  });
  it("every callback_data fits Telegram's 64-byte limit", () => {
    const all = [
      ...MAIN_MENU, ...myResolutionsKeyboard([res]), ...resolutionActionsKeyboard(ID),
      ...minutesKeyboard([{ id: ID, meeting_number: 12, scheduled_at: "2026-10-20T06:00:00Z" }]),
    ].flat();
    for (const b of all) expect(Buffer.byteLength(b.callback_data), b.callback_data).toBeLessThanOrEqual(64);
    // a member cannot pick DONE from the bot — closing is the secretary's decision
    expect(resolutionActionsKeyboard(ID).flat().map((b) => b.callback_data)).not.toContain(`st:${ID}:DONE`);
  });
});

describe("texts", () => {
  it("resolution detail marks an overdue deadline", () => {
    expect(resolutionDetailText(res, "2026-11-01")).toContain("(گذشته)");
    expect(resolutionDetailText(res, "2026-10-01")).not.toContain("(گذشته)");
    expect(resolutionDetailText(res, "2026-10-01")).toContain("۱۲-۳");
  });
  it("every notification kind has a text; no internal ids leak", () => {
    const meeting = { id: ID, meeting_number: 12, scheduled_at: "2026-10-20T06:00:00Z" };
    const kinds = ["MINUTES", "NEW_RESOLUTIONS", "DUE_SOON", "DUE_TODAY", "OVERDUE", "REVIEW_REQUEST", "CLOSED", "REOPENED", "DIGEST"] as const;
    for (const kind of kinds) {
      const t = notificationText({ kind, memberName: "عضو", meeting, resolution: { ...res, owner_name: "مسئول" }, resolutions: [res], lastNote: "انجام شد", payload: { days: -6, note: "تأیید شد", overdue: 2, pending_review: 1 } });
      expect(t, kind).toBeTruthy();
      expect(t!, kind).not.toContain(ID);
    }
    expect(notificationText({ kind: "OVERDUE", memberName: "x", resolution: res, payload: { days: -6 } })).toContain("۶ روز");
    expect(notificationText({ kind: "DUE_SOON", memberName: "x", resolution: null, payload: {} })).toBeNull();
  });
});

describe("wiring (static)", () => {
  it("the board webhook and cron route are carved out of the login redirect (else Telegram gets a 307)", () => {
    const mw = readFileSync(join(process.cwd(), "lib", "supabase", "middleware.ts"), "utf8");
    expect(mw).toContain('path === "/api/telegram/board-webhook"');
    expect(mw).toContain('path === "/api/board/cron"');
  });
  it("the bot never uses the other bots' tokens / tables", () => {
    const files = ["bot.ts", "handleUpdate.ts", "notify.ts", "security.ts"].map((f) => readFileSync(join(process.cwd(), "lib", "board", "telegram", f), "utf8")).join("\n");
    expect(files).not.toMatch(/EXTERNAL_TELEGRAM_BOT_TOKEN|[^_]TELEGRAM_BOT_TOKEN|external_bot_|assistant_channel_/);
  });
});
