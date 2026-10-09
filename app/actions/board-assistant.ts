"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { boardAccess } from "@/lib/board/types";
import type { Profile } from "@/lib/types/database";
import { draftMinutesFromNotes, loadDraftContext, MAX_NOTES_CHARS } from "@/lib/board/assistant/draft";
import type { BoardSuggestion } from "@/lib/board/assistant/normalize";

/**
 * Board assistant (Phase 3) — web side. Generate = notes → validated suggestion stored in board_ai_drafts (nothing written to the minutes).
 * Apply = the TICKED items only, in one transaction (board_apply_ai_draft, 0151). Discard = mark the suggestion as rejected.
 */
export type AssistantActionState = { error?: string; ok?: boolean; message?: string } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role, board_role").eq("id", user.id).maybeSingle();
  return { supabase, userId: user.id, access: boardAccess((profile ?? { role: "USER", board_role: null }) as Pick<Profile, "role" | "board_role">) };
}
const uuid = z.string().uuid();
const meetingPath = (id: string) => `/board/meetings/${id}`;

export async function generateBoardDraft(_p: AssistantActionState, f: FormData): Promise<AssistantActionState> {
  const meetingId = uuid.safeParse(f.get("meeting_id"));
  const notes = String(f.get("notes") ?? "").trim();
  if (!meetingId.success) return { error: "ورودی نامعتبر است." };
  if (!notes) return { error: "یادداشت‌های جلسه را وارد کنید." };
  if (notes.length > MAX_NOTES_CHARS) return { error: "یادداشت‌ها بیش از حد طولانی است؛ در چند بخش بفرستید." };
  const { supabase, userId, access } = await ctx();
  if (!access.create) return { error: "برای استفاده از دستیار به دسترسی «تهیهٔ پیش‌نویس» هیئت‌مدیره نیاز دارید." };   // before spending tokens
  const context = await loadDraftContext(supabase, meetingId.data);
  if (!context) return { error: "جلسه یافت نشد." };
  if (context.status !== "DRAFT") return { error: "این صورت‌جلسه تأیید و قفل شده است." };

  const r = await draftMinutesFromNotes({ notes, ctx: context, usageClient: supabase, profileId: userId, channel: "WEB" });
  if (!r.ok) return { error: r.error };
  const { error } = await supabase.from("board_ai_drafts").insert({
    meeting_id: meetingId.data, source: "WEB", notes, suggestion: r.suggestion, model: r.model,
    input_tokens: r.inputTokens, output_tokens: r.outputTokens, created_by: userId,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(meetingPath(meetingId.data));
  return { ok: true, message: "پیشنهاد دستیار آماده شد؛ موارد را بررسی و انتخاب کنید." };
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Builds the RPC payload from the stored suggestion + the person's choices. Never trusts item content from the browser — only the ticks,
 *  the owner / deadline the person chose, and an edited resolution text. */
export async function applyBoardDraft(_p: AssistantActionState, f: FormData): Promise<AssistantActionState> {
  const draftId = uuid.safeParse(f.get("draft_id"));
  if (!draftId.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { data: d } = await supabase.from("board_ai_drafts").select("id, meeting_id, status, suggestion").eq("id", draftId.data).maybeSingle();
  if (!d) return { error: "پیشنهاد یافت نشد." };
  if (d.status !== "PENDING") return { error: "این پیشنهاد قبلاً اعمال یا رد شده است." };
  const s = d.suggestion as BoardSuggestion;
  const on = (k: string) => f.get(k) === "on";

  const newAgenda = s.agenda.filter((a) => !a.agenda_item_id && on(`agenda_${a.key}`)).map((a) => ({ key: a.key, title: a.title, discussion: a.discussion }));
  const discussions = s.agenda.filter((a) => a.agenda_item_id && on(`agenda_${a.key}`)).map((a) => ({ agenda_item_id: a.agenda_item_id, discussion: a.discussion }));
  const chosenNewKeys = new Set(newAgenda.map((a) => a.key));

  const resolutions: Record<string, unknown>[] = [];
  const missing: string[] = [];
  for (const r of s.resolutions) {
    if (!on(`res_${r.key}`)) continue;
    const text = String(f.get(`res_${r.key}_text`) ?? r.text).trim().slice(0, 10000) || r.text;
    const owner = String(f.get(`res_${r.key}_owner`) ?? "");
    const due = String(f.get(`res_${r.key}_due`) ?? "");
    const ownerOk = uuid.safeParse(owner).success;
    const dueOk = isoDate.test(due);
    if (r.requires_action && (!ownerOk || !dueOk)) missing.push(text.length > 40 ? `${text.slice(0, 40)}…` : text);
    resolutions.push({
      agenda_item_id: r.agenda_item_id,
      agenda_key: r.agenda_key && chosenNewKeys.has(r.agenda_key) ? r.agenda_key : null,
      text,
      requires_action: r.requires_action,
      owner_member_id: r.requires_action && ownerOk ? owner : null,
      due_date: r.requires_action && dueOk ? due : null,
      expected_output: r.expected_output,
      vote_note: r.vote_note,
    });
  }
  if (missing.length) return { error: `برای این مصوبات اجرایی، مسئول و مهلت را مشخص کنید: ${missing.join("، ")}` };
  const general = on("apply_general") ? s.general_notes : null;
  const remaining = on("apply_remaining") ? s.remaining_topics : null;
  if (!newAgenda.length && !discussions.length && !resolutions.length && !general && !remaining) return { error: "هیچ موردی انتخاب نشده است." };

  const { error } = await supabase.rpc("board_apply_ai_draft", {
    p_draft: d.id, p_general: general, p_remaining: remaining, p_new_agenda: newAgenda, p_discussions: discussions, p_resolutions: resolutions,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(meetingPath(d.meeting_id as string));
  return { ok: true, message: "موارد انتخاب‌شده به پیش‌نویس صورت‌جلسه اضافه شد." };
}

export async function discardBoardDraft(_p: AssistantActionState, f: FormData): Promise<AssistantActionState> {
  const draftId = uuid.safeParse(f.get("draft_id"));
  if (!draftId.success) return { error: "ورودی نامعتبر است." };
  const { supabase, userId } = await ctx();
  const { data, error } = await supabase
    .from("board_ai_drafts")
    .update({ status: "DISCARDED", decided_at: new Date().toISOString(), decided_by: userId })
    .eq("id", draftId.data)
    .eq("status", "PENDING")
    .select("meeting_id");
  if (error) return { error: persianError(error.message) };
  if (!data?.length) return { error: "این پیشنهاد قبلاً اعمال یا رد شده است." };
  revalidatePath(meetingPath(data[0].meeting_id as string));
  return { ok: true };
}
