"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Field, FormError } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { generateClientServiceReport } from "@/app/actions/service-reports";
import { createReportTemplate, saveChangesToTemplate, setDefaultClientTemplate } from "@/app/actions/service-report-templates";
import {
  REPORT_TYPE,
  REPORT_TYPE_LABEL,
  REPORT_TYPE_DEFAULT_SECTIONS,
  REPORT_TYPE_DEFAULT_FIELDS,
  REPORT_SECTION,
  REPORT_SECTION_LABEL,
  REPORT_FIELD,
  REPORT_FIELD_LABEL,
  REPORT_DETAIL_LEVEL,
  REPORT_DETAIL_LEVEL_LABEL,
  type ReportType,
  type ReportSection,
  type ReportField,
  type ReportDetailLevel,
} from "@/lib/enums";
import type { ClientServiceReportTemplate } from "@/lib/types/database";

const todayIsoClient = () => new Date().toISOString().slice(0, 10);
function firstOfMonthIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

/**
 * Configure -> Preview -> Generate (spec §54). Preview posts the exact
 * same field set to /api/service-ledger/reports/preview (no archival
 * write); Generate calls generateClientServiceReport, which persists
 * an immutable row. Both read from this one piece of component state —
 * no duplicated configuration logic between the two steps.
 */
export function ReportBuilderForm({
  companyId,
  clientServiceFileId,
  templates,
  initialTemplateId,
}: {
  companyId: string;
  clientServiceFileId: string;
  templates: ClientServiceReportTemplate[];
  initialTemplateId?: string;
}) {
  const router = useRouter();
  const [reportType, setReportType] = useState<ReportType>("CLIENT_PERFORMANCE_REPORT");
  const [periodStart, setPeriodStart] = useState(firstOfMonthIso());
  const [periodEnd, setPeriodEnd] = useState(todayIsoClient());
  const [title, setTitle] = useState("گزارش عملکرد خدمات");
  const [introduction, setIntroduction] = useState("");
  const [finalNote, setFinalNote] = useState("");
  const [sections, setSections] = useState<Set<ReportSection>>(new Set(REPORT_TYPE_DEFAULT_SECTIONS.CLIENT_PERFORMANCE_REPORT));
  const [fields, setFields] = useState<Set<ReportField>>(new Set(REPORT_TYPE_DEFAULT_FIELDS.CLIENT_PERFORMANCE_REPORT));
  const [detailLevel, setDetailLevel] = useState<ReportDetailLevel>("STANDARD");
  const [showLogo, setShowLogo] = useState(true);
  const [showPageNumbers, setShowPageNumbers] = useState(true);
  const [templateId, setTemplateId] = useState<string | undefined>(initialTemplateId);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateScope, setNewTemplateScope] = useState<"GLOBAL" | "CLIENT">("CLIENT");

  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  function applyTemplate(id: string) {
    const t = templateById.get(id);
    if (!t) return;
    setTemplateId(t.id);
    setReportType(t.report_type as ReportType);
    setSections(new Set(t.selected_sections as ReportSection[]));
    setFields(new Set(t.selected_fields as ReportField[]));
    setDetailLevel(t.detail_level);
    setShowLogo(t.show_logo);
    setShowPageNumbers(t.show_page_numbers);
    if (t.default_title) setTitle(t.default_title);
    if (t.default_introduction) setIntroduction(t.default_introduction);
    if (t.default_final_note) setFinalNote(t.default_final_note);
  }

  useEffect(() => {
    if (initialTemplateId) applyTemplate(initialTemplateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplateId]);

  function applyPreset(type: ReportType) {
    setReportType(type);
    setSections(new Set(REPORT_TYPE_DEFAULT_SECTIONS[type]));
    setFields(new Set(REPORT_TYPE_DEFAULT_FIELDS[type]));
    setTemplateId(undefined);
  }

  function toggleSection(s: ReportSection) {
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }
  function toggleField(f: ReportField) {
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.append("client_service_file_id", clientServiceFileId);
    fd.append("report_type", reportType);
    fd.append("period_start", periodStart);
    fd.append("period_end", periodEnd);
    fd.append("title", title);
    if (introduction) fd.append("introduction", introduction);
    if (finalNote) fd.append("final_note", finalNote);
    fd.append("selected_sections", JSON.stringify([...sections]));
    fd.append("selected_fields", JSON.stringify([...fields]));
    fd.append("detail_level", detailLevel);
    if (showLogo) fd.append("show_logo", "true");
    if (showPageNumbers) fd.append("show_page_numbers", "true");
    if (templateId) fd.append("template_id", templateId);
    return fd;
  }

  async function handlePreview() {
    setError(undefined);
    setPreviewPending(true);
    try {
      const res = await fetch("/api/service-ledger/reports/preview", { method: "POST", body: buildFormData() });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "خطا در تولید پیش‌نمایش.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } finally {
      setPreviewPending(false);
    }
  }

  function handleGenerate() {
    setError(undefined);
    const fd = buildFormData();
    fd.append("company_id", companyId);
    startTransition(async () => {
      const res = await generateClientServiceReport(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else router.push(`/companies/${companyId}`);
    });
  }

  function handleSaveAsTemplate() {
    if (!newTemplateName.trim()) return;
    const fd = buildFormData();
    fd.delete("period_start");
    fd.delete("period_end");
    fd.delete("template_id");
    fd.append("template_name", newTemplateName.trim());
    fd.append("scope", newTemplateScope);
    if (newTemplateScope === "CLIENT") fd.append("company_id", companyId);
    fd.append("default_title", title);
    if (introduction) fd.append("default_introduction", introduction);
    if (finalNote) fd.append("default_final_note", finalNote);
    startTransition(async () => {
      const res = await createReportTemplate(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else {
        setShowSaveAsTemplate(false);
        setNewTemplateName("");
        router.refresh();
      }
    });
  }

  function handleSetAsDefault() {
    if (!templateId) return;
    const fd = new FormData();
    fd.append("client_service_file_id", clientServiceFileId);
    fd.append("template_id", templateId);
    fd.append("company_id", companyId);
    startTransition(async () => {
      const res = await setDefaultClientTemplate(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else router.refresh();
    });
  }

  function handleSaveChangesToTemplate() {
    if (!templateId) return;
    const fd = buildFormData();
    fd.delete("period_start");
    fd.delete("period_end");
    fd.append("id", templateId);
    const t = templateById.get(templateId);
    fd.append("template_name", t?.template_name ?? "قالب");
    fd.append("scope", t?.scope ?? "CLIENT");
    if ((t?.scope ?? "CLIENT") === "CLIENT") fd.append("company_id", companyId);
    fd.append("default_title", title);
    if (introduction) fd.append("default_introduction", introduction);
    if (finalNote) fd.append("default_final_note", finalNote);
    startTransition(async () => {
      const res = await saveChangesToTemplate(null, fd);
      if (res && "error" in res && res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />

      <Card className="space-y-3">
        {templates.length > 0 && (
          <Field label="بارگذاری از قالب ذخیره‌شده">
            <select className="input" value={templateId ?? ""} onChange={(e) => (e.target.value ? applyTemplate(e.target.value) : setTemplateId(undefined))}>
              <option value="">— بدون قالب —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.template_name} {t.scope === "GLOBAL" ? "(سراسری)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نوع گزارش" required>
            <select className="input" value={reportType} onChange={(e) => applyPreset(e.target.value as ReportType)}>
              {REPORT_TYPE.map((t) => (
                <option key={t} value={t}>
                  {REPORT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="سطح جزئیات" required>
            <select className="input" value={detailLevel} onChange={(e) => setDetailLevel(e.target.value as ReportDetailLevel)}>
              {REPORT_DETAIL_LEVEL.map((d) => (
                <option key={d} value={d}>
                  {REPORT_DETAIL_LEVEL_LABEL[d]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="از تاریخ" required>
            <JalaliDateInput name="period_start_display" defaultISO={periodStart} onChange={setPeriodStart} />
          </Field>
          <Field label="تا تاریخ" required>
            <JalaliDateInput name="period_end_display" defaultISO={periodEnd} onChange={setPeriodEnd} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="عنوان گزارش" required>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <Field label="مقدمه (اختیاری)">
          <textarea className="input" rows={2} value={introduction} onChange={(e) => setIntroduction(e.target.value)} />
        </Field>
        <Field label="توضیح پایانی (اختیاری)">
          <textarea className="input" rows={2} value={finalNote} onChange={(e) => setFinalNote(e.target.value)} />
        </Field>

        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={showLogo} onChange={(e) => setShowLogo(e.target.checked)} className="h-4 w-4 accent-[#9a6a2e]" />
            نمایش آرم و سربرگ نیل
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={showPageNumbers} onChange={(e) => setShowPageNumbers(e.target.checked)} className="h-4 w-4 accent-[#9a6a2e]" />
            شمارهٔ صفحه
          </label>
        </div>
      </Card>

      <Card>
        <p className="mb-2 text-sm font-medium text-ink">بخش‌های گزارش</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {REPORT_SECTION.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={sections.has(s)} onChange={() => toggleSection(s)} className="h-4 w-4 accent-[#9a6a2e]" />
              {REPORT_SECTION_LABEL[s]}
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <p className="mb-2 text-sm font-medium text-ink">ستون‌های جدول خدمات</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {REPORT_FIELD.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={fields.has(f)} onChange={() => toggleField(f)} className="h-4 w-4 accent-[#9a6a2e]" />
              {REPORT_FIELD_LABEL[f]}
            </label>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={previewPending} className="btn-quiet" onClick={handlePreview}>
          {previewPending ? "در حال آماده‌سازی پیش‌نمایش…" : "پیش‌نمایش"}
        </button>
        <button type="button" disabled={pending} className="btn-primary" onClick={handleGenerate}>
          {pending ? "در حال تولید…" : "تولید PDF نهایی"}
        </button>
        {!showSaveAsTemplate ? (
          <button type="button" className="btn-quiet text-xs" onClick={() => setShowSaveAsTemplate(true)}>
            ذخیره به‌عنوان قالب جدید
          </button>
        ) : null}
        {templateId && (
          <>
            <button type="button" disabled={pending} className="btn-quiet text-xs" onClick={handleSaveChangesToTemplate}>
              ذخیرهٔ تغییرات در قالب
            </button>
            <button type="button" disabled={pending} className="btn-quiet text-xs" onClick={handleSetAsDefault}>
              تنظیم به‌عنوان قالب پیش‌فرض این مشتری
            </button>
          </>
        )}
      </div>

      {showSaveAsTemplate && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="نام قالب" required>
              <input className="input" value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} />
            </Field>
            <Field label="دامنه">
              <select className="input" value={newTemplateScope} onChange={(e) => setNewTemplateScope(e.target.value as "GLOBAL" | "CLIENT")}>
                <option value="CLIENT">اختصاصی این مشتری</option>
                <option value="GLOBAL">سراسری (همهٔ مشتریان)</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={pending} className="btn-primary" onClick={handleSaveAsTemplate}>
              ذخیرهٔ قالب
            </button>
            <button type="button" className="btn-quiet" onClick={() => setShowSaveAsTemplate(false)}>
              انصراف
            </button>
          </div>
        </Card>
      )}

      {previewUrl && (
        <Card>
          <p className="mb-2 text-sm font-medium text-ink">پیش‌نمایش</p>
          <iframe src={previewUrl} className="h-[70vh] w-full rounded-lg border border-paper-line" />
        </Card>
      )}
    </div>
  );
}
