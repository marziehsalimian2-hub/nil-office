"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { deliverableSchema, rejectDeliverableSchema } from "@/lib/validation-projects";

export type ActionState = { error?: string } | null;

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}
const entries = (f: FormData) => Object.fromEntries(f.entries());

/** Simple (non-RPC) status transitions a plain update may perform. */
const SIMPLE_TRANSITIONS: Record<string, string[]> = {
  PLANNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["READY_FOR_REVIEW", "CANCELLED"],
  READY_FOR_REVIEW: ["CANCELLED"],
  REJECTED: ["IN_PROGRESS", "CANCELLED"],
};

function deliverablePayload(d: ReturnType<typeof deliverableSchema.parse>) {
  return {
    project_id: d.project_id,
    phase_id: d.phase_id ?? null,
    milestone_id: d.milestone_id ?? null,
    title: d.title,
    description: d.description ?? null,
    due_date: d.due_date ?? null,
    responsible_user_id: d.responsible_user_id ?? null,
  };
}

export async function createDeliverable(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = deliverableSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase.from("project_deliverables").insert({ ...deliverablePayload(parsed.data), created_by: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return null;
}

/** Update editable fields — blocked once ACCEPTED (enforced by the DB trigger too). */
export async function updateDeliverable(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه تحویل‌دادنی نامعتبر است." };
  const parsed = deliverableSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();

  const { data: current } = await supabase.from("project_deliverables").select("status").eq("id", id).single();
  if (!current) return { error: "تحویل‌دادنی یافت نشد." };
  if (current.status === "ACCEPTED") return { error: "این تحویل‌دادنی پذیرفته‌شده و قابل ویرایش نیست." };

  const { error } = await supabase.from("project_deliverables").update(deliverablePayload(parsed.data)).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/projects/${parsed.data.project_id}`);
  return null;
}

export async function setDeliverableStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const status = String(f.get("status") ?? "");
  const projectId = String(f.get("project_id") ?? "");
  const { supabase } = await ctx();

  const { data: current } = await supabase.from("project_deliverables").select("status").eq("id", id).single();
  if (!current) return { error: "تحویل‌دادنی یافت نشد." };
  if (!(SIMPLE_TRANSITIONS[current.status] ?? []).includes(status)) {
    return { error: "تغییر وضعیت در این مرحله مجاز نیست." };
  }

  const { error } = await supabase.from("project_deliverables").update({ status }).eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return null;
}

export async function acceptDeliverable(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const projectId = String(f.get("project_id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("accept_deliverable", { p_id: id });
  if (error) return { error: persianError(error.message) };
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return null;
}

export async function rejectDeliverable(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const projectId = String(f.get("project_id") ?? "");
  const parsed = rejectDeliverableSchema.safeParse({ reason: f.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("reject_deliverable", { p_id: id, p_reason: parsed.data.reason });
  if (error) return { error: persianError(error.message) };
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return null;
}

export async function deleteDeliverable(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const projectId = String(f.get("project_id") ?? "");
  if (!id) return { error: "شناسه تحویل‌دادنی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("project_deliverables").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return null;
}
