"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { persianError } from "@/lib/enums";
import { salaryComponentCreateSchema, salaryComponentVersionSchema, payrollRoleSchema } from "@/lib/validation-payroll";

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

type ComponentInput = {
  name_fa: string; name_en?: string; calculation_method: string; effective_from: string;
  fixed_amount?: string; currency?: string; percentage?: string; percentage_basis?: string; rule_key?: string;
  taxable: boolean; insurable: boolean; display_on_payslip: boolean; display_order: number; change_note?: string;
};
const componentParams = (d: ComponentInput) => ({
  p_name_fa: d.name_fa,
  p_calculation_method: d.calculation_method,
  p_effective_from: d.effective_from,
  p_name_en: d.name_en ?? null,
  p_fixed_amount: d.fixed_amount ?? null,
  p_currency: d.currency ?? null,
  p_percentage: d.percentage ?? null,
  p_percentage_basis: d.percentage_basis ?? null,
  p_rule_key: d.rule_key ?? null,
  p_taxable: d.taxable,
  p_insurable: d.insurable,
  p_display_on_payslip: d.display_on_payslip,
  p_display_order: d.display_order,
  p_change_note: d.change_note ?? null,
});

/** Creates a salary component identity + its first (v1) definition. Amounts stay exact strings end to end. */
export async function createSalaryComponent(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = salaryComponentCreateSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { data, error } = await supabase.rpc("create_salary_component", {
    p_code: d.code,
    p_component_type: d.component_type,
    ...componentParams(d),
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath("/payroll/components");
  redirect(`/payroll/components/${data.component_id}`);
}

/** "Editing" a component = appending a new version; the previous one is closed and frozen. */
export async function createSalaryComponentVersion(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = salaryComponentVersionSchema.safeParse(entries(f));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase } = await ctx();
  const d = parsed.data;
  const { error } = await supabase.rpc("create_salary_component_version", {
    p_component_id: d.component_id,
    ...componentParams(d),
  });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/components/${d.component_id}`);
  revalidatePath("/payroll/components");
  return null;
}

export async function setSalaryComponentActive(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get("component_id") ?? "");
  if (!id) return { error: "شناسهٔ جزء نامعتبر است." };
  const active = String(f.get("active") ?? "") === "true";
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("set_salary_component_active", { p_component_id: id, p_active: active });
  if (error) return { error: persianError(error.message) };
  revalidatePath(`/payroll/components/${id}`);
  revalidatePath("/payroll/components");
  return null;
}

export async function setPayrollRole(_p: ActionState, f: FormData): Promise<ActionState> {
  const raw = { user_id: f.get("user_id"), payroll_role: f.get("payroll_role") || null };
  const parsed = payrollRoleSchema.safeParse(raw);
  if (!parsed.success) return { error: "ورودی نامعتبر است." };
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("profiles")
    .update({ payroll_role: parsed.data.payroll_role ?? null })
    .eq("id", parsed.data.user_id);
  if (error) return { error: persianError(error.message) };
  revalidatePath("/settings");
  return null;
}
