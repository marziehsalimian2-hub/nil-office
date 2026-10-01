"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { employmentRecordSchema, personnelStatusChangeSchema } from "@/lib/validation-personnel";

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

/** Opens a new Employment Record, atomically closing the current one (create_employment_record RPC, 0111). */
export async function createEmploymentRecord(_p: ActionState, f: FormData): Promise<ActionState> {
  const personnelId = String(f.get("personnel_id") ?? "");
  if (!personnelId) return { error: "شناسهٔ پرسنل نامعتبر است." };
  const parsed = employmentRecordSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("create_employment_record", {
    p_personnel_id: personnelId,
    p_employment_type: d.employment_type,
    p_job_title: d.job_title,
    p_department: d.department ?? null,
    p_manager_personnel_id: d.manager_personnel_id ?? null,
    p_start_date: d.start_date,
    p_work_schedule_type: d.work_schedule_type ?? null,
    p_standard_monthly_hours: d.standard_monthly_hours ?? null,
    p_standard_weekly_hours: d.standard_weekly_hours ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/personnel/${personnelId}`);
  return null;
}

/** The only sanctioned way employment_status ever changes (change_personnel_status RPC, 0111) — validates the transition graph, gates TERMINATED/ARCHIVED/rehire at ADMIN tier, and (for rehire) atomically opens a new employment record. */
export async function changePersonnelStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const personnelId = String(f.get("personnel_id") ?? "");
  if (!personnelId) return { error: "شناسهٔ پرسنل نامعتبر است." };
  const parsed = personnelStatusChangeSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("change_personnel_status", {
    p_personnel_id: personnelId,
    p_new_status: d.new_status,
    p_reason: d.reason ?? null,
    p_effective_date: d.effective_date ?? undefined,
    p_employment_type: d.employment_type ?? null,
    p_job_title: d.job_title ?? null,
    p_department: d.department ?? null,
    p_manager_personnel_id: d.manager_personnel_id ?? null,
    p_work_schedule_type: d.work_schedule_type ?? null,
    p_standard_monthly_hours: d.standard_monthly_hours ?? null,
    p_standard_weekly_hours: d.standard_weekly_hours ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/personnel/${personnelId}`);
  return null;
}
