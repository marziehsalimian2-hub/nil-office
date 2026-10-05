"use client";

import { useActionState, useMemo, useState } from "react";
import { armReset, cancelResetPlan, createResetDryRun, executeReset, resumeStorageCleanup } from "@/app/actions/system-reset";
import { FormError, SubmitButton } from "@/components/form";
import { Card } from "@/components/ui";
import { toFaDigits } from "@/lib/jalali";
import { NUMBERING_SCOPES } from "@/lib/system-reset/schemas";
import type { ResetActionState, ResetPreview, ResetReport, ResetRunRow } from "@/lib/system-reset/types";

const SCOPE_LABEL: Record<string, string> = {
  OUTGOING: "نامهٔ صادره", INCOMING: "نامهٔ وارده", CASE: "پرونده", CONTRACT: "قرارداد", PROFORMA: "پیش‌فاکتور", INVOICE: "فاکتور",
  OPPORTUNITY: "فرصت", PROJECT: "پروژه", OFFER: "پیشنهاد تجاری", CHEQUE: "چک", RECEIPT: "دریافت", PAYMENT: "پرداخت", PERSONNEL: "پرسنل", PAYROLL_BATCH: "دستهٔ حقوق",
};
const ENV_LABEL: Record<string, string> = { development: "Development", uat: "UAT", production: "Production" };
const STATUS_LABEL: Record<string, string> = {
  RUNNING: "در حال اجرا", VERIFYING: "در حال بررسی", COMPLETED: "کامل شد", FAILED: "ناموفق", CANCELLED: "لغو شد", PLANNED: "طرح", READY: "آماده",
};
const CHECK_LABEL: Record<string, string> = {
  DELETE_TABLES_EMPTY: "همهٔ جدول‌های عملیاتی خالی‌اند",
  PRESERVED_TABLES_UNCHANGED: "جدول‌های پیکربندی دست‌نخورده‌اند",
  GLOBAL_TEMPLATES_KEPT: "قالب‌های عمومی گزارش حفظ شده‌اند",
  ACCOUNTING_CLEAN: "حسابداری پاک است (سند، دریافت/پرداخت، چک، تخصیص)",
  SEQUENCES_AT_BASELINE: "شمارنده‌ها روی مقدار پایه‌اند",
  NO_ORPHAN_ATTACHMENTS: "پیوست یا سند یتیم وجود ندارد",
  FK_CONSTRAINTS_VALID: "کلیدهای خارجی سالم‌اند",
  POLICIES_UNCHANGED: "سیاست‌های RLS تغییر نکرده‌اند",
  ADMIN_ACCESS_PRESERVED: "دسترسی مدیر حفظ شده است",
  CONFIGURATION_PRESERVED: "پیکربندی سیستم حفظ شده است",
  RESET_HISTORY_PRESENT: "تاریخچهٔ بازنشانی ثبت شده است",
  STORAGE_CLEANUP_COMPLETE: "پاک‌سازی فایل‌ها کامل شد",
  NO_ORPHAN_BUSINESS_FILES: "فایل کاری یتیم باقی نمانده است",
};
const num = (n: number | null | undefined) => (n == null ? "—" : toFaDigits(n.toLocaleString("en-US")));

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function FactoryResetPanel({
  env, productionBlocked, phrase, defaultBaselines, runs,
}: {
  env: string; productionBlocked: boolean; phrase: string; defaultBaselines: Record<string, number>; runs: ResetRunRow[];
}) {
  const [dry, dryAction] = useActionState<ResetActionState, FormData>(createResetDryRun, null);
  const [arm, armAction] = useActionState<ResetActionState, FormData>(armReset, null);
  const [exec, execAction] = useActionState<ResetActionState, FormData>(executeReset, null);
  const [cancel, cancelAction] = useActionState<ResetActionState, FormData>(cancelResetPlan, null);
  const [resume, resumeAction] = useActionState<ResetActionState, FormData>(resumeStorageCleanup, null);
  const [mode, setMode] = useState<"OPERATIONAL" | "FULL">("OPERATIONAL");
  const [backupLocal, setBackupLocal] = useState("");

  const cancelledId = cancel && "cancelled" in cancel ? cancel.cancelled : null;
  const plan = dry && "plan" in dry && dry.plan.plan_id !== cancelledId ? dry.plan : null;
  const armed = arm && "armed" in arm ? arm.armed : null;
  const done = (exec && "done" in exec ? exec.done : null) ?? (resume && "done" in resume ? resume.done : null);
  const backupIso = useMemo(() => {
    const d = backupLocal ? new Date(backupLocal) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : "";
  }, [backupLocal]);
  const isFull = plan?.preview.mode === "FULL";

  return (
    <div className="space-y-6">
      {/* Danger zone banner */}
      <div className="rounded-lg border border-status-cancelled/40 bg-status-cancelled/5 p-4 text-sm">
        <p className="font-semibold text-status-cancelled">Danger Zone — این عملیات داده‌های کاری را برای همیشه حذف می‌کند</p>
        <p className="mt-1 text-ink">
          محیط فعلی: <b>{ENV_LABEL[env] ?? env}</b>
          {productionBlocked && <span className="mr-2 text-status-cancelled"> — اجرای واقعی در Production روی سرور بسته است (NIL_ALLOW_PRODUCTION_RESET).</span>}
        </p>
        <p className="mt-1 text-ink-muted">
          هیچ دکمهٔ تک‌مرحله‌ای وجود ندارد: انتخاب حالت ← Dry Run ← بازبینی ← تأیید بکاپ ← عبارت تأیید ← تأیید دوم ← اجرا ← بررسی یکپارچگی.
          فایل‌های برندینگ (سربرگ، مهر، امضا)، کاربران و نقش‌ها، سرفصل‌های حسابداری، سال مالی و قالب‌ها حذف نمی‌شوند.
        </p>
      </div>

      {/* Step 1-2: mode + numbering baselines + dry run */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">۱–۲) حالت بازنشانی و Dry Run (بدون هیچ حذفی)</h2>
        <form action={dryAction} className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="mode" value="OPERATIONAL" checked={mode === "OPERATIONAL"} onChange={() => setMode("OPERATIONAL")} /> Operational Clean Start (پیشنهادی)</label>
            <label className="flex items-center gap-2"><input type="radio" name="mode" value="FULL" checked={mode === "FULL"} onChange={() => setMode("FULL")} /> Full Factory Reset — فقط Dry Run، قابل اجرا نیست</label>
          </div>
          <div>
            <p className="field-label">آخرین شمارهٔ استفاده‌شده برای هر شمارنده (سال جاری؛ شمارهٔ بعدی = این مقدار + ۱)</p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {NUMBERING_SCOPES.map((s) => (
                <label key={s} className="text-xs text-ink-muted">
                  {SCOPE_LABEL[s]}
                  <input name={`baseline_${s}`} type="number" min={0} max={99999999} defaultValue={defaultBaselines[s] ?? 0} className="input tnum mt-1" />
                </label>
              ))}
            </div>
          </div>
          <FormError message={dry && "error" in dry ? dry.error : undefined} />
          <SubmitButton variant="ghost">اجرای Dry Run</SubmitButton>
        </form>
      </Card>

      {/* Step 3: review */}
      {plan && <PlanReview plan={plan.preview} planId={plan.plan_id} expiresAt={plan.expires_at} />}

      {/* Step 4-7: backup, typed phrase, second confirmation */}
      {plan && !isFull && !armed && !(exec && "done" in exec) && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">۴–۷) تأیید بکاپ، عبارت تأیید و تأیید دوم</h2>
          <p className="mb-3 text-xs text-ink-muted">
            سیستم نمی‌تواند صحت بکاپ را خودش بررسی کند؛ فقط مرجع و زمان آن را همراه تأیید شما ثبت می‌کند. بکاپ باید حداکثر ۴۸ ساعت قبل گرفته شده باشد.
            بازگردانی هنوز آزمایش نشده است (RESTORE_RUNBOOK.md).
          </p>
          <form action={armAction} className="space-y-3">
            <input type="hidden" name="plan_id" value={plan.plan_id} />
            <input type="hidden" name="backup_timestamp" value={backupIso} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-ink-muted">مرجع بکاپ (مثلاً شناسهٔ بکاپ Supabase)
                <input name="backup_reference" required minLength={4} maxLength={200} dir="ltr" className="input mt-1" />
              </label>
              <label className="text-xs text-ink-muted">زمان بکاپ
                <input type="datetime-local" required className="input mt-1" value={backupLocal} onChange={(e) => setBackupLocal(e.target.value)} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="backup_confirmed" /> تأیید می‌کنم بکاپ معتبر و قابل بازیابی گرفته شده است (تأیید ادمین، نه تأیید خودکار)</label>
            <label className="block text-xs text-ink-muted">برای ادامه عبارت زیر را عیناً تایپ کنید: <b dir="ltr" className="text-ink">{phrase}</b>
              <input name="phrase" required autoComplete="off" dir="ltr" className="input mt-1 max-w-xs" />
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="second_confirm" /> می‌دانم که این حذف برگشت‌پذیر نیست و فقط از بکاپ قابل بازیابی است.</label>
            <FormError message={arm && "error" in arm ? arm.error : undefined} />
            <SubmitButton variant="ghost">تأیید و آماده‌سازی اجرا</SubmitButton>
          </form>
        </Card>
      )}

      {/* Step 8-9: execute (separate request, one-time token) */}
      {plan && armed && !done && (
        <Card className="border border-status-cancelled/40">
          <h2 className="mb-2 text-sm font-semibold text-status-cancelled">۸–۹) اجرای نهایی</h2>
          <p className="mb-3 text-sm text-ink">
            با زدن دکمهٔ زیر، سرور دوباره مجوز، طرح، محیط و توکن را بررسی می‌کند، سامانه قفل نگهداری می‌شود و حذف انجام می‌شود:
            <b> {num(plan.preview.totals.rows_to_delete)} ردیف</b> از <b>{num(plan.preview.totals.tables)} جدول</b> و <b>{num(plan.preview.totals.storage_objects_to_delete)} فایل</b>.
            توکن ۱۰ دقیقه اعتبار دارد. تا پایان کار صفحه را نبندید.
          </p>
          <form action={execAction} className="space-y-3">
            <input type="hidden" name="plan_id" value={armed.plan_id} />
            <input type="hidden" name="token" value={armed.token} />
            <FormError message={exec && "error" in exec ? exec.error : undefined} />
            <SubmitButton variant="seal">اجرای بازنشانی (غیرقابل برگشت)</SubmitButton>
          </form>
        </Card>
      )}

      {plan && !armed && !done && (
        <form action={cancelAction}>
          <input type="hidden" name="plan_id" value={plan.plan_id} />
          <button className="btn-quiet" type="submit">لغو این طرح</button>
          <FormError message={cancel && "error" in cancel ? cancel.error : undefined} />
        </form>
      )}

      {/* Step 10: result */}
      {done && <ResultCard done={done} />}
      {resume && "error" in resume && <FormError message={resume.error} />}

      <History runs={runs} resumeAction={resumeAction} />
    </div>
  );
}

function PlanReview({ plan, planId, expiresAt }: { plan: ResetPreview; planId: string; expiresAt: string }) {
  const unknown = plan.unknown_tables.length > 0 || plan.fk_blockers.length > 0 || plan.missing_manifest_objects.length > 0;
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-ink">۳) بازبینی نتیجهٔ Dry Run</h2>
      <p className="mb-3 text-xs text-ink-muted">
        شناسهٔ طرح: <span dir="ltr" className="tnum">{planId}</span> — مانیفست نسخهٔ {num(plan.manifest_version)} (<span dir="ltr">{plan.manifest_hash.slice(0, 8)}</span>) — اعتبار تا{" "}
        <span dir="ltr">{new Date(expiresAt).toLocaleTimeString("fa-IR")}</span> (۳۰ دقیقه)
      </p>
      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Stat label="جدول برای حذف" value={num(plan.totals.tables)} />
        <Stat label="ردیف برای حذف" value={num(plan.totals.rows_to_delete)} />
        <Stat label="ردیف لاگ کاری" value={num(plan.totals.audit_rows_to_delete)} />
        <Stat label="فایل برای حذف" value={num(plan.totals.storage_objects_to_delete)} />
      </div>
      {plan.mode === "FULL" && <Alert tone="warn">Full Factory Reset فقط Dry Run است و در این نسخه قابل اجرا نیست.</Alert>}
      {plan.warnings.length > 0 && <Alert tone="warn">هشدارها: {plan.warnings.join("، ")}</Alert>}
      {unknown ? (
        <Alert tone="bad">
          اجرا مسدود است: {plan.unknown_tables.length > 0 && <>جدول طبقه‌بندی‌نشده: {plan.unknown_tables.join("، ")}. </>}
          {plan.fk_blockers.length > 0 && <>مانع کلید خارجی: {plan.fk_blockers.map((b) => `${b.referencing}→${b.referenced}`).join("، ")}. </>}
          {plan.missing_manifest_objects.length > 0 && <>مانیفست به جدولی اشاره می‌کند که وجود ندارد: {plan.missing_manifest_objects.join("، ")}.</>}
        </Alert>
      ) : (
        <Alert tone="ok">هیچ جدول طبقه‌بندی‌نشده، مانع کلید خارجی یا ناهماهنگی مانیفست وجود ندارد.{plan.executable ? " طرح قابل اجراست." : ""}</Alert>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        مدیران حفظ‌شده: {num(plan.admins_preserved.count)} — قالب‌های عمومی حفظ‌شده: {num(plan.templates.global_kept)}، قالب‌های مشتری‌محور حذف: {num(plan.templates.client_scope_removed)} —
        لاگ حسابرسی: {num(plan.audit.rows_to_delete)} حذف / {num(plan.audit.rows_kept)} حفظ
        {plan.audit.unclassified_entity_types.length > 0 && <> (نوع‌های طبقه‌بندی‌نشده می‌مانند: {plan.audit.unclassified_entity_types.join("، ")})</>}
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        فایل‌ها: {num(plan.storage.delete_count)} حذف، {num(plan.storage.preserve_count)} حفظ (برندینگ/امضا)، {num(plan.storage.unknown_count)} ناشناخته (حذف نمی‌شود)؛
        پیوست بدون فایل: {num(plan.orphan_risks.attachments_without_file)}، فایل بدون رکورد: {num(plan.orphan_risks.business_files_without_record)}
      </p>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-ink">شمارنده‌ها ({num(plan.sequences.number_sequences.length)} ردیف فعلی)</summary>
        <table className="mt-2 w-full text-xs">
          <thead><tr className="text-ink-muted"><th className="text-start">شمارنده</th><th className="text-start">سال</th><th className="text-start">فعلی</th><th className="text-start">بعد از بازنشانی</th></tr></thead>
          <tbody>
            {[...plan.sequences.number_sequences, ...plan.sequences.rows_to_create.map((r) => ({ ...r, from: 0 }))].map((s, i) => (
              <tr key={`${s.scope}-${s.year}-${i}`}><td>{SCOPE_LABEL[s.scope] ?? s.scope}</td><td className="tnum">{num(s.year)}</td><td className="tnum">{num(s.from)}</td><td className="tnum">{num(s.to)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-ink-muted">شمارنده‌های سند حسابداری: همهٔ سال‌های مالی ({num(plan.sequences.accounting_sequences.rows)}) روی صفر می‌روند.</p>
      </details>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-ink">جدول‌هایی که خالی می‌شوند ({num(plan.tables_to_delete.length)})</summary>
        <table className="mt-2 w-full text-xs">
          <thead><tr className="text-ink-muted"><th className="text-start">جدول</th><th className="text-start">ماژول</th><th className="text-start">ردیف</th><th className="text-start">ریسک</th></tr></thead>
          <tbody>
            {plan.tables_to_delete.map((t) => (
              <tr key={t.name}><td dir="ltr" className="text-start">{t.name}</td><td>{t.module}</td><td className="tnum">{num(t.rows)}</td><td>{t.risk}</td></tr>
            ))}
          </tbody>
        </table>
      </details>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-ink">آنچه حفظ می‌شود ({num(plan.tables_preserved.length)})</summary>
        <table className="mt-2 w-full text-xs">
          <thead><tr className="text-ink-muted"><th className="text-start">جدول</th><th className="text-start">ردیف</th><th className="text-start">روش</th><th className="text-start">دلیل</th></tr></thead>
          <tbody>
            {plan.tables_preserved.map((t) => (
              <tr key={t.name}><td dir="ltr" className="text-start">{t.name}</td><td className="tnum">{num(t.rows)}</td><td>{t.method}</td><td className="text-ink-muted">{t.reason}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

function ResultCard({ done }: { done: { run_id: string; status: string; integrity: { ok: boolean; checks: { key: string; ok: boolean }[] }; report: ResetReport } }) {
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold text-ink">۱۰) نتیجهٔ بررسی یکپارچگی — {done.integrity.ok ? "موفق" : "ناموفق"}</h2>
      <ul className="space-y-1 text-sm">
        {done.integrity.checks.map((c) => (
          <li key={c.key} className={c.ok ? "text-ink" : "text-status-cancelled"}>{c.ok ? "✓" : "✗"} {CHECK_LABEL[c.key] ?? c.key}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-muted">
        {num(done.report.rows_deleted)} ردیف از {num(done.report.tables_affected)} جدول حذف شد؛ {num(done.report.files.deleted)} فایل پاک شد
        {done.report.files.failed > 0 && <>، {num(done.report.files.failed)} فایل ناموفق</>}.
      </p>
      <button className="btn-ghost mt-3" type="button" onClick={() => download(`factory-reset-${done.run_id}.json`, JSON.stringify(done.report, null, 2))}>دانلود گزارش فنی (JSON)</button>
    </Card>
  );
}

function History({ runs, resumeAction }: { runs: ResetRunRow[]; resumeAction: (f: FormData) => void }) {
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold text-ink">تاریخچهٔ بازنشانی‌ها (بعد از Clean Start هم باقی می‌ماند)</h2>
      {runs.length === 0 ? (
        <p className="text-sm text-ink-muted">تاکنون هیچ بازنشانی اجرا نشده است.</p>
      ) : (
        <table className="w-full text-xs">
          <thead><tr className="text-ink-muted"><th className="text-start">شناسه</th><th className="text-start">حالت</th><th className="text-start">محیط</th><th className="text-start">شروع</th><th className="text-start">وضعیت</th><th className="text-start">مرحله</th><th className="text-start">بکاپ</th><th /></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td dir="ltr" className="text-start">{r.id.slice(0, 8)}</td>
                <td>{r.mode}</td>
                <td>{ENV_LABEL[r.environment] ?? r.environment}</td>
                <td className="tnum">{new Date(r.started_at).toLocaleString("fa-IR")}</td>
                <td className={r.status === "FAILED" ? "text-status-cancelled" : ""}>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td dir="ltr" className="text-start">{r.phase}</td>
                <td dir="ltr" className="text-start">{r.backup_reference ?? "—"}</td>
                <td>
                  {r.status === "FAILED" && r.counts_before && (
                    <form action={resumeAction}>
                      <input type="hidden" name="run_id" value={r.id} />
                      <SubmitButton variant="ghost">ادامهٔ پاک‌سازی فایل‌ها</SubmitButton>
                    </form>
                  )}
                  {r.report && (
                    <button type="button" className="btn-quiet" onClick={() => download(`factory-reset-${r.id}.json`, JSON.stringify(r.report, null, 2))}>گزارش</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="tnum text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function Alert({ tone, children }: { tone: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const cls = {
    ok: "border-line text-ink",
    warn: "border-status-waiting/40 bg-status-waiting/5 text-ink",
    bad: "border-status-cancelled/40 bg-status-cancelled/5 text-status-cancelled",
  }[tone];
  return <div className={`mb-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
