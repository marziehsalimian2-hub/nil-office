import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer, FlaskConical } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { ChequeStatusBadge } from "@/components/ChequeStatusBadge";
import { ChequeStatusActions } from "./ChequeStatusActions";
import { AttachmentUploader } from "@/components/AttachmentUploader";
import { CHEQUE_DIRECTION_LABEL, CHEQUE_CURRENCY_LABEL } from "@/lib/enums";
import { formatJalali, toFaDigits } from "@/lib/jalali";
import type { Cheque, ChequeBook } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ChequeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireProfile();
  const canApprove = profile.role === "ADMIN" || profile.cheque_role === "APPROVE" || profile.cheque_role === "ADMIN";

  const { data: cheque } = await supabase.from("cheques").select("*").eq("id", id).single();
  if (!cheque) notFound();
  const c = cheque as Cheque;

  const [{ data: book }, { data: attachments }] = await Promise.all([
    c.cheque_book_id ? supabase.from("cheque_books").select("*").eq("id", c.cheque_book_id).single() : Promise.resolve({ data: null }),
    supabase.from("attachments").select("id, file_name, storage_path, created_at").eq("entity_type", "CHEQUE").eq("entity_id", id).order("created_at", { ascending: false }),
  ]);
  const chequeBook = book as ChequeBook | null;

  return (
    <div>
      <PageHeader
        title={`چک ${toFaDigits(c.display_number ?? c.cheque_number)}`}
        subtitle={CHEQUE_DIRECTION_LABEL[c.direction]}
        action={
          c.direction === "PAYABLE" ? (
            <div className="flex gap-2">
              <Link href={`/cheques/${c.id}/print/test`} className="btn-ghost">
                <FlaskConical className="h-4 w-4" /> چاپ آزمایشی
              </Link>
              <Link href={`/cheques/${c.id}/print`} className="btn-seal">
                <Printer className="h-4 w-4" /> چاپ
              </Link>
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <ChequeStatusBadge status={c.status} />
              <span className="text-xs text-ink-muted">
                ایجادشده: {formatJalali(c.created_at)}
              </span>
            </div>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-muted">{c.direction === "PAYABLE" ? "ذی‌نفع" : "صادرکننده"}</dt>
                <dd className="text-ink">{c.counterparty_name_snapshot}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">مبلغ</dt>
                <dd className="tnum text-ink">
                  {toFaDigits(new Intl.NumberFormat("en-US").format(c.amount))} {CHEQUE_CURRENCY_LABEL[c.currency_code] ?? c.currency_code}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-ink-muted">مبلغ به حروف</dt>
                <dd className="text-ink">{c.amount_in_words}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">تاریخ چک</dt>
                <dd className="tnum text-ink">{formatJalali(c.cheque_date)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">شمارهٔ چک</dt>
                <dd className="tnum text-ink" dir="ltr">
                  {toFaDigits(c.cheque_number)}
                </dd>
              </div>
              {c.sayad_id && (
                <div>
                  <dt className="text-ink-muted">شناسهٔ صیاد</dt>
                  <dd className="tnum text-ink" dir="ltr">
                    {toFaDigits(c.sayad_id)}
                  </dd>
                </div>
              )}
              {c.purpose && (
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">بابت</dt>
                  <dd className="text-ink">{c.purpose}</dd>
                </div>
              )}
              {c.direction === "PAYABLE" && chequeBook && (canApprove || profile.cheque_role != null) && (
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">دسته‌چک</dt>
                  <dd className="text-ink">{chequeBook.book_identifier}</dd>
                </div>
              )}
              {c.direction === "RECEIVABLE" && (
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">بانک صادرکننده</dt>
                  <dd className="text-ink">
                    {c.drawer_bank_name} {c.drawer_branch ? `— شعبه ${c.drawer_branch}` : ""}
                  </dd>
                </div>
              )}
              {c.description && (
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">توضیحات</dt>
                  <dd className="text-ink">{c.description}</dd>
                </div>
              )}
              {c.return_reason && (
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">دلیل برگشت</dt>
                  <dd className="text-status-cancelled">{c.return_reason}</dd>
                </div>
              )}
              {c.void_reason && (
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">دلیل ابطال</dt>
                  <dd className="text-status-cancelled">{c.void_reason}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-medium text-ink">پیوست‌ها</h2>
            <div className="mb-4 space-y-2">
              {(attachments ?? []).length === 0 && <p className="text-sm text-ink-muted">پیوستی ثبت نشده است.</p>}
              {(attachments ?? []).map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-paper-line px-3 py-2 text-sm">
                  <span className="text-ink">{a.file_name}</span>
                  <span className="text-xs text-ink-muted">{formatJalali(a.created_at)}</span>
                </div>
              ))}
            </div>
            <AttachmentUploader entityType="CHEQUE" entityId={c.id} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-sm font-medium text-ink">عملیات</h2>
            <ChequeStatusActions chequeId={c.id} direction={c.direction} status={c.status} />
          </Card>

          {c.direction === "PAYABLE" && (
            <Card>
              <h2 className="mb-3 text-sm font-medium text-ink">سابقهٔ چاپ</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">تعداد چاپ</dt>
                  <dd className="tnum text-ink">{toFaDigits(c.print_count)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">اولین چاپ</dt>
                  <dd className="text-ink">{c.first_printed_at ? formatJalali(c.first_printed_at) : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">آخرین چاپ</dt>
                  <dd className="text-ink">{c.last_printed_at ? formatJalali(c.last_printed_at) : "—"}</dd>
                </div>
              </dl>
              {c.print_count > 0 && c.status !== "DRAFT" && (
                <p className="mt-3 rounded-lg bg-status-waiting/10 px-3 py-2 text-xs text-status-waiting">
                  این چک قبلاً چاپ شده است. چاپ مجدد برای چک‌های صادرشده نیاز به مجوز تأییدکننده دارد و ثبت می‌شود.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
