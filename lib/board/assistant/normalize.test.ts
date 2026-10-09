import { describe, it, expect } from "vitest";
import { dueWrittenInQuote, memberNamedInNotes, normalizeDraft, normalizeFa, quoteInNotes, type DraftContext } from "./normalize";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const SAMAN = "33333333-3333-4333-8333-333333333333";
const MARZIEH = "44444444-4444-4444-8444-444444444444";
const ALI = "55555555-5555-4555-8555-555555555555";

const ctx: DraftContext = {
  meetingDate: "2026-10-20",                     // 1405/07/28
  agenda: [{ id: A1, position: 1, title: "قرارداد عمان" }, { id: A2, position: 2, title: "گزارش مالی" }],
  members: [
    { id: SAMAN, full_name: "سامان حسینی رضوانی", position_title: "عضو" },
    { id: MARZIEH, full_name: "مرضیه سلیمیان", position_title: "دبیر" },
    { id: ALI, full_name: "علی حسینی", position_title: "عضو" },
  ],
};
const notes = `بند ۱ قرارداد عمان: سامان گزارش داد که مذاکرات به نتیجه رسیده. قرار شد پیشنهاد نهایی تا ۲۰ آبان آماده شود.
گزارش مالي شش‌ماهه با اتفاق آرا تصویب شد.
واحد مالی باید بودجه را هفته آینده بدهد.`;

describe("matching helpers", () => {
  it("normalises Arabic letters, Persian digits, ZWNJ and spacing", () => {
    expect(normalizeFa("گزارش مالي  شش‌ماهه ۲۰")).toBe(normalizeFa("گزارش مالی شش ماهه 20"));
  });
  it("a quote must really be in the notes (and be long enough to prove anything)", () => {
    expect(quoteInNotes(notes, "قرار شد پیشنهاد نهایی تا ۲۰ آبان آماده شود")).toBe(true);
    expect(quoteInNotes(notes, "گزارش مالی شش‌ماهه")).toBe(true);           // ي vs ی
    expect(quoteInNotes(notes, "قرار شد قرارداد امضا شود")).toBe(false);
    expect(quoteInNotes(notes, "بند")).toBe(false);
    expect(quoteInNotes(notes, null)).toBe(false);
  });
  it("a member is named by full name or a part no other member shares", () => {
    expect(memberNamedInNotes(notes, ctx.members[0], ctx.members)).toBe(true);    // «سامان»
    expect(memberNamedInNotes(notes, ctx.members[1], ctx.members)).toBe(false);   // not in the notes
    expect(memberNamedInNotes("آقای حسینی پیگیری کند", ctx.members[2], ctx.members)).toBe(false);   // «حسینی» is shared — ambiguous
    expect(memberNamedInNotes("علی حسینی پیگیری کند", ctx.members[2], ctx.members)).toBe(true);
  });
  it("a deadline's day and month must be written in the quote", () => {
    expect(dueWrittenInQuote("2026-11-11", "تا ۲۰ آبان آماده شود")).toBe(true);      // 1405/08/20
    expect(dueWrittenInQuote("2026-11-11", "تا 1405/08/20")).toBe(true);
    expect(dueWrittenInQuote("2026-11-11", "تا پایان آبان")).toBe(false);
    expect(dueWrittenInQuote("2026-11-11", "تا ۲۰ آذر")).toBe(false);
  });
});

describe("normalizeDraft", () => {
  const raw = {
    general_notes: "جلسه با حضور اکثریت تشکیل شد.",
    agenda: [
      { agenda_item_id: A1, discussion: "مذاکرات به نتیجه رسید.", source_quote: "سامان گزارش داد که مذاکرات به نتیجه رسیده" },
      { agenda_item_id: "99999999-9999-4999-8999-999999999999", discussion: "x", source_quote: "x" },     // unknown id, no title → dropped
      { new_title: "بودجه", discussion: "بودجه مطرح شد.", source_quote: "این جمله در یادداشت نیست" },
    ],
    resolutions: [
      { text: "پیشنهاد نهایی عمان تهیه شود.", agenda_item_id: A1, requires_action: true, owner_member_id: SAMAN, due_date_jalali: "1405/08/20",
        source_quote: "قرار شد پیشنهاد نهایی تا ۲۰ آبان آماده شود", expected_output: "فایل پیشنهاد" },
      { text: "گزارش مالی تصویب شد.", agenda_item_id: A2, requires_action: false, owner_member_id: SAMAN, due_date_jalali: "1405/09/01",
        source_quote: "گزارش مالی شش‌ماهه با اتفاق آرا تصویب شد", vote_note: "با اتفاق آرا" },
      { text: "بودجه ارائه شود.", new_agenda_index: 2, requires_action: true, owner_member_id: MARZIEH, owner_name_in_notes: "واحد مالی",
        due_date_jalali: "1405/08/05", due_hint: "هفته آینده", source_quote: "واحد مالی باید بودجه را هفته آینده بدهد" },
      { text: "مهلت قبل از جلسه.", requires_action: true, due_date_jalali: "1405/07/01", source_quote: "قرار شد پیشنهاد نهایی تا ۲۰ آبان آماده شود" },
      { text: "", source_quote: "x" },                                                                          // empty → dropped
    ],
    warnings: ["یک نکتهٔ مبهم"],
  };
  const s = normalizeDraft(raw, notes, ctx);

  it("keeps known agenda items, turns titled unknowns into NEW items, drops the rest", () => {
    expect(s.agenda.map((a) => [a.agenda_item_id, a.title, a.quote_found])).toEqual([[A1, "قرارداد عمان", true], [null, "بودجه", false]]);
    expect(s.general_notes).toBe("جلسه با حضور اکثریت تشکیل شد.");
  });
  it("keeps an owner and a deadline that the notes really state", () => {
    const r = s.resolutions[0];
    expect([r.owner_member_id, r.due_date, r.quote_found, r.agenda_item_id]).toEqual([SAMAN, "2026-11-11", true, A1]);
  });
  it("a non-action resolution carries no owner / deadline / output", () => {
    const r = s.resolutions[1];
    expect([r.requires_action, r.owner_member_id, r.due_date, r.expected_output, r.vote_note]).toEqual([false, null, null, null, "با اتفاق آرا"]);
  });
  it("NEVER invents: an owner not named in the notes and a relative deadline become hints + warnings", () => {
    const r = s.resolutions[2];
    expect([r.owner_member_id, r.owner_hint, r.due_date, r.due_hint, r.agenda_key]).toEqual([null, "واحد مالی", null, "هفته آینده", "a1"]);
    expect(s.warnings.some((w) => w.includes("مسئول «بودجه ارائه شود.»"))).toBe(true);
    expect(s.warnings.some((w) => w.includes("مهلت «بودجه ارائه شود.»"))).toBe(true);
  });
  it("a deadline before the meeting day is refused", () => {
    expect(s.resolutions[3].due_date).toBeNull();
  });
  it("unverifiable items are flagged, empty ones dropped, model warnings kept", () => {
    expect(s.resolutions).toHaveLength(4);
    expect(s.warnings).toContain("یک نکتهٔ مبهم");
    expect(s.warnings.some((w) => w.includes("بودجه") && w.includes("متن پشتیبان"))).toBe(true);
  });
  it("survives garbage from the model", () => {
    const g = normalizeDraft({ agenda: "nope", resolutions: [null, 5, { text: 7 }], warnings: [1, null] } as never, notes, ctx);
    expect(g).toMatchObject({ agenda: [], resolutions: [], general_notes: null });
  });
});
