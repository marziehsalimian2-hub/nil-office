"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { outgoingSchema, incomingSchema } from "@/lib/validation";
import { persianError } from "@/lib/enums";
import { currentJalaliYear } from "@/lib/jalali";

export type ActionState = { error?: string } | null;

async function currentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

function fd(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

/** Create an outgoing letter as DRAFT or REVIEW (no number issued yet). */
export async function createOutgoing(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = outgoingSchema.safeParse(fd(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است." };
  }
  const submit = String(formData.get("_submit") ?? "draft");
  const status = submit === "review" ? "REVIEW" : "DRAFT";

  const { supabase, userId } = await currentUserId();
  const { data, error } = await supabase
    .from("correspondence")
    .insert({
      ...parsed.data,
      direction: "OUTGOING",
      status,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) return { error: persianError(error.message) };
  revalidatePath("/correspondence/outgoing");
  redirect(`/correspondence/${data.id}`);
}

/** Atomically finalize an outgoing letter and issue its official number. */
export async function finalizeOutgoing(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "شناسه نامه نامعتبر است." };
  const { supabase } = await currentUserId();

  const { error } = await supabase.rpc("finalize_correspondence", {
    p_letter_id: id,
    p_year: currentJalaliYear(),
  });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/correspondence/${id}`);
  revalidatePath("/correspondence/outgoing");
  return null;
}

/** Move a draft to REVIEW. */
export async function sendForReview(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { supabase } = await currentUserId();
  const { error } = await supabase
    .from("correspondence")
    .update({ status: "REVIEW" })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/correspondence/${id}`);
  return null;
}

/** Register an incoming letter and assign its registration number atomically. */
export async function createIncoming(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = incomingSchema.safeParse(fd(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است." };
  }
  const { supabase, userId } = await currentUserId();

  const { sent_received_at, ...rest } = parsed.data;
  const { data, error } = await supabase
    .from("correspondence")
    .insert({
      ...rest,
      sent_received_at: sent_received_at ? new Date(sent_received_at).toISOString() : null,
      direction: "INCOMING",
      status: "DRAFT",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  const { error: rpcError } = await supabase.rpc("register_incoming", {
    p_letter_id: data.id,
    p_year: currentJalaliYear(),
  });
  if (rpcError) {
    // Row exists but numbering failed — surface clearly; record stays as draft.
    return { error: persianError(rpcError.message) };
  }

  revalidatePath("/correspondence/incoming");
  redirect(`/correspondence/${data.id}`);
}

/** Create an outgoing draft in reply to an incoming letter and link them. */
export async function createReplyDraft(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const incomingId = String(formData.get("incoming_id") ?? "");
  if (!incomingId) return { error: "شناسه نامه نامعتبر است." };
  const { supabase, userId } = await currentUserId();

  const { data: src } = await supabase
    .from("correspondence")
    .select("subject, case_id, sender_company_id")
    .eq("id", incomingId)
    .single();

  const { data: reply, error } = await supabase
    .from("correspondence")
    .insert({
      direction: "OUTGOING",
      status: "DRAFT",
      created_by: userId,
      subject: src?.subject ? `پاسخ: ${src.subject}` : null,
      case_id: src?.case_id ?? null,
      recipient_company_id: src?.sender_company_id ?? null,
      requires_response: false,
    })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  await supabase.from("correspondence_links").insert({
    from_correspondence_id: reply.id,
    to_correspondence_id: incomingId,
    relation_type: "REPLY_TO",
    created_by: userId,
  });

  revalidatePath(`/correspondence/${incomingId}`);
  redirect(`/correspondence/${reply.id}`);
}

/** Cancel a numbered letter (keeps the number, marks CANCELLED). */
export async function cancelLetter(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const { supabase } = await currentUserId();
  const { error } = await supabase.rpc("cancel_correspondence", { p_letter_id: id });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/correspondence/${id}`);
  return null;
}

/** Advance simple status transitions (SENT / WAITING_RESPONSE / CLOSED …). */
export async function setStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const { supabase } = await currentUserId();
  const patch: Record<string, unknown> = { status };
  if (status === "SENT") patch.sent_received_at = new Date().toISOString();
  const { error } = await supabase.from("correspondence").update(patch).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/correspondence/${id}`);
  return null;
}
