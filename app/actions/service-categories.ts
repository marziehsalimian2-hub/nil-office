"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { serviceCategorySchema } from "@/lib/validation-service-ledger";

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

/** Admin-extensible lookup, mirrors createContractType (app/actions/contracts.ts) exactly. */
export async function createServiceCategory(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = serviceCategorySchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const { error } = await supabase.from("service_categories").insert(parsed.data);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/service-ledger/categories");
  redirect("/service-ledger/categories");
}
