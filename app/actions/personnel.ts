"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { onboardPersonnelSchema, personnelEditSchema, hrRoleSchema } from "@/lib/validation-personnel";

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

/** Creates a Personnel row + its first Employment Record in one transaction (onboard_personnel RPC, 0111). */
export async function onboardPersonnel(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = onboardPersonnelSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { data, error } = await supabase.rpc("onboard_personnel", {
    p_first_name: d.first_name,
    p_last_name: d.last_name,
    p_hire_date: d.hire_date,
    p_job_title: d.job_title,
    p_employment_type: d.employment_type,
    p_department: d.department ?? null,
    p_manager_personnel_id: d.manager_personnel_id ?? null,
    p_work_location: d.work_location ?? null,
    p_work_schedule_type: d.work_schedule_type ?? null,
    p_standard_monthly_hours: d.standard_monthly_hours ?? null,
    p_standard_weekly_hours: d.standard_weekly_hours ?? null,
    p_mobile: d.mobile ?? null,
    p_email: d.email ?? null,
    p_address: d.address ?? null,
    p_notes: d.notes ?? null,
    p_profile_id: d.profile_id ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/personnel");
  redirect(`/personnel/${data.id}`);
}

/** Plain field edit — mutable-only fields (name/contact/notes/hire_date). RLS's frozen-column WITH CHECK (0112) is the real backstop against touching the denormalized snapshot or controlled-path-only columns. */
export async function updatePersonnel(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسهٔ پرسنل نامعتبر است." };
  const parsed = personnelEditSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("personnel").update(parsed.data).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/personnel/${id}`);
  return null;
}

export async function setHrRole(_p: ActionState, f: FormData): Promise<ActionState> {
  const raw = { user_id: f.get("user_id"), hr_role: f.get("hr_role") || null };
  const parsed = hrRoleSchema.safeParse(raw);
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("profiles")
    .update({ hr_role: parsed.data.hr_role ?? null })
    .eq("id", parsed.data.user_id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}
