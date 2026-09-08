import type { Metadata } from "next";
import Image from "next/image";
import { getTradeBuyerView } from "@/lib/trade/buyer";
import { CountdownTimer } from "./CountdownTimer";
import { ResponseForm } from "./ResponseForm";
import { DocumentUpload } from "./DocumentUpload";
import { formatMoney } from "@/lib/money";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { CURRENCY_LABEL, TRADE_RESPONSE_TYPE_LABEL, TRADE_LEGAL_DISCLAIMER, type Currency } from "@/lib/enums";

export const dynamic = "force-dynamic";
// Buyer links are unguessable but still shouldn't be indexed/crawled.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const FAILURE_MESSAGES: Record<string, string> = {
  INVALID_LINK: "این لینک معتبر نیست یا اعتبار آن به پایان رسیده است.",
  ACCESS_REVOKED: "دسترسی شما به این آفر توسط شرکت نیل لغو شده است.",
  ACCESS_EXPIRED: "اعتبار این لینک به پایان رسیده است. برای دریافت لینک جدید با کارشناس مربوطه تماس بگیرید.",
  OFFER_NOT_PUBLISHED: "این آفر هنوز منتشر نشده است.",
  OFFER_CLOSED: "این آفر بسته شده و دیگر امکان پاسخ‌گویی وجود ندارد.",
  OFFER_CANCELLED: "این آفر لغو شده است.",
  DOCUMENT_DEADLINE_EXPIRED: "مهلت این آفر به طور کامل به پایان رسیده است.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Image src="/nil-logo.png" alt="نیل" width={40} height={50} className="h-10 w-auto rounded-md bg-white p-0.5" priority />
          <p className="text-sm font-semibold text-ink">شرکت مدیریت راهبردی نیل — پورتال معاملات</p>
        </div>
        {children}
      </div>
    </main>
  );
}

export default async function BuyerOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getTradeBuyerView(token);

  if (!("offer" in view)) {
    return (
      <Shell>
        <div className="card p-6 text-center">
          <p className="text-sm text-ink">{FAILURE_MESSAGES[view.uiState]}</p>
        </div>
      </Shell>
    );
  }

  const { offer, assignment } = view;
  const currencyLabel = CURRENCY_LABEL[offer.currency_code as Currency] ?? offer.currency_code;

  // Contextual status banner (UI-test fix #2): the buyer's own latest
  // response — not just which deadline has passed — decides the copy.
  const isTerminal = view.uiState === "OFFER_CLOSED" || view.uiState === "OFFER_CANCELLED" || view.uiState === "DOCUMENT_DEADLINE_EXPIRED";
  let statusBanner: { text: string; tone: "info" | "warn" } | null = null;
  if (isTerminal) {
    statusBanner = { text: FAILURE_MESSAGES[view.uiState], tone: "warn" };
  } else if (view.uiState === "INTEREST_DEADLINE_EXPIRED") {
    statusBanner = offer.upload_allowed
      ? { text: "اعلام تمایل شما ثبت شده است. تا پایان مهلت تعیین‌شده می‌توانید LOI یا ICPO خود را ارسال کنید.", tone: "info" }
      : { text: "مهلت اعلام تمایل برای این آفر به پایان رسیده و امکان ثبت درخواست جدید وجود ندارد.", tone: "warn" };
  }

  const showResponseForm = !isTerminal && offer.interest_open;
  const showUpload = !isTerminal && offer.document_open && offer.upload_allowed;
  // Buyer is still inside the interest window but hasn't said INTERESTED
  // yet — explain why the upload section isn't showing instead of just
  // omitting it silently (spec §6: unauthorized actions must be visibly
  // disabled/removed, not just absent with no explanation).
  const showUploadHint = !isTerminal && offer.document_open && !offer.upload_allowed && offer.interest_open;

  return (
    <Shell>
      <div className="space-y-5">
        <div className="card p-5">
          <p className="text-xs text-ink-muted">{toFaDigits(offer.offer_code)}</p>
          <h1 className="mt-1 text-lg font-semibold text-ink">{offer.title}</h1>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><p className="text-ink-muted">محصول</p><p className="text-ink">{offer.product_name}</p></div>
            <div><p className="text-ink-muted">مقدار</p><p className="tnum text-ink">{toFaDigits(offer.quantity)} {offer.unit}</p></div>
            <div><p className="text-ink-muted">قیمت واحد</p><p className="tnum text-ink">{formatMoney(offer.price)}</p></div>
            <div><p className="text-ink-muted">واحد پول</p><p className="text-ink">{currencyLabel}</p></div>
            <div><p className="text-ink-muted">مبنای قیمت</p><p className="text-ink">{offer.price_basis}</p></div>
            {offer.delivery_terms && <div><p className="text-ink-muted">شرایط تحویل</p><p className="text-ink">{offer.delivery_terms}</p></div>}
            {offer.origin && <div><p className="text-ink-muted">مبدأ</p><p className="text-ink">{offer.origin}</p></div>}
            {offer.delivery_location && <div><p className="text-ink-muted">محل تحویل</p><p className="text-ink">{offer.delivery_location}</p></div>}
          </div>

          {offer.payment_terms && <p className="mt-3 text-sm text-ink-muted"><span className="font-medium text-ink">شرایط پرداخت: </span>{offer.payment_terms}</p>}
          {offer.description && <p className="mt-3 whitespace-pre-wrap text-sm text-ink-muted">{offer.description}</p>}
          {offer.terms_and_conditions && (
            <div className="mt-3 border-t border-paper-line pt-3">
              <p className="text-xs font-medium text-ink">شرایط و ضوابط</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{offer.terms_and_conditions}</p>
            </div>
          )}
        </div>

        {/* Buyer's own current status (UI-test fix #7) — always visible when a response exists. */}
        {assignment.latest_response_type && (
          <div className="card border-paper-line bg-paper-card p-4">
            <p className="text-xs text-ink-muted">پاسخ شما</p>
            <p className="mt-1 text-sm font-medium text-ink">{TRADE_RESPONSE_TYPE_LABEL[assignment.latest_response_type]}</p>
            {assignment.latest_response_at && (
              <p className="mt-1 text-xs text-ink-muted">ثبت‌شده در {formatJalali(assignment.latest_response_at)}</p>
            )}
          </div>
        )}

        {!isTerminal && (
          <div className="grid grid-cols-2 gap-3">
            <CountdownTimer label="مهلت اعلام تمایل" deadlineIso={offer.interest_deadline} expired={!offer.interest_open} />
            <CountdownTimer label="مهلت ارسال LOI/ICPO" deadlineIso={offer.document_deadline} expired={!offer.document_open} />
          </div>
        )}

        {statusBanner && (
          <div className={`card p-4 text-sm ${statusBanner.tone === "warn" ? "border-status-cancelled/30 bg-status-cancelled/5 text-status-cancelled" : "border-status-received/30 bg-status-received/5 text-ink"}`}>
            {statusBanner.text}
          </div>
        )}

        {/* Required legal notice (spec §18) — always visible, normal size, never hidden. */}
        <div className="card border-paper-line bg-paper-card p-4 text-sm leading-7 text-ink-muted">
          {TRADE_LEGAL_DISCLAIMER}
        </div>

        {showResponseForm && <ResponseForm token={token} latest={assignment.latest_response_type} />}

        {showUpload && <DocumentUpload token={token} />}
        {showUploadHint && (
          <div className="card border-paper-line bg-paper-card p-4 text-sm text-ink-muted">
            برای بارگذاری LOI/ICPO ابتدا باید تمایل خود را با گزینهٔ «علاقه‌مندم» اعلام کنید.
          </div>
        )}
      </div>
    </Shell>
  );
}
