import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { formatJalali } from "@/lib/jalali";
import { checkSimilarCompanies } from "@/app/actions/crm-duplicates";
import {
  EXTERNAL_INTAKE_STATUS_LABEL,
  EXTERNAL_INTAKE_STATUS_TONE,
  EXTERNAL_SENDER_TYPE_LABEL,
  EXTERNAL_INTAKE_EVENT_TYPE_LABEL,
} from "@/lib/enums";
import type { ExternalIntake, ExternalIntakeDocument, ExternalIntakeEvent } from "@/lib/types/database";
import { ExternalIntakeReviewActions } from "./ExternalIntakeReviewActions";

export const dynamic = "force-dynamic";

export default async function ExternalIntakeReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const canReview = profile.role === "ADMIN" || profile.external_correspondence_role != null;
  if (!canReview) notFound();

  const supabase = await createClient();
  const { data: intakeData } = await supabase.from("external_intakes").select("*").eq("id", id).single();
  if (!intakeData) notFound();
  const intake = intakeData as ExternalIntake;

  const [{ data: docsData }, { data: eventsData }, { data: profilesData }, { data: companiesData }, { data: casesData }] = await Promise.all([
    supabase.from("external_intake_documents").select("*").eq("intake_id", id).order("uploaded_at", { ascending: true }),
    supabase.from("external_intake_events").select("*").eq("intake_id", id).order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("companies").select("id, legal_name").order("legal_name").limit(500),
    supabase.from("cases").select("id, title, case_code").order("created_at", { ascending: false }).limit(200),
  ]);

  const documents = (docsData ?? []) as ExternalIntakeDocument[];
  const events = (eventsData ?? []) as ExternalIntakeEvent[];
  const profiles = ((profilesData ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, label: p.full_name ?? "—" }));
  const companies = (companiesData ?? []) as { id: string; legal_name: string }[];
  const cases = (casesData ?? []) as { id: string; title: string; case_code: string | null }[];

  // Signed URLs for internal reviewers only (spec §13) — 1hr expiry, minted per render, never a public/permanent URL.
  const signedUrls = new Map<string, string>();
  await Promise.all(
    documents.map(async (d) => {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(d.storage_path, 3600);
      if (data?.signedUrl) signedUrls.set(d.id, data.signedUrl);
    }),
  );

  // Possible Company match (spec §6/§23/§64) — advisory only, never auto-merge.
  const similarCompanies = await checkSimilarCompanies(intake.sender_org_name_raw || intake.sender_full_name || "", intake.sender_email || undefined, intake.sender_mobile || undefined);

  // Duplicate document detection (spec §51) — advisory flag only, based on sha256 matches in OTHER intakes.
  const hashes = documents.map((d) => d.sha256_hash);
  const { data: dupData } =
    hashes.length > 0
      ? await supabase.from("external_intake_documents").select("intake_id, sha256_hash").in("sha256_hash", hashes).neq("intake_id", id)
      : { data: [] };
  const duplicateHashes = new Set(((dupData ?? []) as { sha256_hash: string }[]).map((d) => d.sha256_hash));

  const currentAssigneeLabel = intake.assigned_to ? (profiles.find((p) => p.id === intake.assigned_to)?.label ?? "—") : null;
  const currentCompanyLabel = intake.company_id ? (companies.find((c) => c.id === intake.company_id)?.legal_name ?? "—") : null;
  const currentCaseLabel = intake.case_id ? (cases.find((c) => c.id === intake.case_id)?.title ?? "—") : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={intake.subject || "بدون موضوع"}
        subtitle={`کد رهگیری: ${intake.tracking_code}`}
        action={<span className={`badge bg-paper ${EXTERNAL_INTAKE_STATUS_TONE[intake.status]}`}>{EXTERNAL_INTAKE_STATUS_LABEL[intake.status]}</span>}
      />

      <Card className="space-y-2">
        <p className="text-sm font-medium text-ink">اطلاعات فرستنده</p>
        <div className="grid gap-2 text-sm text-ink sm:grid-cols-2">
          <p>نوع: {intake.sender_type ? EXTERNAL_SENDER_TYPE_LABEL[intake.sender_type] : "—"}</p>
          {intake.sender_org_name_raw && <p>سازمان (اعلام‌شده): {intake.sender_org_name_raw}</p>}
          <p>نام: {intake.sender_full_name || "—"}</p>
          {intake.sender_position && <p>سمت: {intake.sender_position}</p>}
          {intake.sender_mobile && <p>موبایل: {intake.sender_mobile}</p>}
          {intake.sender_email && <p>ایمیل: {intake.sender_email}</p>}
        </div>
        {similarCompanies.length > 0 && (
          <div className="mt-2 rounded-lg border border-paper-line bg-paper/40 p-2">
            <p className="mb-1 text-xs font-medium text-ink-muted">شرکت‌های مشابه موجود در سامانه (فقط پیشنهاد — بدون ادغام خودکار):</p>
            <ul className="space-y-1">
              {similarCompanies.map((c) => (
                <li key={c.id} className="text-xs">
                  <Link href={`/companies/${c.id}`} className="text-seal hover:underline">
                    {c.legal_name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-medium text-ink">شرح مکاتبه</p>
        <p className="whitespace-pre-wrap text-sm text-ink">{intake.description || "—"}</p>
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-medium text-ink">فایل‌های ضمیمه</p>
        {documents.length === 0 ? (
          <p className="text-sm text-ink-muted">فایلی ضمیمه نشده است.</p>
        ) : (
          <ul className="divide-y divide-paper-line/60">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <span className="flex-1 text-sm text-ink">{d.file_name_sanitized}</span>
                {duplicateHashes.has(d.sha256_hash) && <span className="badge bg-paper status-waiting">احتمال تکراری</span>}
                {signedUrls.get(d.id) && (
                  <a href={signedUrls.get(d.id)} target="_blank" rel="noopener" className="text-xs text-seal hover:underline">
                    دانلود
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-medium text-ink">خط زمانی</p>
        <ul className="space-y-1">
          {events.map((e) => (
            <li key={e.id} className="text-xs text-ink-muted">
              <span className="tnum">{formatJalali(e.created_at)}</span> — {EXTERNAL_INTAKE_EVENT_TYPE_LABEL[e.event_type] ?? e.event_type}
              {e.event_type === "ADDITIONAL_INFO_RECEIVED" && e.metadata?.text ? `: ${String(e.metadata.text)}` : ""}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-1 text-sm text-ink-muted">
        <p>مسئول فعلی: {currentAssigneeLabel ?? "تعیین‌نشده"}</p>
        <p>شرکت پیوندشده: {currentCompanyLabel ?? "—"}</p>
        <p>پرونده پیوندشده: {currentCaseLabel ?? "—"}</p>
        {intake.internal_note && <p>یادداشت داخلی: {intake.internal_note}</p>}
      </Card>

      <ExternalIntakeReviewActions intake={intake} profiles={profiles} companies={companies} cases={cases} />
    </div>
  );
}
