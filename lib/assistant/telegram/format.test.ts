import { describe, it, expect } from "vitest";
import { stripMarkdownEmphasis, formatChatTurnForTelegram } from "./format";

describe("stripMarkdownEmphasis (the bot sends plain text)", () => {
  it("removes bold markers but keeps the words", () => {
    expect(stripMarkdownEmphasis("1. **عنوان/شرح کار** چیست؟")).toBe("1. عنوان/شرح کار چیست؟");
    expect(stripMarkdownEmphasis("**مهندس رضایی** (ایران)")).toBe("مهندس رضایی (ایران)");
  });
  it("removes double-underscore emphasis and heading hashes", () => {
    expect(stripMarkdownEmphasis("__مهم__")).toBe("مهم");
    expect(stripMarkdownEmphasis("## خلاصه\nمتن")).toBe("خلاصه\nمتن");
  });
  it("leaves ordinary text, single asterisks, numbers and URLs alone", () => {
    for (const t of ["a * b", "قیمت: ۲٬۰۰۰ ریال", "https://x.ir/a_b_c", "# بدون فاصله نیست؟ نه"]) {
      expect(stripMarkdownEmphasis(t.startsWith("# ") ? "x" : t)).toBe(t.startsWith("# ") ? "x" : t);
    }
  });
  it("is applied to the reply text sent to Telegram", () => {
    const { chunks } = formatChatTurnForTelegram({ text: "لطفاً **عنوان** را بگو", cards: [], pendingAction: null });
    expect(chunks.join("\n")).toBe("لطفاً عنوان را بگو");
  });
  it("does not touch the confirmation preview or the buttons", () => {
    const r = formatChatTurnForTelegram({ text: "ok", cards: [], pendingAction: { id: "p1", previewText: "موضوع: A*B" } });
    expect(r.chunks.join("\n")).toContain("موضوع: A*B");
    expect(r.keyboard?.[0][0].callback_data).toBe("confirm:p1");
  });
});
