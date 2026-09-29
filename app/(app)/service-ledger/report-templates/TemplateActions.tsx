"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { duplicateReportTemplate, deactivateReportTemplate } from "@/app/actions/service-report-templates";

export function TemplateActions({ templateId, isActive }: { templateId: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function duplicate() {
    const fd = new FormData();
    fd.append("id", templateId);
    startTransition(async () => {
      await duplicateReportTemplate(null, fd);
      router.refresh();
    });
  }

  function deactivate() {
    if (!confirm("این قالب غیرفعال شود؟")) return;
    const fd = new FormData();
    fd.append("id", templateId);
    startTransition(async () => {
      await deactivateReportTemplate(null, fd);
      router.refresh();
    });
  }

  return (
    <div className="flex gap-2">
      <button type="button" disabled={pending} className="btn-quiet p-1.5 text-xs" onClick={duplicate}>
        کپی
      </button>
      {isActive && (
        <button type="button" disabled={pending} className="btn-quiet p-1.5 text-xs text-status-cancelled" onClick={deactivate}>
          غیرفعال‌سازی
        </button>
      )}
    </div>
  );
}
