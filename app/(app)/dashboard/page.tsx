import Link from "next/link";
import { Send, Inbox, FileText, FolderOpen, Plus, FileSignature, Receipt, Target, FolderKanban, ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, StatCard, Card, EmptyState, StatusBadge } from "@/components/ui";
import { AttentionList } from "./AttentionList";
import { CurrencyAmountList } from "./CurrencyAmountList";
import { getAttentionItems } from "@/lib/dashboard/attention";
import { getTodaySummary } from "@/lib/dashboard/today";
import { getFinancialSummary } from "@/lib/dashboard/financial";
import { getCrmSummary } from "@/lib/dashboard/crm";
import { getProjectsSummary } from "@/lib/dashboard/projects";
import { getContractsSummary } from "@/lib/dashboard/contracts";
import { getInvoiceSummary } from "@/lib/dashboard/invoices";
import { getCorrespondenceSummary } from "@/lib/dashboard/correspondence";
import { getFollowupsSummary } from "@/lib/dashboard/followups";
import { getRecentActivity } from "@/lib/dashboard/activity";
import { DIRECTION_LABEL, type CorrStatus } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";

export const dynamic = "force-dynamic";

/** Error isolation (spec §55) — one section's aggregation failing must not blank the whole page. */
async function unwrap<T>(p: Promise<T>, label: string): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error(`[dashboard] ${label} section failed`, err);
    return null;
  }
}

function SectionError() {
  return <p className="text-sm text-ink-muted">این بخش موقتاً در دسترس نیست.</p>;
}

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("app_settings")
    .select("dashboard_contract_expiry_days, dashboard_project_ending_soon_days")
    .eq("id", 1)
    .single();
  const contractExpiryDays = settings?.dashboard_contract_expiry_days ?? 30;
  const projectEndingSoonDays = settings?.dashboard_project_ending_soon_days ?? 14;

  const [attention, today, financial, crm, projects, contracts, invoices, correspondence, followups, activity] = await Promise.all([
    unwrap(getAttentionItems(supabase, profile, { contractExpiryDays }), "attention"),
    unwrap(getTodaySummary(supabase, profile.id, profile), "today"),
    unwrap(getFinancialSummary(supabase, profile), "financial"),
    unwrap(getCrmSummary(supabase, profile), "crm"),
    unwrap(getProjectsSummary(supabase, profile, projectEndingSoonDays), "projects"),
    unwrap(getContractsSummary(supabase, profile, contractExpiryDays), "contracts"),
    unwrap(getInvoiceSummary(supabase, profile), "invoices"),
    unwrap(getCorrespondenceSummary(supabase), "correspondence"),
    unwrap(getFollowupsSummary(supabase), "followups"),
    unwrap(getRecentActivity(supabase), "activity"),
  ]);

  const quick = [
    { href: "/correspondence/outgoing/new", label: "نامه صادره", icon: Send },
    { href: "/correspondence/incoming/new", label: "نامه وارده", icon: Inbox },
    { href: "/documents/new", label: "سند جدید", icon: FileText },
    { href: "/cases/new", label: "پرونده جدید", icon: FolderOpen },
    { href: "/contracts/new", label: "قرارداد جدید", icon: FileSignature },
    { href: "/invoices/new", label: "فاکتور/پیش‌فاکتور جدید", icon: Receipt },
    { href: "/opportunities/new", label: "فرصت تجاری جدید", icon: Target },
    { href: "/projects/new", label: "پروژه جدید", icon: FolderKanban },
    { href: "/tasks/new", label: "کار جدید", icon: ListChecks },
  ];

  return (
    <div>
      <PageHeader title="مرکز فرمان نیل" subtitle="نمای یکپارچه وضعیت شرکت و موارد نیازمند اقدام" />

      <div className="mb-6 flex flex-wrap gap-2">
        {quick.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="btn-ghost">
            <Plus className="h-4 w-4 text-seal" />
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </div>

      {/* A. نیازمند توجه شما */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">نیازمند توجه شما</h2>
        <Card>{attention === null ? <SectionError /> : <AttentionList items={attention} />}</Card>
      </section>

      {/* B. امروز */}
      {today && (today.dueTodayCount > 0 || today.overdueCount > 0) && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">امروز</h2>
          <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-2">
            <StatCard label="سررسید امروز" value={toFaDigits(today.dueTodayCount)} />
            <StatCard label="عقب‌افتادهٔ من" value={toFaDigits(today.overdueCount)} tone="danger" />
          </div>
          <Card>
            <ul className="divide-y divide-paper-line/60">
              {today.items.map((it) => (
                <li key={it.id} className="py-2">
                  <Link href={it.navigation_target} className="text-sm text-ink hover:text-seal">
                    {it.overdue && <span className="ml-2 text-status-cancelled">●</span>}
                    {it.title}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* C. وضعیت مالی — never rendered at all for a non-accounting user (spec §58). */}
      {financial && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">وضعیت مالی{financial.fiscalYearTitle ? ` — ${financial.fiscalYearTitle}` : ""}</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <p className="mb-3 text-sm font-medium text-ink">موجودی بانک و صندوق</p>
              {financial.bankPositions.length === 0 ? (
                <p className="text-sm text-ink-muted">حساب بانکی/صندوقی ثبت نشده است.</p>
              ) : (
                <ul className="divide-y divide-paper-line/60">
                  {financial.bankPositions.map((b) => (
                    <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-ink-muted">{b.label}</span>
                      <span className="tnum font-medium text-ink">{formatMoneyLike(b.balance)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <p className="mb-3 text-sm font-medium text-ink">درآمد / هزینه / نتیجهٔ خالص (سال مالی جاری)</p>
              <ul className="space-y-1.5 text-sm">
                <li className="flex justify-between"><span className="text-ink-muted">درآمد</span><span className="tnum font-medium text-ink">{formatMoneyLike(financial.revenue)}</span></li>
                <li className="flex justify-between"><span className="text-ink-muted">هزینه</span><span className="tnum font-medium text-ink">{formatMoneyLike(financial.expense)}</span></li>
                <li className="flex justify-between border-t border-paper-line pt-1.5"><span className="text-ink-muted">نتیجهٔ خالص</span><span className="tnum font-semibold text-ink">{formatMoneyLike(financial.netResult)}</span></li>
              </ul>
            </Card>
          </div>
        </section>
      )}

      {/* D. فروش و CRM */}
      {crm && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">فروش و CRM</h2>
          <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="فرصت‌های باز" value={toFaDigits(crm.openCount)} href="/opportunities?status=open" />
            <StatCard label="موفق" value={toFaDigits(crm.wonCount)} tone="seal" href="/opportunities?status=won" />
            <StatCard label="بدون فعالیت" value={toFaDigits(crm.staleCount)} tone="warn" href="/opportunities?status=stale" />
            <StatCard label="اقدام بعدی عقب‌افتاده" value={toFaDigits(crm.nextActionOverdueCount)} tone="warn" href="/opportunities?status=next_action_overdue" />
            <StatCard label="لیدهای جدید (۷ روز)" value={toFaDigits(crm.newLeadsCount)} />
          </div>
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">ارزش پایپ‌لاین (فرصت‌های باز)</p>
            <CurrencyAmountList amounts={crm.pipelineValueByCurrency} emptyText="فرصت باز با مبلغ ثبت‌شده وجود ندارد." />
          </Card>
        </section>
      )}

      {/* E. پروژه‌ها و اجرا */}
      {projects && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">پروژه‌ها و اجرا</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="پروژه‌های فعال" value={toFaDigits(projects.activeCount)} href="/projects?tab=active" />
            <StatCard label="در معرض خطر" value={toFaDigits(projects.atRiskCount)} tone="warn" href="/projects?tab=at_risk" />
            <StatCard label="عقب‌افتاده" value={toFaDigits(projects.delayedCount)} tone="danger" href="/projects?tab=overdue" />
            <StatCard label={`نزدیک به پایان (${toFaDigits(projectEndingSoonDays)} روز)`} value={toFaDigits(projects.endingSoonCount)} />
            <StatCard label="کارهای عقب‌افتاده" value={toFaDigits(projects.overdueTaskCount)} tone="danger" href="/tasks?due=overdue" />
            <StatCard label="کارهای مسدود" value={toFaDigits(projects.blockedTaskCount)} tone="warn" href="/tasks?status=BLOCKED" />
            <StatCard label="تحویل‌دادنی‌های در جریان" value={toFaDigits(projects.pendingDeliverableCount)} />
          </div>
        </section>
      )}

      {/* F. قراردادها */}
      {contracts && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">قراردادها</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="قراردادهای فعال" value={toFaDigits(contracts.activeCount)} tone="seal" href="/contracts?status=ACTIVE" />
            <StatCard label={`نزدیک به پایان (${toFaDigits(contractExpiryDays)} روز)`} value={toFaDigits(contracts.expiringCount)} tone="warn" href="/contracts?status=EXPIRING_SOON" />
            <StatCard label="منقضی اما همچنان فعال" value={toFaDigits(contracts.expiredStillActiveCount)} tone="danger" />
            <StatCard label="معلق" value={toFaDigits(contracts.suspendedCount)} href="/contracts?status=SUSPENDED" />
          </div>
        </section>
      )}

      {/* G. فاکتورها و وصول */}
      {invoices && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">فاکتورها و وصول</h2>
          <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="صادرشده" value={toFaDigits(invoices.issuedCount)} href="/invoices?tab=unpaid" />
            <StatCard label="تسویه‌شده" value={toFaDigits(invoices.settledCount)} tone="seal" href="/invoices?tab=settled" />
            <StatCard label="عقب‌افتاده از سررسید" value={toFaDigits(invoices.overdueCount)} tone="danger" href="/invoices?tab=overdue" />
            <StatCard label="نیمه‌تسویه" value={toFaDigits(invoices.partiallySettledCount)} />
          </div>
          <Card>
            <p className="mb-3 text-sm font-medium text-ink">مطالبات معوق (به تفکیک واحد پول)</p>
            <CurrencyAmountList amounts={invoices.outstandingByCurrency} emptyText="مطالبات معوقی وجود ندارد." />
          </Card>
        </section>
      )}

      {/* H. مکاتبات و پیگیری‌ها */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">مکاتبات و پیگیری‌ها</h2>
        <div className="mb-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {correspondence ? (
            <>
              <StatCard label="صادره امروز" value={toFaDigits(correspondence.outgoingToday)} tone="seal" />
              <StatCard label="وارده امروز" value={toFaDigits(correspondence.incomingToday)} tone="seal" />
              <StatCard label="در انتظار پاسخ" value={toFaDigits(correspondence.waitingResponse)} tone="warn" href="/correspondence/outgoing" />
              <StatCard label="پیش‌نویس / بررسی" value={toFaDigits(correspondence.draftsInReview)} />
            </>
          ) : (
            <div className="col-span-full"><SectionError /></div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {followups ? (
            <>
              <StatCard label="پیگیری سررسید امروز" value={toFaDigits(followups.dueToday)} href="/followups" />
              <StatCard label="پیگیری عقب‌افتاده" value={toFaDigits(followups.overdue)} tone="danger" href="/followups" />
              <StatCard label="پیگیری آینده" value={toFaDigits(followups.upcoming)} href="/followups" />
            </>
          ) : (
            <div className="col-span-full"><SectionError /></div>
          )}
        </div>
      </section>

      {/* مکاتبات اخیر */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">مکاتبات اخیر</h2>
        {correspondence && correspondence.recent.length > 0 ? (
          <Card className="p-0">
            <table className="w-full">
              <thead><tr className="table-head">
                <th className="px-4 py-3">شماره</th><th className="px-4 py-3">نوع</th><th className="px-4 py-3">موضوع</th>
                <th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">تاریخ</th>
              </tr></thead>
              <tbody>
                {correspondence.recent.map((r) => (
                  <tr key={r.id} className="table-row">
                    <td className="px-4 py-3"><Link href={`/correspondence/${r.id}`} className="tnum font-medium text-ink hover:text-seal">{r.display_number ?? "—"}</Link></td>
                    <td className="px-4 py-3 text-ink-muted">{DIRECTION_LABEL[r.direction as "OUTGOING" | "INCOMING"]}</td>
                    <td className="max-w-xs truncate px-4 py-3">{r.subject ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status as CorrStatus} /></td>
                    <td className="px-4 py-3 text-ink-muted tnum">{formatJalali(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : correspondence ? (
          <EmptyState title="هنوز مکاتبه‌ای ثبت نشده است." hint="با ثبت اولین نامه صادره یا وارده شروع کنید." />
        ) : (
          <SectionError />
        )}
      </section>

      {/* I. فعالیت‌های اخیر */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">فعالیت‌های اخیر</h2>
        <Card>
          {activity === null ? (
            <SectionError />
          ) : activity.length === 0 ? (
            <p className="text-sm text-ink-muted">فعالیت اخیری ثبت نشده است.</p>
          ) : (
            <ul className="divide-y divide-paper-line/60">
              {activity.map((a) => (
                <li key={a.id} className="py-2.5">
                  <Link href={a.navigation_target} className="block text-sm text-ink hover:text-seal">{a.text}</Link>
                  <p className="mt-0.5 text-xs text-ink-muted tnum">{formatJalali(a.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function formatMoneyLike(n: number): string {
  return toFaDigits(Math.round(n).toLocaleString("en-US"));
}
