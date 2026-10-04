import type { Profile } from "@/lib/types/database";

/** Mirrors the DB helpers in 0114 — UI gating only; RLS/RPCs are the real gate. */
export function payrollAccess(p: Pick<Profile, "role" | "payroll_role">) {
  const admin = p.role === "ADMIN";
  const r = p.payroll_role;
  return {
    view: admin || r != null,
    create: admin || r === "CREATE" || r === "APPROVE" || r === "ADMIN",
    approve: admin || r === "APPROVE" || r === "ADMIN",
    admin: admin || r === "ADMIN",
    bank: admin || r === "ADMIN",
  };
}

/** Accounting-side gate for the payroll accounting card (mirrors 0008 helpers; UI only — RPCs/RLS enforce). */
export function accountingAccess(p: Pick<Profile, "role" | "accounting_role">) {
  const admin = p.role === "ADMIN";
  const r = p.accounting_role;
  return {
    open: admin || r != null,
    create: admin || r === "CREATE" || r === "POST" || r === "ADMIN",
  };
}
