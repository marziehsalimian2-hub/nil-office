"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { persianError } from "@/lib/enums";
import { internalCostRateSchema } from "@/lib/validation-service-ledger";

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
 * Admin-only (confidential — spec §11: "این اطلاعات محرمانه است"). RLS
 * (0086_service_ledger_rls.sql) already refuses this for a non-admin at
 * the DB level; this inline check exists so a non-admin gets a clear
 * Persian message instead of a raw 42501-derived one.
 */
export async function setInternalCostRate(_p: ActionState, f: FormData): Promise<ActionState> {
  const profile = await requireProfile();
  const isAdmin = profile.role === "ADMIN" || profile.service_ledger_role === "ADMIN";
  if (!isAdmin) return { error: "این بخش فقط برای مدیر خدمات مشتری در دسترس است." };

  const parsed = internalCostRateSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase
    .from("internal_cost_rates")
    .upsert({ ...parsed.data, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/service-ledger/cost-rates");
  return null;
}
