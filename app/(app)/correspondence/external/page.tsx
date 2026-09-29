import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { Tabs } from "@/components/Tabs";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { EXTERNAL_INTAKE_STATUS_LABEL, EXTERNAL_INTAKE_STATUS_TONE, EXTERNAL_SENDER_TYPE_LABEL, type ExternalIntakeStatus } from "@/lib/enums";
import type { ExternalIntake } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const TAB_STATUS_FILTERS: { label: string; statuses: ExternalIntakeStatus[] | null }[] = [
  { label: "در انتظار بررسی", statuses: ["PENDING_REVIEW", "UNDER_REVIEW"] },
  { label: "نیازمند اطلاعات", statuses: ["NEEDS_INFORMATION"] },
  { label: "ثبت‌شده", statuses: ["REGISTERED"] },
  { label: "پاسخ‌داده‌شده", statuses: ["REPLIED"] },
  { label: "رد‌شده", statuses: ["REJECTED"] },
  { label: "همه", statuses: null },
];

function IntakeRow({ intake, company }: { intake: ExternalIntake; company: { legal_name: string } | null }) {
  const senderLabel = intake.sender_org_name_raw || intake.sender_full_name || "—";
  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <Link href={`/correspondence/external/${intake.id}`} className="text-sm text-seal hover:underline">
            {intake.subject || "بدون موضوع"}
          </Link>
          <p className="mt-0.5 text-xs text-ink-muted">
            {senderLabel}
            {intake.sender_type && ` (${EXTERNAL_SENDER_TYPE_LABEL[intake.sender_type]})`}
            {company ? ` — پیوندشده به ${company.legal_name}` : ""}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span className="tnum">{formatJalali(intake.created_at)}</span>
            <span>کد رهگیری: {intake.tracking_code}</span>
          </p>
        </div>
        <span className={`badge bg-paper ${EXTERNAL_INTAKE_STATUS_TONE[intake.status]}`}>{EXTERNAL_INTAKE_STATUS_LABEL[intake.status]}</span>
      </div>
    </li>
  );
}

export default async function ExternalCorrespondenceInboxPage() {
  const profile = await requireProfile();
  const canView = profile.role === "ADMIN" || profile.external_correspondence_role != null;
  const supabase = await createClient();

  if (!canView) {
    return (
      <div>
        <PageHeader title="مکاتبات خارجی در انتظار بررسی" />
        <Card>
          <p className="text-sm text-ink-muted">این بخش نیاز به دسترسی ماژول مکاتبات خارجی دارد.</p>
        </Card>
      </div>
    );
  }

  const { data: intakesData } = await supabase.from("external_intakes").select("*").order("created_at", { ascending: false }).limit(200);
  const intakes = (intakesData ?? []) as ExternalIntake[];

  const companyIds = Array.from(new Set(intakes.map((i) => i.company_id).filter((id): id is string => !!id)));
  const { data: companiesData } =
    companyIds.length > 0 ? await supabase.from("companies").select("id, legal_name").in("id", companyIds) : { data: [] };
  const companyById = new Map(((companiesData ?? []) as { id: string; legal_name: string }[]).map((c) => [c.id, c]));

  const tabs = TAB_STATUS_FILTERS.map((t) => {
    const rows = t.statuses ? intakes.filter((i) => t.statuses!.includes(i.status)) : intakes;
    return {
      label: `${t.label} (${toFaDigits(rows.length)})`,
      content:
        rows.length === 0 ? (
          <EmptyState title="مکاتبه‌ای در این وضعیت وجود ندارد." />
        ) : (
          <Card>
            <ul className="divide-y divide-paper-line/60">
              {rows.map((intake) => (
                <IntakeRow key={intake.id} intake={intake} company={intake.company_id ? (companyById.get(intake.company_id) ?? null) : null} />
              ))}
            </ul>
          </Card>
        ),
    };
  });

  return (
    <div>
      <PageHeader title="مکاتبات خارجی در انتظار بررسی" subtitle="ارسال‌شده از طریق ربات مکاتبات خارجی تلگرام" />
      <Tabs tabs={tabs} />
    </div>
  );
}
