import { formatJalali, toFaDigits } from "@/lib/jalali";
import {
  BOARD_ATTENDANCE_LABEL, BOARD_COMPANY_NAME, BOARD_FOLLOW_STATUS_LABEL, BOARD_MEETING_TYPE_LABEL, quorumInfo, type MinutesDoc,
} from "@/lib/board/types";
import { boardDate, boardTime, boardWeekday, tehranDate } from "@/lib/board/time";

/**
 * PURE board-minutes HTML builder (no fs, no puppeteer, no DB) so it is unit-testable; the renderer supplies fonts, emblem and the
 * PDF step. Layout follows the NIL board-minutes template (8 numbered sections, navy #142B48 / gold #9C793C) with a cleaner,
 * more formal finish. Everything user-typed is escaped; line breaks are kept.
 */
export type BoardMinutesHtmlInput = {
  doc: MinutesDoc;
  draft: boolean;
  fonts: { nazanin: string; vazir: string };   // base64 TTF / WOFF2
  emblemDataUri: string | null;
  /** extra empty space (mm) kept under the signature block on the LAST page for the NIL Verify plate */
  reserveBottomMm: number;
};

export const NAVY = "#142B48";
export const GOLD = "#9C793C";

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** escaped multi-line text (newlines kept) */
const para = (s: string | null | undefined) => esc(s).replace(/\r?\n/g, "<br/>");
const fa = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : toFaDigits(v));

function section(n: number, title: string, body: string): string {
  return `<section class="sec">
    <h2 class="sec-h"><span class="sec-n">${toFaDigits(n)}</span><span class="sec-t">${esc(title)}</span></h2>
    ${body}
  </section>`;
}

const empty = (text: string) => `<p class="empty">${esc(text)}</p>`;

export function buildBoardMinutesHtml(input: BoardMinutesHtmlInput): string {
  const { doc, draft, fonts } = input;
  const m = doc.meeting;
  const present = doc.attendance.filter((a) => a.status === "PRESENT");
  const q = quorumInfo(doc.attendance.length, present.length);
  const timeRange = m.started_at && m.ended_at ? `${boardTime(m.started_at)} تا ${boardTime(m.ended_at)}` : "—";
  const numberLabel = m.number != null ? toFaDigits(m.number) : "—";

  // ---------- header ----------
  const header = `<header class="doc-head">
    ${input.emblemDataUri ? `<img class="emblem" src="${input.emblemDataUri}" alt="" />` : ""}
    <div class="company">${esc(BOARD_COMPANY_NAME)}</div>
    <h1 class="title">صورت‌جلسهٔ هیئت‌مدیره</h1>
    <div class="rule"><span></span><i></i><span></span></div>
    <table class="meta"><tr>
      <td><div class="k">شمارهٔ جلسه</div><div class="v big">${numberLabel}</div></td>
      <td><div class="k">نوع جلسه</div><div class="v">${esc(BOARD_MEETING_TYPE_LABEL[m.type])}</div></td>
      <td><div class="k">تاریخ</div><div class="v">${esc(boardWeekday(m.scheduled_at))} ${boardDate(m.scheduled_at)}</div></td>
      <td><div class="k">زمان برگزاری</div><div class="v">${timeRange}</div></td>
    </tr></table>
    ${draft ? `<div class="draft-banner">پیش‌نویس — این نسخه هنوز تأیید نشده و اعتبار رسمی ندارد</div>` : ""}
  </header>`;

  // ---------- 1. meeting details ----------
  const kv = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const s1 = section(1, "مشخصات جلسه", `<table class="kv">
    ${kv("محل برگزاری", esc(m.location))}
    ${kv("زمان دعوت‌شده", `${boardDate(m.scheduled_at)} — ساعت ${boardTime(m.scheduled_at)}`)}
    ${kv("رئیس جلسه", doc.chair ? `${esc(doc.chair.name)}${doc.chair.title ? `<span class="muted"> — ${esc(doc.chair.title)}</span>` : ""}` : "—")}
    ${kv("دبیر جلسه", doc.secretary ? `${esc(doc.secretary.name)}${doc.secretary.title ? `<span class="muted"> — ${esc(doc.secretary.title)}</span>` : ""}` : "—")}
    ${m.invitees ? kv("مدعوین", para(m.invitees)) : ""}
  </table>`);

  // ---------- 2. attendance ----------
  const s2 = section(2, "اعضای هیئت‌مدیره و وضعیت حضور", doc.attendance.length === 0 ? empty("وضعیت حضور ثبت نشده است.") : `
    <table class="grid">
      <thead><tr><th class="n">ردیف</th><th>نام و نام خانوادگی</th><th>سمت</th><th class="st">وضعیت</th><th>توضیح</th></tr></thead>
      <tbody>${doc.attendance.map((a, i) => `<tr>
        <td class="n">${toFaDigits(i + 1)}</td>
        <td><b>${esc(a.name)}</b></td>
        <td>${esc(a.title) || "—"}</td>
        <td class="st"><span class="att att-${a.status.toLowerCase()}">${esc(BOARD_ATTENDANCE_LABEL[a.status])}</span></td>
        <td class="muted">${esc(a.note) || ""}</td>
      </tr>`).join("")}</tbody>
    </table>
    <p class="note">تعداد حاضران: ${toFaDigits(q.present)} نفر از ${toFaDigits(doc.attendance.length)} عضو${q.met ? " — جلسه با حضور اکثریت اعضا تشکیل شد." : "."}</p>`);

  // ---------- 3. agenda ----------
  const s3 = section(3, "دستور جلسه", doc.agenda.length === 0 ? empty("دستور جلسه ثبت نشده است.") : `
    <ol class="agenda">${doc.agenda.map((a) => `<li><span class="an">${toFaDigits(a.position)}</span><span>${esc(a.title)}</span></li>`).join("")}</ol>`);

  // ---------- 4. previous resolutions ----------
  const s4 = section(4, "بررسی مصوبات جلسات قبل", doc.previous_followups.length === 0 ? empty("مصوبهٔ بازی از جلسات قبل وجود ندارد.") : `
    <table class="grid">
      <thead><tr><th class="num">شماره</th><th>متن مصوبه</th><th>مسئول</th><th class="d">مهلت</th><th class="st">وضعیت</th></tr></thead>
      <tbody>${doc.previous_followups.map((r) => `<tr>
        <td class="num">${fa(r.number)}</td><td>${para(r.text)}</td><td>${esc(r.owner_name) || "—"}</td>
        <td class="d">${r.due_date ? formatJalali(r.due_date) : "—"}</td><td class="st">${esc(BOARD_FOLLOW_STATUS_LABEL[r.follow_status])}</td>
      </tr>`).join("")}</tbody>
    </table>`);

  // ---------- 5. discussion ----------
  const items = doc.agenda.filter((a) => a.discussion && a.discussion.trim());
  const s5 = section(5, "خلاصهٔ مذاکرات", (!m.general_notes && items.length === 0) ? empty("خلاصهٔ مذاکرات ثبت نشده است.") : `
    ${m.general_notes ? `<div class="prose">${para(m.general_notes)}</div>` : ""}
    ${items.map((a) => `<div class="topic">
      <div class="topic-h">بند ${toFaDigits(a.position)} — ${esc(a.title)}</div>
      <div class="prose">${para(a.discussion)}</div>
    </div>`).join("")}`);

  // ---------- 6. resolutions ----------
  const s6 = section(6, "مصوبات جلسه", doc.resolutions.length === 0 ? empty("در این جلسه مصوبه‌ای ثبت نشد.") : `
    <table class="grid res">
      <thead><tr><th class="num">شماره</th><th>متن مصوبه</th><th class="o">مسئول اجرا</th><th class="d">مهلت</th><th class="x">خروجی مورد انتظار</th></tr></thead>
      <tbody>${doc.resolutions.map((r, i) => `<tr>
        <td class="num">${r.number ? toFaDigits(r.number) : `<span class="muted">${toFaDigits(i + 1)}</span>`}</td>
        <td>${para(r.text)}${r.vote_note ? `<div class="vote">${para(r.vote_note)}</div>` : ""}</td>
        ${r.requires_action
          ? `<td class="o">${esc(r.owner_name) || "—"}</td><td class="d">${r.due_date ? formatJalali(r.due_date) : "—"}</td><td class="x">${para(r.expected_output) || "—"}</td>`
          : `<td colspan="3" class="noact">بدون اقدام اجرایی</td>`}
      </tr>`).join("")}</tbody>
    </table>`);

  // ---------- 7. remaining + next ----------
  const next = doc.next_meeting;
  const s7 = section(7, "موضوعات باقی‌مانده و جلسهٔ بعد", `
    <table class="kv">
      ${kv("موضوعات باقی‌مانده", m.remaining_topics ? para(m.remaining_topics) : "—")}
      ${kv("جلسهٔ بعد (پیشنهادی)", next ? `${esc(boardWeekday(next.scheduled_at))} ${boardDate(next.scheduled_at)} — ساعت ${boardTime(next.scheduled_at)} — ${esc(next.location)}` : "—")}
    </table>`);

  // ---------- 8. signatures ----------
  const approval = doc.approved_at
    ? `این صورت‌جلسه در تاریخ ${boardDate(doc.approved_at)} ساعت ${boardTime(doc.approved_at)}${doc.approved_by_name ? ` توسط ${esc(doc.approved_by_name)}` : ""} در سامانهٔ دبیرخانهٔ نیل تأیید و قفل شد. تأیید سامانه جایگزین امضای اعضا نیست.`
    : "پس از تأیید نهایی در سامانه، این صورت‌جلسه با شماره و کد استعلام اصالت چاپ و به امضای اعضای حاضر می‌رسد.";
  const s8 = `<div class="sign-block" style="padding-bottom:${Math.max(0, input.reserveBottomMm)}mm">${section(8, "امضای اعضای حاضر", `
    <table class="grid sign">
      <thead><tr><th class="n">ردیف</th><th>نام و نام خانوادگی</th><th>سمت</th><th class="sig">امضا</th></tr></thead>
      <tbody>${present.length === 0 ? `<tr><td colspan="4" class="muted">—</td></tr>` : present.map((a, i) => `<tr>
        <td class="n">${toFaDigits(i + 1)}</td><td><b>${esc(a.name)}</b></td><td>${esc(a.title) || "—"}</td><td class="sig"></td>
      </tr>`).join("")}</tbody>
    </table>
    <p class="fine">${approval}</p>`)}</div>`;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: "BNazanin"; src: url(data:font/ttf;base64,${fonts.nazanin}) format("truetype"); }
  @font-face { font-family: "Vazir"; src: url(data:font/woff2;base64,${fonts.vazir}) format("woff2"); font-weight: 100 900; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "BNazanin", "Vazir", sans-serif; direction: rtl; color: #1d2433; font-size: 15px; line-height: 1.8; }
  .muted { color: #6b7280; }
  b { font-weight: 700; }

  .doc-head { text-align: center; margin-bottom: 6mm; }
  .emblem { height: 21mm; display: block; margin: 0 auto 2mm; }
  .company { font-family: "Vazir"; font-weight: 500; font-size: 11px; letter-spacing: .2px; color: ${GOLD}; }
  .title { font-family: "Vazir"; font-weight: 800; font-size: 25px; color: ${NAVY}; margin: 1mm 0 2mm; line-height: 1.5; }
  .rule { display: flex; align-items: center; justify-content: center; gap: 3mm; margin: 0 auto 4mm; width: 70mm; }
  .rule span { flex: 1; height: 0; border-top: .6pt solid ${GOLD}; }
  .rule i { width: 2.2mm; height: 2.2mm; background: ${GOLD}; transform: rotate(45deg); display: block; }
  table.meta { width: 100%; border-collapse: separate; border-spacing: 2mm 0; table-layout: fixed; }
  table.meta td { background: #f6f3ec; border-top: 2pt solid ${NAVY}; border-radius: 1.5mm; padding: 2mm 2mm 1.6mm; text-align: center; vertical-align: top; }
  table.meta .k { font-family: "Vazir"; font-size: 9.5px; color: #6b7280; line-height: 1.6; }
  table.meta .v { font-family: "Vazir"; font-weight: 600; font-size: 12px; color: ${NAVY}; line-height: 1.7; }
  table.meta .v.big { font-size: 17px; font-weight: 800; }
  .draft-banner { margin-top: 3mm; border: 1pt dashed ${GOLD}; color: ${GOLD}; font-family: "Vazir"; font-size: 11px; padding: 1.5mm; border-radius: 1.5mm; }

  .sec { margin-top: 5.5mm; }
  .sec-h { display: flex; align-items: center; gap: 2.5mm; margin: 0 0 2.5mm; padding-bottom: 1.2mm; border-bottom: .6pt solid #d9cdb4;
           break-after: avoid; page-break-after: avoid; }
  .sec-n { font-family: "Vazir"; font-weight: 700; font-size: 11px; color: #fff; background: ${NAVY}; width: 6.2mm; height: 6.2mm;
           border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 0 0 .8pt ${GOLD}; }
  .sec-t { font-family: "Vazir"; font-weight: 700; font-size: 14px; color: ${NAVY}; }
  .empty { color: #6b7280; font-size: 14px; margin: 0; }
  .note { font-size: 13.5px; color: #374151; margin: 1.5mm 0 0; }

  table.kv { width: 100%; border-collapse: collapse; }
  table.kv th { width: 34mm; text-align: right; font-family: "Vazir"; font-weight: 600; font-size: 11px; color: ${NAVY}; background: #f6f3ec;
                padding: 1.2mm 2.5mm; border-bottom: .5pt solid #fff; vertical-align: top; }
  table.kv td { padding: 1mm 3mm; line-height: 1.7; border-bottom: .5pt solid #e5e7eb; vertical-align: top; }

  table.grid { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.grid thead { display: table-header-group; }
  table.grid th { background: ${NAVY}; color: #fff; font-family: "Vazir"; font-weight: 600; font-size: 10.5px; padding: 1.8mm 2mm; text-align: right; }
  table.grid th:first-child { border-top-right-radius: 1.2mm; }
  table.grid th:last-child { border-top-left-radius: 1.2mm; }
  table.grid td { padding: 1.2mm 2mm; border-bottom: .5pt solid #e5e7eb; vertical-align: top; line-height: 1.65; }
  table.grid tbody tr:nth-child(even) td { background: #fafbfc; }
  table.grid tr { break-inside: avoid; page-break-inside: avoid; }
  table.grid .n { width: 11mm; text-align: center; }
  table.grid .num { width: 16mm; text-align: center; }
  table.grid td.num { font-family: "Vazir"; font-weight: 600; font-size: 11.5px; color: ${NAVY}; }
  table.grid .st { width: 24mm; text-align: center; }
  table.grid .d { width: 22mm; text-align: center; white-space: nowrap; }
  table.grid .o { width: 30mm; }
  table.grid .x { width: 38mm; }
  table.grid .noact { text-align: center; color: #6b7280; font-size: 13px; }
  .att { font-family: "Vazir"; font-size: 10px; font-weight: 600; padding: .4mm 2mm; border-radius: 3mm; }
  .att-present { color: #166534; background: #dcfce7; }
  .att-absent { color: #991b1b; background: #fee2e2; }
  .att-excused { color: #92400e; background: #fef3c7; }
  .vote { margin-top: 1mm; padding: 1mm 2mm; border-right: 1.5pt solid ${GOLD}; background: #faf7f0; font-size: 13px; color: #4b5563; }

  ol.agenda { list-style: none; margin: 0; padding: 0; }
  ol.agenda li { display: flex; gap: 2.5mm; align-items: baseline; padding: 1mm 0; border-bottom: .5pt dotted #d1d5db; }
  ol.agenda .an { font-family: "Vazir"; font-weight: 700; font-size: 11px; color: ${GOLD}; min-width: 5mm; }

  .prose { text-align: justify; text-align-last: right; margin-bottom: 1.5mm; }
  .topic { margin-top: 2.5mm; }
  .topic-h { font-family: "Vazir"; font-weight: 600; font-size: 12px; color: ${NAVY}; margin-bottom: .8mm; break-after: avoid; page-break-after: avoid; }

  .sign-block { break-inside: avoid; page-break-inside: avoid; }
  table.sign td { height: 13mm; vertical-align: middle; }
  table.sign .sig { width: 55mm; }
  .fine { font-size: 12px; color: #4b5563; margin: 2.5mm 0 0; padding: 2mm 3mm; background: #f6f3ec; border-radius: 1.5mm; }

  .watermark { position: fixed; top: 45%; left: 0; right: 0; text-align: center; transform: rotate(-28deg);
               font-family: "Vazir"; font-weight: 800; font-size: 96px; color: rgba(156, 121, 60, .10); z-index: -1; }
</style>
</head>
<body>
  ${draft ? `<div class="watermark">پیش‌نویس</div>` : ""}
  ${header}
  ${s1}
  ${s2}
  ${s3}
  ${s4}
  ${s5}
  ${s6}
  ${s7}
  ${s8}
</body>
</html>`;
}

/** Footer line under every page («صورت‌جلسهٔ شمارهٔ ۱۲ هیئت‌مدیره · صفحهٔ ۱ از ۳»). */
export function boardMinutesFooterLabel(doc: MinutesDoc, draft: boolean, pageIndex: number, pageCount: number): string {
  const head = draft || doc.meeting.number == null ? "پیش‌نویس صورت‌جلسهٔ هیئت‌مدیره" : `صورت‌جلسهٔ شمارهٔ ${toFaDigits(doc.meeting.number)} هیئت‌مدیره`;
  return `${head} · صفحهٔ ${toFaDigits(pageIndex + 1)} از ${toFaDigits(pageCount)}`;
}

/** Running header of pages 2..n («شرکت ... | تاریخ جلسه»). */
export function boardMinutesRunningHeader(doc: MinutesDoc): { right: string; left: string } {
  return { right: BOARD_COMPANY_NAME, left: `صورت‌جلسهٔ هیئت‌مدیره — ${boardDate(doc.meeting.scheduled_at)}` };
}

export function boardMinutesFileName(doc: MinutesDoc, draft: boolean): string {
  return draft || doc.meeting.number == null
    ? `پیش‌نویس-صورت‌جلسه-هیئت‌مدیره-${tehranSafeDate(doc.meeting.scheduled_at)}.pdf`
    : `صورت‌جلسه-هیئت‌مدیره-${doc.meeting.number}.pdf`;
}

const tehranSafeDate = (iso: string) => formatJalali(tehranDate(iso), false).replace(/\//g, "-");

export const __test = { esc, para };
