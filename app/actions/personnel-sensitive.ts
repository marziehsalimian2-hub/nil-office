"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { persianError } from "@/lib/enums";
import { personnelSensitiveSchema } from "@/lib/validation-personnel";

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

/**
 * ADMIN-tier only (confidential identity-document fields — spec §10).
 * RLS (0112_personnel_rls.sql) already refuses this for a non-admin at
 * the DB level; this inline check exists so a non-admin gets a clear
 * Persian message instead of a raw 42501-derived one — same belt-and-
 * suspenders shape as setInternalCostRate (app/actions/internal-cost-rates.ts).
 */
export async function updatePersonnelSensitive(_p: ActionState, f: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  const isAdmin = profile.role === "ADMIN" || profile.hr_role === "ADMIN";
  if (!isAdmin) return { error: "این بخش فقط برای مدیر منابع انسانی در دسترس است." };

  const personnelId = String(f.get("personnel_id") ?? "");
  if (!personnelId) return { error: "شناسهٔ پرسنل نامعتبر است." };
  const parsed = personnelSensitiveSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { supabase, userId } = await ctx();
  const { error } = await supabase.from("personnel_sensitive_details").upsert({
    personnel_id: personnelId,
    national_id: parsed.data.national_id ?? null,
    passport_number: parsed.data.passport_number ?? null,
    birth_date: parsed.data.birth_date ?? null,
    emergency_contact: parsed.data.emergency_contact ?? null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/personnel/${personnelId}`);
  return null;
}
