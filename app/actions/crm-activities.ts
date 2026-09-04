"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { activitySchema } from "@/lib/validation-crm";

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

export async function createActivity(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = activitySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.from("crm_activities").insert({
    company_id: d.company_id,
    contact_id: d.contact_id ?? null,
    opportunity_id: d.opportunity_id ?? null,
    case_id: d.case_id ?? null,
    activity_type: d.activity_type,
    activity_date: d.activity_date ?? new Date().toISOString(),
    subject: d.subject,
    summary: d.summary ?? null,
    direction: d.direction,
    responsible_user_id: d.responsible_user_id ?? userId,
    next_action: d.next_action ?? null,
    next_action_date: d.next_action_date ?? null,
    created_by: userId,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/companies/${d.company_id}`);
  if (d.opportunity_id) revalidatePath(`/opportunities/${d.opportunity_id}`);
  return null;
}

export async function updateActivity(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه فعالیت نامعتبر است." };
  const parsed = activitySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase
    .from("crm_activities")
    .update({
      contact_id: d.contact_id ?? null,
      opportunity_id: d.opportunity_id ?? null,
      case_id: d.case_id ?? null,
      activity_type: d.activity_type,
      activity_date: d.activity_date ?? undefined,
      subject: d.subject,
      summary: d.summary ?? null,
      direction: d.direction,
      responsible_user_id: d.responsible_user_id ?? null,
      next_action: d.next_action ?? null,
      next_action_date: d.next_action_date ?? null,
    })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/companies/${d.company_id}`);
  if (d.opportunity_id) revalidatePath(`/opportunities/${d.opportunity_id}`);
  return null;
}

export async function deleteActivity(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const companyId = String(f.get("company_id") ?? "");
  if (!id) return { error: "شناسه فعالیت نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("crm_activities").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}
