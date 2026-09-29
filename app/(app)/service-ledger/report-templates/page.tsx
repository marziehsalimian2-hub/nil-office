import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { toFaDigits } from "@/lib/jalali";
import { REPORT_TYPE_LABEL, REPORT_TEMPLATE_SCOPE_LABEL, type ReportType, type ReportTemplateScope } from "@/lib/enums";
import { TemplateActions } from "./TemplateActions";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  template_name: string;
  scope: ReportTemplateScope;
  report_type: ReportType;
  version: number;
  is_active: boolean;
  companies: { legal_name: string } | { legal_name: string }[] | null;
};

export default async function ReportTemplatesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_service_report_templates")
    .select("id, template_name, scope, report_type, version, is_active, companies(legal_name)")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];

  return (
    <div>
      <PageHeader
        title="قالب‌های گزارش"
        subtitle="قالب جدید را از صفحهٔ «گزارش‌ها» در پروندهٔ هر مشتری، با گزینهٔ «ذخیره به‌عنوان قالب جدید»، بسازید."
      />
      {rows.length === 0 ? (
        <EmptyState title="قالبی ثبت نشده است." />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-3">نام قالب</th>
                <th className="px-4 py-3">دامنه</th>
                <th className="px-4 py-3">نوع گزارش</th>
                <th className="px-4 py-3">نسخه</th>
                <th className="px-4 py-3">فعال</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const company = Array.isArray(t.companies) ? t.companies[0] : t.companies;
                return (
                  <tr key={t.id} className="table-row">
                    <td className="px-4 py-3 font-medium text-ink">{t.template_name}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {REPORT_TEMPLATE_SCOPE_LABEL[t.scope]}
                      {t.scope === "CLIENT" && company ? ` — ${company.legal_name}` : ""}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{REPORT_TYPE_LABEL[t.report_type]}</td>
                    <td className="px-4 py-3 tnum text-ink-muted">{toFaDigits(t.version)}</td>
                    <td className="px-4 py-3 text-ink-muted">{t.is_active ? "بله" : "خیر"}</td>
                    <td className="px-4 py-3">
                      <TemplateActions templateId={t.id} isActive={t.is_active} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        <Link href="/companies" className="text-seal hover:underline">
          مشاهدهٔ شرکت‌ها
        </Link>
        {" "}برای ساخت یا ویرایش گزارش هر مشتری.
      </p>
    </div>
  );
}
