"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { partySchema } from "@/lib/validation-crm";

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

export async function addParty(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = partySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.from("crm_opportunity_parties").insert({
    opportunity_id: d.opportunity_id,
    company_id: d.company_id,
    contact_id: d.contact_id ?? null,
    role: d.role,
    notes: d.notes ?? null,
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/opportunities/${d.opportunity_id}`);
  return null;
}

export async function removeParty(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const opportunityId = String(f.get("opportunity_id") ?? "");
  if (!id) return { error: "شناسه نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase.from("crm_opportunity_parties").delete().eq("id", id);
  if (error) return { error: persianError(error.message) };
  if (opportunityId) revalidatePath(`/opportunities/${opportunityId}`);
  return null;
}
