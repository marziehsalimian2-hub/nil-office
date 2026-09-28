"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { serviceArrangementSchema } from "@/lib/validation-service-ledger";

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

export async function createServiceArrangement(_p: ActionState, f: FormData): Promise<ActionState> {
  const companyId = String(f.get("company_id") ?? "");
  const parsed = serviceArrangementSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase.from("service_arrangements").insert({ ...parsed.data, created_by: userId });
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}

export async function updateServiceArrangement(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const companyId = String(f.get("company_id") ?? "");
  if (!id) return { error: "شناسهٔ قرارداد خدمات نامعتبر است." };
  const parsed = serviceArrangementSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("service_arrangements").update(parsed.data).eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (companyId) revalidatePath(`/companies/${companyId}`);
  return null;
}
