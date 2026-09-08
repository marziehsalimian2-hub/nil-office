import type { Metadata } from "next";
import Image from "next/image";
import { getTradeBuyerView } from "@/lib/trade/buyer";
import { CountdownTimer } from "./CountdownTimer";
import { ResponseForm } from "./ResponseForm";
import { DocumentUpload } from "./DocumentUpload";
import { formatMoney } from "@/lib/money";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import { CURRENCY_LABEL, TRADE_LEGAL_DISCLAIMER, type Currency } from "@/lib/enums";

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

  return (
    <Shell>
      <div className="space-y-5">
        <div className="card p-5">
          <p className="text-xs text-ink-muted">{toFaDigits(offer.offer_code)}</p>
          <h1 className="mt-1 text-lg font-semibold text-ink">{offer.title}</h1>

          {(view.uiState === "OFFER_CLOSED" || view.uiState === "OFFER_CANCELLED") && (
            <p className="mt-2 text-sm text-status-cancelled">{FAILURE_MESSAGES[view.uiState]}</p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><p className="text-ink-muted">محصول</p><p className="text-ink">{offer.product_name}</p></div>
            <div><p className="text-ink-muted">مقدار</p><p className="tnum text-ink">{toFaDigits(offer.quantity)} {offer.unit}</p></div>
            <div><p className="text-ink-muted">قیمت واحد</p><p className="tnum text-ink">{formatMoney(offer.price)} {currencyLabel}</p></div>
            <div><p className="text-ink-muted">مبنای قیمت</p><p className="text-ink">{offer.price_basis}</p></div>
            {offer.origin && <div><p className="text-ink-muted">مبدأ</p><p className="text-ink">{offer.origin}</p></div>}
            {offer.delivery_location && <div><p className="text-ink-muted">محل تحویل</p><p className="text-ink">{offer.delivery_location}</p></div>}
          </div>

          {offer.delivery_terms && <p className="mt-3 text-sm text-ink-muted"><span className="font-medium text-ink">شرایط تحویل: </span>{offer.delivery_terms}</p>}
          {offer.payment_terms && <p className="mt-1 text-sm text-ink-muted"><span className="font-medium text-ink">شرایط پرداخت: </span>{offer.payment_terms}</p>}
          {offer.description && <p className="mt-3 whitespace-pre-wrap text-sm text-ink-muted">{offer.description}</p>}
          {offer.terms_and_conditions && (
            <div className="mt-3 border-t border-paper-line pt-3">
              <p className="text-xs font-medium text-ink">شرایط و ضوابط</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{offer.terms_and_conditions}</p>
            </div>
          )}
        </div>

        {(view.uiState === "ACTIVE" || view.uiState === "INTEREST_DEADLINE_EXPIRED" || view.uiState === "DOCUMENT_DEADLINE_EXPIRED") && (
          <div className="grid grid-cols-2 gap-3">
            <CountdownTimer label="مهلت اعلام تمایل" deadlineIso={offer.interest_deadline} expired={!offer.interest_open} />
            <CountdownTimer label="مهلت ارسال LOI/ICPO" deadlineIso={offer.document_deadline} expired={!offer.document_open} />
          </div>
        )}

        {/* Required legal notice (spec §18) — always visible, normal size, never hidden. */}
        <div className="card border-paper-line bg-paper-card p-4 text-sm leading-7 text-ink-muted">
          {TRADE_LEGAL_DISCLAIMER}
        </div>

        {view.uiState !== "OFFER_CLOSED" && view.uiState !== "OFFER_CANCELLED" && (
          <>
            <ResponseForm token={token} disabled={!offer.interest_open} latest={assignment.latest_response_type} />
            <DocumentUpload token={token} disabled={!offer.document_open} />
          </>
        )}

        {assignment.latest_response_at && (
          <p className="text-center text-xs text-ink-muted">
            آخرین پاسخ ثبت‌شده: {formatJalali(assignment.latest_response_at)}
          </p>
        )}
      </div>
    </Shell>
  );
}
