import { createClient } from "@/lib/supabase/server";
import type { Company, Case, Profile } from "@/lib/types/database";

/** Option lists used by correspondence / document / case forms. */
export async function loadFormOptions() {
  const supabase = await createClient();
  const [companies, cases, profiles] = await Promise.all([
    supabase.from("companies").select("id, legal_name").order("legal_name"),
    supabase.from("cases").select("id, case_code, title").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);
  return {
    companies: (companies.data ?? []) as Pick<Company, "id" | "legal_name">[],
    cases: (cases.data ?? []) as Pick<Case, "id" | "case_code" | "title">[],
    profiles: (profiles.data ?? []) as Pick<Profile, "id" | "full_name">[],
  };
}
