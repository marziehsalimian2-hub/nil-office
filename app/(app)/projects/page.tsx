import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { PROJECT_TYPE_LABEL, type ProjectType } from "@/lib/enums";
import { toFaDigits, formatJalali } from "@/lib/jalali";
import { cn } from "@/lib/utils";
import type { Project, Company } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "", label: "همه" },
  { key: "active", label: "فعال" },
  { key: "mine", label: "پروژه‌های من" },
  { key: "overdue", label: "عقب‌افتاده" },
  { key: "completed", label: "تکمیل‌شده" },
  { key: "archived", label: "آرشیو" },
] as const;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const supabase = await createClient();
  const profile = await requireProfile();
  const today = new Date().toISOString().slice(0, 10);

  let query = supabase.from("projects").select("*").order("created_at", { ascending: false });
  switch (tab) {
    case "active":
      query = query.eq("status", "ACTIVE");
      break;
    case "mine":
      query = query.or(`project_manager_id.eq.${profile.id},owner_user_id.eq.${profile.id}`);
      break;
    case "overdue":
      query = query.lt("planned_end_date", today).not("status", "in", "(COMPLETED,CANCELLED,ARCHIVED)");
      break;
    case "completed":
      query = query.eq("status", "COMPLETED");
      break;
    case "archived":
      query = query.eq("status", "ARCHIVED");
      break;
    default:
      break;
  }

  const [{ data }, { data: companies }] = await Promise.all([
    query,
    supabase.from("companies").select("id, legal_name"),
  ]);

  const rows = (data ?? []) as Project[];
  const companyName = new Map(((companies ?? []) as Pick<Company, "id" | "legal_name">[]).map((c) => [c.id, c.legal_name]));

  return (
    <div>
      <PageHeader
        title="پروژه‌ها"
        subtitle="مدیریت اجرای پروژه‌ها"
        action={<Link href="/projects/new" className="btn-seal"><Plus className="h-4 w-4" /> پروژه جدید</Link>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key ? `/projects?tab=${t.key}` : "/projects"} className={cn("btn-ghost", (tab ?? "") === t.key && "border-seal text-seal")}>
            {t.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="پروژه‌ای یافت نشد." action={<Link href="/projects/new" className="btn-primary"><Plus className="h-4 w-4" /> پروژه جدید</Link>} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px]">
            <thead><tr className="table-head">
              <th className="px-4 py-3">شماره</th><th className="px-4 py-3">عنوان</th>
              <th className="px-4 py-3">شرکت</th><th className="px-4 py-3">نوع</th>
              <th className="px-4 py-3">پایان برنامه‌ریزی‌شده</th><th className="px-4 py-3">وضعیت</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="px-4 py-3 tnum font-medium text-ink">
                    <Link href={`/projects/${p.id}`} className="hover:underline">{p.display_number ? toFaDigits(p.display_number) : "پیش‌نویس"}</Link>
                  </td>
                  <td className="px-4 py-3 text-ink">{p.title}</td>
                  <td className="px-4 py-3 text-ink-muted">{p.company_id ? (companyName.get(p.company_id) ?? "—") : "—"}</td>
                  <td className="px-4 py-3 text-ink-muted">{PROJECT_TYPE_LABEL[p.project_type as ProjectType]}</td>
                  <td className="px-4 py-3 tnum text-ink-muted">{formatJalali(p.planned_end_date)}</td>
                  <td className="px-4 py-3"><ProjectStatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
