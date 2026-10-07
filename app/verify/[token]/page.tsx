import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import { toFaDigits, formatJalali } from "@/lib/jalali";
import { allowRequest, clientIp, lookupPublicVerification, PAGE_LIMIT } from "@/lib/verify/public";
import { publicRows, publicTypeLabel } from "@/lib/verify/display";
import { HashCheck } from "./HashCheck";

export const dynamic = "force-dynamic";
// Public by design, but never indexed: the identifier is unguessable and meant for the holder of the document only.
export const metadata: Metadata = {
  title: "استعلام اصالت سند | NIL Verify",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper px-4 py-8 print:bg-white">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <Image src="/nil-logo.png" alt="نیل" width={40} height={50} className="h-10 w-auto rounded-md bg-white p-0.5" priority />
          <div>
            <p className="text-sm font-semibold text-ink">شرکت توسعه مدیریت راهبردی نیل</p>
            <p className="text-xs text-ink-muted">استعلام اصالت سند — NIL Verify</p>
          </div>
        </div>
        {children}
        <p className="mt-6 text-center text-[11px] leading-6 text-ink-muted">
          این صفحه تأیید می‌کند که سند با مشخصات بالا در NIL Office ثبت شده است. این سامانه «امضای دیجیتال قانونی» یا «گواهی امضای الکترونیکی رسمی» نیست.
        </p>
      </div>
    </main>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between gap-4 border-b border-paper-line py-2 last:border-0">
    <dt className="shrink-0 text-xs text-ink-muted">{label}</dt>
    <dd className="text-end text-sm text-ink">{value}</dd>
  </div>
);

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();

  if (!(await allowRequest(PAGE_LIMIT, clientIp(h)))) {
    return (
      <Shell>
        <div className="card p-6 text-center text-sm text-ink">تعداد درخواست‌ها زیاد است؛ لطفاً چند دقیقه بعد دوباره تلاش کنید.</div>
      </Shell>
    );
  }

  const v = await lookupPublicVerification(token);
  if (!v.found) {
    return (
      <Shell>
        <div className="card p-6 text-center">
          <p className="text-sm font-medium text-ink">سندی با این شناسه قابل تأیید نیست.</p>
          <p className="mt-2 text-xs text-ink-muted">لطفاً از صحت QR یا پیوند بررسی کنید.</p>
        </div>
      </Shell>
    );
  }

  const tone =
    v.status === "ACTIVE"
      ? { box: "border-status-final/40 bg-status-final/5", text: "✓ سند معتبر است", sub: "این سند در NIL Office ثبت و صادر شده و در حال حاضر معتبر است." }
      : v.status === "REVOKED"
        ? { box: "border-status-cancelled/40 bg-status-cancelled/5", text: "⚠ این سند ابطال شده است", sub: v.revoked_at ? `تاریخ ابطال: ${formatJalali(v.revoked_at)}` : "" }
        : { box: "border-status-waiting/40 bg-status-waiting/5", text: "⚠ این سند با سند دیگری جایگزین شده است", sub: v.replacement ? `سند جایگزین: ${publicTypeLabel(v.replacement.document_type)} شمارهٔ ${toFaDigits(v.replacement.document_number)}` : "" };

  const rows = publicRows(v.document_type, v.metadata);

  return (
    <Shell>
      <div className={`rounded-xl border px-5 py-4 ${tone.box}`} role="status">
        <p className="text-lg font-semibold text-ink">{tone.text}</p>
        {tone.sub && <p className="mt-1 text-sm text-ink-muted">{tone.sub}</p>}
      </div>

      <section className="card mt-4 p-5">
        <dl>
          <Row label="صادرکننده" value={v.issuer} />
          <Row label="نوع سند" value={publicTypeLabel(v.document_type)} />
          <Row label="شمارهٔ سند" value={toFaDigits(v.document_number)} />
          <Row label="تاریخ صدور" value={formatJalali(v.issued_at)} />
          {rows.map((r) => (<Row key={r.label} label={r.label} value={r.value} />))}
          <Row label="کد استعلام" value={v.code} />
        </dl>
      </section>

      <HashCheck token={token} />
    </Shell>
  );
}
