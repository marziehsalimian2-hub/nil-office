import { describe, it, expect } from "vitest";
import type { Profile } from "@/lib/types/database";
import { MENU_ITEMS, buildMenuKeyboard, resolveMenuCallback, isMenuRequest, MENU_CALLBACK_PREFIX } from "./menu";

const p = (over: Record<string, unknown> = {}) => ({ role: "USER", is_active: true, ...over }) as unknown as Profile;
const keysFor = (profile: Profile) => buildMenuKeyboard(profile).flat().map((b) => b.callback_data.slice(MENU_CALLBACK_PREFIX.length));

describe("menu keyboard", () => {
  it("a plain user sees only the actions they can really perform", () => {
    expect(keysFor(p())).toEqual(["today", "overdue", "letter", "customers", "reports"]);
  });
  it("accounting CREATE adds receipt / payment; invoice CREATE adds proforma; service-ledger adds service", () => {
    expect(keysFor(p({ accounting_role: "CREATE" }))).toEqual(expect.arrayContaining(["receipt", "payment"]));
    expect(keysFor(p({ accounting_role: "VIEW" }))).not.toContain("receipt");
    expect(keysFor(p({ invoice_role: "CREATE" }))).toContain("proforma");
    expect(keysFor(p({ invoice_role: "VIEW" }))).not.toContain("proforma");
    expect(keysFor(p({ service_ledger_role: "VIEW" }))).toContain("service");
  });
  it("an ADMIN sees every button, in the spec §58 order", () => {
    expect(keysFor(p({ role: "ADMIN" }))).toEqual(["today", "overdue", "letter", "receipt", "payment", "service", "proforma", "customers", "reports"]);
  });
  it("two buttons per row at most", () => {
    for (const row of buildMenuKeyboard(p({ role: "ADMIN" }))) expect(row.length).toBeLessThanOrEqual(2);
  });
  it("callback_data is opaque, fixed and tiny — no data, well under 64 bytes", () => {
    for (const row of buildMenuKeyboard(p({ role: "ADMIN" }))) {
      for (const b of row) {
        expect(b.callback_data).toMatch(/^menu:[a-z]{3,12}$/);
        expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe("menu callbacks are re-authorised on every tap", () => {
  it("a role that no longer allows the item gets nothing (e.g. accounting revoked after the menu was shown)", () => {
    expect(resolveMenuCallback("menu:receipt", p({ accounting_role: "CREATE" }))?.key).toBe("receipt");
    expect(resolveMenuCallback("menu:receipt", p({ accounting_role: null }))).toBeNull();
  });
  it("unknown keys and foreign prefixes are ignored", () => {
    expect(resolveMenuCallback("menu:drop_table", p({ role: "ADMIN" }))).toBeNull();
    expect(resolveMenuCallback("confirm:123", p({ role: "ADMIN" }))).toBeNull();
    expect(resolveMenuCallback("menu:", p({ role: "ADMIN" }))).toBeNull();
  });
});

describe("menu items never write anything", () => {
  it("every item is either a fixed question or a fixed how-to, with no data placeholders", () => {
    for (const i of MENU_ITEMS) {
      if (i.kind === "ASK") expect(i.prompt && i.prompt.length > 5).toBe(true);
      else expect(i.guide && i.guide.length > 20).toBe(true);
    }
  });
  it("the receipt / payment guides state that only a DRAFT is created", () => {
    for (const k of ["receipt", "payment"] as const) expect(MENU_ITEMS.find((i) => i.key === k)!.guide).toContain("پیش‌نویس");
  });
  it("the letter / proforma guides state that the official number needs a separate confirmation", () => {
    for (const k of ["letter", "proforma"] as const) expect(MENU_ITEMS.find((i) => i.key === k)!.guide).toContain("تأیید جداگانه");
  });
});

describe("isMenuRequest", () => {
  it("recognises /menu, «منو» and the /menu@botname form", () => {
    for (const t of ["/menu", " /MENU ", "منو", "/menu@nil_bot"]) expect(isMenuRequest(t), t).toBe(true);
  });
  it("ignores everything else", () => {
    for (const t of ["menu please", "منوی غذا", "/start", "", undefined]) expect(isMenuRequest(t as string | undefined), String(t)).toBe(false);
  });
});
