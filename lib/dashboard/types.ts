import type { AttentionSeverity } from "@/lib/enums";

/**
 * One row in the Attention Center. Every item traces back to exactly one
 * deterministic rule_code (spec §45/§46) — never an AI judgment call.
 */
export type AttentionItem = {
  id: string;
  source_type: "task" | "followup" | "project" | "milestone" | "deliverable" | "invoice" | "contract" | "opportunity";
  source_id: string;
  severity: AttentionSeverity;
  rule_code: string;
  title: string;
  description: string;
  responsible_user_id: string | null;
  due_date: string | null;
  days_overdue: number | null;
  navigation_target: string;
};

/** Per-currency amount — never summed across currencies (spec §11/§17). */
export type CurrencyAmount = { currency_code: string; amount: number };

export type SectionResult<T> = { ok: true; data: T } | { ok: false };
