import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PrintSheet } from "@/components/cheque/PrintSheet";
import { loadChequePrintContext } from "@/lib/cheque/printContext";
import { PrintTrigger } from "./PrintTrigger";

export const dynamic = "force-dynamic";

export default async function ChequePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await loadChequePrintContext(supabase, id);
  if (!ctx) notFound();
  const { cheque, template, fields, bankAccountInfo } = ctx;

  if (!template) {
    return (
      <div className="p-6">
        <p className="text-sm text-status-cancelled">هیچ قالب چاپ فعالی تعریف نشده است.</p>
        <Link href="/cheques/templates/new" className="btn-primary mt-3 inline-flex">
          ساخت قالب چاپ
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/cheques/${cheque.id}`} className="btn-quiet">
          بازگشت
        </Link>
        <PrintTrigger chequeId={cheque.id} templateId={template.id} isTestPrint={false} />
      </div>
      <div className="no-print mb-4 rounded-lg bg-paper px-4 py-3 text-sm text-ink">
        <p className="font-medium">پیش‌نمایش چک — پیش از چاپ بررسی کنید:</p>
        <ul className="mt-1 list-inside list-disc text-ink-muted">
          <li>ذی‌نفع: {cheque.counterparty_name_snapshot}</li>
          <li>تاریخ: {cheque.cheque_date}</li>
          <li>مبلغ: {cheque.amount_in_words}</li>
          {cheque.purpose && <li>بابت: {cheque.purpose}</li>}
        </ul>
      </div>
      <PrintSheet cheque={cheque} template={template} fields={fields} bankAccountInfo={bankAccountInfo} />
    </div>
  );
}
