"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { clientServiceFileSchema, serviceLedgerRoleSchema } from "@/lib/validation-service-ledger";

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

/** Opens the Client Service File for a company — one per company (unique constraint), created lazily the first time someone opens the "خدمات" tab and clicks "شروع پروندهٔ خدمات". */
export async function createClientServiceFile(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = clientServiceFileSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { error } = await supabase.from("client_service_files").insert({ ...parsed.data, created_by: userId });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/companies/${parsed.data.company_id}`);
  return null;
}

export async function updateClientServiceFile(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const companyId = String(f.get("company_id") ?? "");
  if (!id) return { error: "شناسهٔ پروندهٔ خدمات نامعتبر است." };
  const parsed = clientServiceFileSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { status, relationship_manager, default_currency, notes } = parsed.data;
  const { error } = await supabase
    .from("client_service_files")
    .update({
      status,
      relationship_manager: relationship_manager ?? null,
      default_currency,
      notes: notes ?? null,
      closed_at: status === "CLOSED" || status === "ARCHIVED" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/companies/${companyId}`);
  return null;
}

/* ------------------------------- settings --------------------------------- */
export async function setServiceLedgerRole(_p: ActionState, f: FormData): Promise<ActionState> {
  const raw = { user_id: f.get("user_id"), service_ledger_role: f.get("service_ledger_role") || null };
  const parsed = serviceLedgerRoleSchema.safeParse(raw);
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("profiles")
    .update({ service_ledger_role: parsed.data.service_ledger_role ?? null })
    .eq("id", parsed.data.user_id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}
