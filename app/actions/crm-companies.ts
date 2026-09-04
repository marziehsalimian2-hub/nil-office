"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { companyCrmSchema } from "@/lib/validation-crm";
import { companySchema } from "@/lib/validation";

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

/** Update a company's base (pre-CRM) fields — legal_name/english_name/etc. */
export async function updateCompanyBase(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه شرکت نامعتبر است." };

  const parsed = companySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { supabase } = await ctx();
  const { error } = await supabase.from("companies").update(parsed.data).eq("id", id);
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/companies/${id}`);
  return null;
}

/** Update a company's CRM status/owner/roles — the only write path for those fields (goes through set_company_crm, see 0043). */
export async function updateCompanyCrm(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه شرکت نامعتبر است." };

  const roles = f.getAll("roles").map(String);
  const parsed = companyCrmSchema.safeParse({
    crm_status: f.get("crm_status"),
    owner_user_id: f.get("owner_user_id") ?? "",
    roles,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { supabase } = await ctx();
  const { error } = await supabase.rpc("set_company_crm", {
    p_company_id: id,
    p_crm_status: parsed.data.crm_status,
    p_owner_user_id: parsed.data.owner_user_id ?? null,
    p_roles: parsed.data.roles,
  });
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
  return null;
}
