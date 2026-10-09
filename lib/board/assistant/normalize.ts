/**
 * Board assistant — validation of the model's raw draft. PURE (no DB, no network), unit-tested.
 *
 * The model is never trusted with facts. Whatever it returns is checked against the two things we actually know:
 *   1. the secretary's NOTES (the only source of truth for content): every item must quote the notes, and the quote must really be in them;
 *   2. the meeting CONTEXT (agenda ids, member list, meeting date).
 * Hard rules (ACTA contract — the assistant never invents an owner or a deadline):
 *   - an owner is kept only if it is a real member id AND that member's name (full name or a distinctive part of it) appears in the notes;
 *   - a deadline is kept only if it parses, is not before the meeting day, and its day + month are written in the item's own quote;
 *   anything dropped stays visible as a hint + a warning, so the secretary decides.
 */
import { parseJalali, toEnDigits, toJalaali } from "@/lib/jalali";

export type DraftContext = {
  meetingDate: string;                                       // Tehran calendar date YYYY-MM-DD
  agenda: { id: string; position: number; title: string }[];
  members: { id: string; full_name: string; position_title: string | null }[];
};

export type RawDraft = {
  general_notes?: unknown;
  remaining_topics?: unknown;
  agenda?: unknown;
  resolutions?: unknown;
  warnings?: unknown;
};

export type SuggestedAgenda = {
  key: string;                    // "a0", "a1", … (stable within one suggestion)
  agenda_item_id: string | null;  // existing item, or null = a NEW agenda item
  title: string;
  discussion: string;
  quote: string;
  quote_found: boolean;
};

export type SuggestedResolution = {
  key: string;                    // "r0", …
  agenda_item_id: string | null;  // existing item
  agenda_key: string | null;      // a NEW agenda item of this same suggestion
  text: string;
  requires_action: boolean;
  owner_member_id: string | null;
  owner_hint: string | null;      // what the notes said about the owner, when not resolvable to a member
  due_date: string | null;        // ISO YYYY-MM-DD
  due_hint: string | null;
  expected_output: string | null;
  vote_note: string | null;
  quote: string;
  quote_found: boolean;
};

export type BoardSuggestion = {
  version: 1;
  general_notes: string | null;
  remaining_topics: string | null;
  agenda: SuggestedAgenda[];
  resolutions: SuggestedResolution[];
  warnings: string[];
};

const MAX_AGENDA = 30;
const MAX_RESOLUTIONS = 50;

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\u0000/g, "").trim();
  return t ? t.slice(0, max) : null;
};
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);

/** Normalises Persian text for matching: Arabic ي/ك → ی/ک, digits → Latin, ZWNJ / tatweel / diacritics removed, whitespace collapsed. */
export function normalizeFa(s: string): string {
  return toEnDigits(s)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ة]/g, "ه")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/‌/g, " ")
    .replace(/[«»"“”'‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The quote really appears in the notes (normalised; at least 6 characters, so an empty or one-word "quote" proves nothing). */
export function quoteInNotes(notes: string, quote: string | null): boolean {
  if (!quote) return false;
  const q = normalizeFa(quote);
  return q.length >= 6 && normalizeFa(notes).includes(q);
}

/** A member is "named" in the notes when their full name, or a part of it of 3+ letters that no other member shares, appears in them. */
export function memberNamedInNotes(notes: string, member: { full_name: string }, all: { full_name: string }[]): boolean {
  const n = ` ${normalizeFa(notes)} `;
  const full = normalizeFa(member.full_name);
  if (full && n.includes(full)) return true;
  const others = all.filter((m) => m.full_name !== member.full_name).map((m) => normalizeFa(m.full_name));
  return full.split(" ").filter((p) => p.length >= 3 && !["آقای", "خانم", "دکتر", "مهندس"].includes(p))
    .some((part) => n.includes(` ${part} `) && !others.some((o) => o.split(" ").includes(part)));
}

const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

/** The deadline's own day + month are written in the quote (as digits, or the Persian month name). */
export function dueWrittenInQuote(isoDate: string, quote: string): boolean {
  const [gy, gm, gd] = isoDate.split("-").map(Number);
  const { jm, jd } = toJalaali(gy, gm, gd);
  const q = normalizeFa(quote);
  const hasDay = new RegExp(`(^|[^0-9])0?${jd}([^0-9]|$)`).test(q);
  const hasMonth = q.includes(normalizeFa(MONTHS[jm - 1])) || new RegExp(`(^|[^0-9])0?${jm}[/\\-.]`).test(q) || new RegExp(`[/\\-.]0?${jm}([^0-9]|$)`).test(q);
  return hasDay && hasMonth;
}

export function normalizeDraft(raw: RawDraft, notes: string, ctx: DraftContext): BoardSuggestion {
  const warnings: string[] = (Array.isArray(raw.warnings) ? raw.warnings : []).map((w) => str(w, 300)).filter((w): w is string => !!w).slice(0, 20);
  const agendaIds = new Set(ctx.agenda.map((a) => a.id));
  const memberById = new Map(ctx.members.map((m) => [m.id, m]));

  const agenda: SuggestedAgenda[] = [];
  const rawAgenda = arr(raw.agenda).slice(0, MAX_AGENDA);
  const newIndexToKey = new Map<number, string>();
  rawAgenda.forEach((a, i) => {
    const existing = typeof a.agenda_item_id === "string" && agendaIds.has(a.agenda_item_id) ? a.agenda_item_id : null;
    const title = existing ? ctx.agenda.find((x) => x.id === existing)!.title : str(a.new_title ?? a.title, 500);
    const discussion = str(a.discussion, 20000);
    if (!title || !discussion) return;
    const quote = str(a.source_quote, 2000) ?? "";
    const key = `a${agenda.length}`;
    if (!existing) newIndexToKey.set(i, key);
    agenda.push({ key, agenda_item_id: existing, title, discussion, quote, quote_found: quoteInNotes(notes, quote) });
  });

  const resolutions: SuggestedResolution[] = [];
  for (const r of arr(raw.resolutions).slice(0, MAX_RESOLUTIONS)) {
    const text = str(r.text, 10000);
    if (!text) continue;
    const quote = str(r.source_quote, 2000) ?? "";
    const quoteFound = quoteInNotes(notes, quote);
    const label = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    const requiresAction = r.requires_action !== false;

    // agenda link: an existing id, or the index of a NEW agenda item in this same draft
    let agendaItemId: string | null = null;
    let agendaKey: string | null = null;
    if (typeof r.agenda_item_id === "string" && agendaIds.has(r.agenda_item_id)) agendaItemId = r.agenda_item_id;
    else if (typeof r.new_agenda_index === "number" && newIndexToKey.has(r.new_agenda_index)) agendaKey = newIndexToKey.get(r.new_agenda_index)!;

    // owner: a real member AND named in the notes — otherwise only a hint
    let owner: string | null = null;
    let ownerHint = str(r.owner_name_in_notes, 200);
    if (requiresAction && typeof r.owner_member_id === "string") {
      const m = memberById.get(r.owner_member_id);
      if (m && memberNamedInNotes(notes, m, ctx.members)) owner = m.id;
      else {
        ownerHint = ownerHint ?? (m ? m.full_name : null);
        warnings.push(`مسئول «${label}» در یادداشت‌ها با نام عضو مشخص نشده بود؛ خودتان انتخاب کنید.`);
      }
    }

    // deadline: parses, not before the meeting day, and written in the item's own quote — otherwise only a hint
    let due: string | null = null;
    let dueHint = str(r.due_hint, 200);
    const dueRaw = str(r.due_date_jalali, 20);
    if (requiresAction && dueRaw) {
      const iso = parseJalali(dueRaw);
      if (iso && iso >= ctx.meetingDate && iso <= `${Number(ctx.meetingDate.slice(0, 4)) + 3}${ctx.meetingDate.slice(4)}` && quoteFound && dueWrittenInQuote(iso, quote)) due = iso;
      else {
        dueHint = dueHint ?? dueRaw;
        warnings.push(`مهلت «${label}» صریح یا معتبر نبود؛ خودتان تعیین کنید.`);
      }
    }
    if (!quoteFound) warnings.push(`برای «${label}» متن پشتیبان در یادداشت‌ها پیدا نشد؛ با دقت بیشتری بررسی کنید.`);

    resolutions.push({
      key: `r${resolutions.length}`,
      agenda_item_id: agendaItemId,
      agenda_key: agendaKey,
      text,
      requires_action: requiresAction,
      owner_member_id: owner,
      owner_hint: requiresAction ? ownerHint : null,
      due_date: due,
      due_hint: requiresAction ? dueHint : null,
      expected_output: requiresAction ? str(r.expected_output, 1000) : null,
      vote_note: str(r.vote_note, 2000),
      quote,
      quote_found: quoteFound,
    });
  }
  for (const a of agenda) if (!a.quote_found) warnings.push(`برای مذاکرات «${a.title.slice(0, 40)}» متن پشتیبان در یادداشت‌ها پیدا نشد.`);

  return {
    version: 1,
    general_notes: str(raw.general_notes, 20000),
    remaining_topics: str(raw.remaining_topics, 5000),
    agenda,
    resolutions,
    warnings: [...new Set(warnings)].slice(0, 40),
  };
}
