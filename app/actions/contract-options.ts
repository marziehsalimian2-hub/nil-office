import { createClient } from "@/lib/supabase/server";
import type { Company, Case, Profile, ContractType } from "@/lib/types/database";

/** Option lists used by the contract create/edit forms. */
export async function loadContractOptions() {
  const supabase = await createClient();
  const [types, companies, cases, profiles] = await Promise.all([
    supabase.from("contract_types").select("id, code, label_fa").eq("is_active", true).order("sort_order"),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
    supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);
  return {
    types: (types.data ?? []) as Pick<ContractType, "id" | "code" | "label_fa">[],
    companies: (companies.data ?? []) as Pick<Company, "id" | "legal_name">[],
    cases: (cases.data ?? []) as Pick<Case, "id" | "case_code" | "title">[],
    profiles: (profiles.data ?? []) as Pick<Profile, "id" | "full_name">[],
  };
}
