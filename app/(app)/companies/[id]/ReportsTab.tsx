import Link from "next/link";
import { FileText, Plus, Zap } from "lucide-react";
import { Card } from "@/components/ui";
import { formatJalali } from "@/lib/jalali";
import { REPORT_TYPE_LABEL, type ReportType } from "@/lib/enums";
import type { ClientServiceReport, ClientServiceReportTemplate } from "@/lib/types/database";

type Opt = { id: string; label: string };

/**
 * §57 — "Open Archived PDF" (the download link on each row) and
 * "Generate New Report" (the button below) are two independent
 * actions, never the same control: opening history never regenerates
 * anything, and a new report never overwrites a past one.
 */
export function ReportsTab({
  companyId,
  clientServiceFileId,
  canManage,
  reports,
  defaultTemplate,
  profiles,
}: {
  companyId: string;
  clientServiceFileId: string;
  canManage: boolean;
  reports: ClientServiceReport[];
  defaultTemplate: ClientServiceReportTemplate | null;
  profiles: Opt[];
}) {
  const profileName = new Map(profiles.map((p) => [p.id, p.label]));

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">گزارش‌های PDF</p>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {defaultTemplate && (
              <Link
                href={`/companies/${companyId}/reports/new?template_id=${defaultTemplate.id}`}
                className="btn-quiet gap-1.5 p-1.5 text-xs"
              >
                <Zap className="h-3.5 w-3.5" /> گزارش دوره‌ای ({defaultTemplate.template_name})
              </Link>
            )}
            <Link href={`/companies/${companyId}/reports/new`} className="btn-primary gap-1.5 !py-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> گزارش جدید
            </Link>
          </div>
        )}
      </div>

      {reports.length === 0 ? (
        <p className="text-sm text-ink-muted">هنوز گزارشی برای این مشتری تولید نشده است.</p>
      ) : (
        <ul className="divide-y divide-paper-line/60">
          {reports.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-ink-muted" />
              <div className="flex-1">
                <p className="text-sm text-ink">{r.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {REPORT_TYPE_LABEL[r.report_type as ReportType] ?? r.report_type} — {formatJalali(r.period_start)} تا {formatJalali(r.period_end)}
                  {r.template_id && ` — قالب نسخهٔ ${r.template_version}`}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  تهیه‌شده توسط {profileName.get(r.generated_by) ?? "—"} در {formatJalali(r.generated_at)}
                </p>
              </div>
              <a href={`/api/service-ledger/reports/${r.id}/pdf`} target="_blank" rel="noopener" className="btn-quiet p-1.5 text-xs">
                مشاهدهٔ PDF آرشیوشده
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
