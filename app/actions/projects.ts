"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { currentJalaliYear } from "@/lib/jalali";
import { projectSchema, projectRoleSchema } from "@/lib/validation-projects";

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

/** Simple (non-numbering) status transitions a plain update may perform. */
const SIMPLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["CANCELLED"],
  PLANNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "CANCELLED"],
  COMPLETED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
};

function projectPayload(d: ReturnType<typeof projectSchema.parse>) {
  return {
    title: d.title,
    description: d.description ?? null,
    project_type: d.project_type,
    company_id: d.company_id ?? null,
    case_id: d.case_id ?? null,
    crm_opportunity_id: d.crm_opportunity_id ?? null,
    contract_id: d.contract_id ?? null,
    project_manager_id: d.project_manager_id,
    owner_user_id: d.owner_user_id ?? null,
    priority: d.priority,
    planned_start_date: d.planned_start_date ?? null,
    planned_end_date: d.planned_end_date ?? null,
    actual_start_date: d.actual_start_date ?? null,
    actual_end_date: d.actual_end_date ?? null,
    progress_percent: d.progress_percent,
    budget_amount: d.budget_amount ?? null,
    budget_currency: d.budget_currency ?? null,
  };
}

/** Create a project as DRAFT — no number is issued until it is finalized (planned). */
export async function createProjectDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = projectSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, userId } = await ctx();
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...projectPayload(parsed.data), status: "DRAFT", created_by: userId })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };
  revalidatePath("/projects");
  redirect(`/projects/${data.id}`);
}

/** Update a project's editable fields — only while DRAFT or PLANNED. */
export async function updateProjectDraft(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  if (!id) return { error: "شناسه پروژه نامعتبر است." };
  const parsed = projectSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { supabase } = await ctx();
  const { data: current } = await supabase.from("projects").select("status").eq("id", id).single();
  if (!current || !["DRAFT", "PLANNED"].includes(current.status)) {
    return { error: "این پروژه دیگر قابل ویرایش نیست." };
  }

  const { error } = await supabase.from("projects").update(projectPayload(parsed.data)).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/projects/${id}`);
  return null;
}

/** Advance a simple (non-numbering) status transition. */
export async function setProjectStatus(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const status = String(f.get("status") ?? "");
  const { supabase } = await ctx();

  const { data: current } = await supabase.from("projects").select("status").eq("id", id).single();
  if (!current) return { error: "پروژه یافت نشد." };
  if (!(SIMPLE_TRANSITIONS[current.status] ?? []).includes(status)) {
    return { error: "تغییر وضعیت در این مرحله مجاز نیست." };
  }

  const { error } = await supabase.from("projects").update({ status }).eq("id", id);
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  return null;
}

/** Atomically move DRAFT -> PLANNED and assign the official PRJ- number. */
export async function finalizeProject(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("id") ?? "");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("finalize_project", { p_id: id, p_year: currentJalaliYear() });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  return null;
}

/** Create a DRAFT project pre-filled from a Won CRM opportunity ("ایجاد پروژه"). Redirects to the existing project if one already exists for this opportunity. */
export async function createProjectFromOpportunity(_p: ActionState, f: FormData): Promise<ActionState> {
  const opportunityId = String(f.get("opportunity_id") ?? "");
  if (!opportunityId) return { error: "ورودی نامعتبر است." };
  const { supabase, userId } = await ctx();

  const { data: existing } = await supabase.from("projects").select("id").eq("crm_opportunity_id", opportunityId).maybeSingle();
  if (existing) redirect(`/projects/${existing.id}`);

  const { data: opp } = await supabase
    .from("crm_opportunities")
    .select("title, description, company_id, case_id, contract_id, owner_user_id")
    .eq("id", opportunityId)
    .single();
  if (!opp) return { error: "فرصت یافت نشد." };

  const { data, error } = await supabase
    .from("projects")
    .insert({
      title: opp.title,
      description: opp.description ?? null,
      company_id: opp.company_id,
      case_id: opp.case_id ?? null,
      crm_opportunity_id: opportunityId,
      contract_id: opp.contract_id ?? null,
      project_manager_id: opp.owner_user_id ?? userId,
      owner_user_id: opp.owner_user_id ?? null,
      status: "DRAFT",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: raceExisting } = await supabase.from("projects").select("id").eq("crm_opportunity_id", opportunityId).maybeSingle();
      if (raceExisting) redirect(`/projects/${raceExisting.id}`);
    }
    return { error: persianError(error.message) };
  }

  revalidatePath(`/opportunities/${opportunityId}`);
  redirect(`/projects/${data.id}`);
}

/** Create a DRAFT project pre-filled from a Contract ("ایجاد پروژه"). */
export async function createProjectFromContract(_p: ActionState, f: FormData): Promise<ActionState> {
  const contractId = String(f.get("contract_id") ?? "");
  if (!contractId) return { error: "ورودی نامعتبر است." };
  const { supabase, userId } = await ctx();

  const { data: contract } = await supabase
    .from("contracts")
    .select("title, description, counterparty_company_id, case_id, opportunity_id, responsible_user, effective_date, expiry_date")
    .eq("id", contractId)
    .single();
  if (!contract) return { error: "قرارداد یافت نشد." };

  const { data, error } = await supabase
    .from("projects")
    .insert({
      title: contract.title,
      description: contract.description ?? null,
      company_id: contract.counterparty_company_id,
      case_id: contract.case_id ?? null,
      crm_opportunity_id: contract.opportunity_id ?? null,
      contract_id: contractId,
      project_manager_id: contract.responsible_user ?? userId,
      planned_start_date: contract.effective_date ?? null,
      planned_end_date: contract.expiry_date ?? null,
      status: "DRAFT",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  revalidatePath(`/contracts/${contractId}`);
  redirect(`/projects/${data.id}`);
}

/** Create a DRAFT proforma pre-filled from a project ("صدور پیش‌فاکتور"). Mirrors createProformaFromOpportunity (CRM). */
export async function createProformaFromProject(_p: ActionState, f: FormData): Promise<ActionState> {
  const projectId = String(f.get("project_id") ?? "");
  if (!projectId) return { error: "ورودی نامعتبر است." };
  const { supabase, userId } = await ctx();

  const { data: project } = await supabase
    .from("projects")
    .select("title, description, company_id, case_id, contract_id, crm_opportunity_id, budget_amount, budget_currency")
    .eq("id", projectId)
    .single();
  if (!project) return { error: "پروژه یافت نشد." };
  if (!project.company_id) return { error: "برای این پروژه شرکتی ثبت نشده است." };

  const { data: company } = await supabase
    .from("companies")
    .select("legal_name, english_name, contact_person, email, phone, address")
    .eq("id", project.company_id)
    .single();
  if (!company) return { error: "شرکت مرتبط با این پروژه یافت نشد." };

  const { data: doc, error } = await supabase
    .from("sales_documents")
    .insert({
      type: "PROFORMA",
      status: "DRAFT",
      company_id: project.company_id,
      contract_id: project.contract_id ?? null,
      case_id: project.case_id ?? null,
      opportunity_id: project.crm_opportunity_id ?? null,
      project_id: projectId,
      currency_code: project.budget_currency ?? "IRR",
      notes: `مرتبط با پروژه: ${project.title}`,
      customer_legal_name_snapshot: company.legal_name,
      customer_english_name_snapshot: company.english_name ?? null,
      customer_address_snapshot: company.address ?? null,
      customer_contact_person_snapshot: company.contact_person ?? null,
      customer_email_snapshot: company.email ?? null,
      customer_phone_snapshot: company.phone ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: persianError(error.message) };

  const { error: itemErr } = await supabase.from("sales_document_items").insert({
    sales_document_id: doc.id,
    line_no: 1,
    item_type: "SERVICE",
    description: project.description || project.title,
    quantity: 1,
    unit_price: project.budget_amount ?? 0,
  });
  if (itemErr) {
    await supabase.from("sales_documents").delete().eq("id", doc.id);
    return { error: persianError(itemErr.message) };
  }

  revalidatePath(`/projects/${projectId}`);
  redirect(`/invoices/${doc.id}`);
}

/* ------------------------------- settings --------------------------------- */
export async function setProjectRole(_p: ActionState, f: FormData): Promise<ActionState> {
  const raw = { user_id: f.get("user_id"), project_role: f.get("project_role") || null };
  const parsed = projectRoleSchema.safeParse(raw);
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("profiles")
    .update({ project_role: parsed.data.project_role ?? null })
    .eq("id", parsed.data.user_id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}
