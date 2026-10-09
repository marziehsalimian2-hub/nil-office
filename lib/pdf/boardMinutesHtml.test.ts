import { describe, it, expect } from "vitest";
import { boardMinutesFileName, boardMinutesFooterLabel, buildBoardMinutesHtml } from "./boardMinutesHtml";
import type { MinutesDoc } from "@/lib/board/types";

const doc: MinutesDoc = {
  meeting: {
    id: "11111111-1111-1111-1111-111111111111", number: 12, type: "ORDINARY", scheduled_at: "2026-10-20T06:00:00Z", location: "دفتر نیل",
    started_at: "2026-10-20T06:05:00Z", ended_at: "2026-10-20T07:40:00Z", invitees: "مدیر مالی", general_notes: "جلسه با تلاوت آغاز شد.\nخط دوم",
    remaining_topics: null,
  },
  chair: { name: "رئیس هیئت", title: "رئیس هیئت‌مدیره" },
  secretary: { name: "مرضیه سلیمیان", title: "دبیر" },
  attendance: [
    { member_id: "m-1", name: "رئیس هیئت", title: "رئیس هیئت‌مدیره", kind: "INTERNAL", status: "PRESENT", note: null },
    { member_id: "m-2", name: "مرضیه سلیمیان", title: "دبیر", kind: "INTERNAL", status: "PRESENT", note: null },
    { member_id: "m-3", name: "عضو بیرونی", title: "عضو غیرموظف", kind: "EXTERNAL", status: "EXCUSED", note: "سفر" },
  ],
  agenda: [{ id: "a-1", position: 1, title: "بررسی قرارداد عمان", discussion: "بحث شد <script>alert(1)</script>" }],
  resolutions: [
    { id: "r-1", number: "12-1", agenda_item_id: "a-1", text: "تهیهٔ پیشنهاد نهایی", requires_action: true, owner_name: "مرضیه سلیمیان", due_date: "2026-10-30", expected_output: "فایل پیشنهاد", vote_note: "با اتفاق آرا" },
    { id: "r-2", number: "12-2", agenda_item_id: null, text: "گزارش مالی تصویب شد", requires_action: false, owner_name: null, due_date: null, expected_output: null, vote_note: null },
  ],
  previous_followups: [{ number: "11-3", text: "پیگیری بیمه", owner_name: "رئیس هیئت", due_date: "2026-10-10", follow_status: "IN_PROGRESS" }],
  approved_at: "2026-10-20T09:00:00Z",
  approved_by_name: "مرضیه سلیمیان",
  next_meeting: { scheduled_at: "2026-11-03T06:00:00Z", location: "دفتر نیل" },
};
const html = (over: Partial<Parameters<typeof buildBoardMinutesHtml>[0]> = {}) =>
  buildBoardMinutesHtml({ doc, draft: false, fonts: { nazanin: "AAAA", vazir: "BBBB" }, emblemDataUri: null, reserveBottomMm: 0, ...over });

describe("board minutes HTML", () => {
  it("has the 8 numbered sections of the NIL template", () => {
    const h = html();
    for (const t of ["مشخصات جلسه", "اعضای هیئت‌مدیره و وضعیت حضور", "دستور جلسه", "بررسی مصوبات جلسات قبل", "خلاصهٔ مذاکرات", "مصوبات جلسه", "موضوعات باقی‌مانده و جلسهٔ بعد", "امضای اعضای حاضر"]) {
      expect(h, t).toContain(t);
    }
    expect(h).toContain("صورت‌جلسهٔ هیئت‌مدیره");
    expect(h).toContain("۱۲");          // meeting number
    expect(h).toContain("۱۲-۱");        // resolution number in Persian digits
    expect(h).toContain("بدون اقدام اجرایی");
    expect(h).toContain("با اتفاق آرا");
  });
  it("escapes everything user-typed and keeps line breaks", () => {
    const h = html();
    expect(h).not.toContain("<script>alert(1)</script>");
    expect(h).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(h).toContain("جلسه با تلاوت آغاز شد.<br/>خط دوم");
  });
  it("signature table lists ONLY the members who were present", () => {
    const sign = html().split("امضای اعضای حاضر")[1];
    expect(sign).toContain("رئیس هیئت");
    expect(sign).toContain("مرضیه سلیمیان");
    expect(sign).not.toContain("عضو بیرونی");
    expect(sign).toContain("تأیید سامانه جایگزین امضای اعضا نیست");
  });
  it("internal ids never reach the document", () => {
    const h = html();
    for (const id of ["11111111-1111-1111-1111-111111111111", "m-1", "a-1", "r-1"]) expect(h).not.toMatch(new RegExp(`[">\\s]${id}[<"\\s]`));
  });
  it("a draft is watermarked, says it has no official standing, and has no number", () => {
    const d: MinutesDoc = { ...doc, meeting: { ...doc.meeting, number: null }, approved_at: null, resolutions: doc.resolutions.map((r) => ({ ...r, number: null })) };
    const h = html({ doc: d, draft: true });
    expect(h).toContain('class="watermark"');
    expect(h).toContain("اعتبار رسمی ندارد");
    expect(html()).not.toContain('class="watermark"');
    expect(boardMinutesFooterLabel(d, true, 0, 2)).toBe("پیش‌نویس صورت‌جلسهٔ هیئت‌مدیره · صفحهٔ ۱ از ۲");
    expect(boardMinutesFileName(d, true)).toBe("پیش‌نویس-صورت‌جلسه-هیئت‌مدیره-1405-07-28.pdf");
  });
  it("the NIL Verify reserve sits inside the unbreakable signature block", () => {
    expect(html({ reserveBottomMm: 22 })).toContain('<div class="sign-block" style="padding-bottom:22mm">');
    expect(boardMinutesFooterLabel(doc, false, 1, 3)).toBe("صورت‌جلسهٔ شمارهٔ ۱۲ هیئت‌مدیره · صفحهٔ ۲ از ۳");
    expect(boardMinutesFileName(doc, false)).toBe("صورت‌جلسه-هیئت‌مدیره-12.pdf");
  });
});
