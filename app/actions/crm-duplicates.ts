"use server";

import { createClient } from "@/lib/supabase/server";

export type SimilarCompany = {
  id: string;
  legal_name: string;
  english_name: string | null;
  email: string | null;
  phone: string | null;
  score: number;
};

export type SimilarContact = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  score: number;
};

/** Advisory-only duplicate check — never blocks submission (spec §29). */
export async function checkSimilarCompanies(legalName: string, email?: string, phone?: string): Promise<SimilarCompany[]> {
  if (!legalName?.trim()) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("find_similar_companies", {
    p_legal_name: legalName,
    p_email: email || null,
    p_phone: phone || null,
  });
  return (data ?? []) as SimilarCompany[];
}

/** Advisory-only duplicate check, scoped to one company (spec §30). */
export async function checkSimilarContacts(companyId: string, email?: string, mobile?: string): Promise<SimilarContact[]> {
  if (!companyId || (!email?.trim() && !mobile?.trim())) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("find_similar_contacts", {
    p_company_id: companyId,
    p_email: email || null,
    p_mobile: mobile || null,
  });
  return (data ?? []) as SimilarContact[];
}
