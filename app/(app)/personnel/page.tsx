import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { HrDashboard } from "./HrDashboard";
import { PageHeader, EmptyState } from "@/components/ui";
import { PERSONNEL_STATUS_LABEL, PERSONNEL_STATUS_TONE, type PersonnelStatus } from "@/lib/enums";
import { toFaDigits, formatJalali } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import type { Personnel } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function PersonnelPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const supabase = await createClient();
  const profile = await requireProfile();

  let query = supabase
    .from("personnel")
    .select("id, personnel_number, first_name, last_name, job_title, department, employment_status, hire_date")
    .order("hire_date", { ascending: false })
    .limit(200);
  if (status) query = query.eq("employment_status", status);
  if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,personnel_number.ilike.%${q}%,job_title.ilike.%${q}%`);

  const { data } = await query;
  const rows = (data ?? []) as Pick<
    Personnel,
    "id" | "personnel_number" | "first_name" | "last_name" | "job_title" | "department" | "employment_status" | "hire_date"
  >[];

  return (
    <div>
      <PageHeader
        title="پرسنل"
        subtitle="ثبت و مدیریت پروندهٔ پرسنلی"
        action={
          <div className="flex gap-2">
            <Link href="/personnel/reports" className="btn-quiet">گزارش‌ها</Link>
            <Link href="/personnel/new" className="btn-seal">
              <Plus className="h-4 w-4" /> افزودن پرسنل جدید
            </Link>
          </div>
        }
      />
      <HrDashboard showPayroll={payrollAccess(profile).view} />

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="جست‌وجوی نام، شماره پرسنلی، سمت..." className="input max-w-xs" />
        {status && <input type="hidden" name="status" value={status} />}
        <button type="submit" className="btn-ghost">
          جست‌وجو
        </button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/personnel" className={cn("btn-ghost", !status && "border-seal text-seal")}>
          همه
        </Link>
        {(Object.keys(PERSONNEL_STATUS_LABEL) as PersonnelStatus[]).map((s) => (
          <Link key={s} href={`/personnel?status=${s}`} className={cn("btn-ghost", status === s && "border-seal text-seal")}>
            {PERSONNEL_STATUS_LABEL[s]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="پرسنلی ثبت نشده است."
          action={
            <Link href="/personnel/new" className="btn-primary">
              <Plus className="h-4 w-4" /> افزودن پرسنل جدید
            </Link>
          }
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">شماره پرسنلی</th>
                <th className="px-4 py-3">نام</th>
                <th className="px-4 py-3">سمت</th>
                <th className="px-4 py-3">واحد</th>
                <th className="px-4 py-3">تاریخ استخدام</th>
                <th className="px-4 py-3">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link href={`/personnel/${p.id}`} className="tnum font-medium text-seal hover:underline" dir="ltr">
                      {toFaDigits(p.personnel_number)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {p.first_name} {p.last_name}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{p.job_title}</td>
                  <td className="px-4 py-3 text-ink-muted">{p.department ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-muted tnum">{formatJalali(p.hire_date)}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${PERSONNEL_STATUS_TONE[p.employment_status]}`}>
                      {PERSONNEL_STATUS_LABEL[p.employment_status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
