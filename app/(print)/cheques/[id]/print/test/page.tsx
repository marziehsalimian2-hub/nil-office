import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PrintSheet } from "@/components/cheque/PrintSheet";
import { loadChequePrintContext } from "@/lib/cheque/printContext";
import { PrintTrigger } from "../PrintTrigger";

export const dynamic = "force-dynamic";

/**
 * Test print — plain paper, calibration grid overlaid, NEVER changes
 * cheque status/print_count (spec §19). Use this to check alignment
 * before ever touching a real bank leaf, then adjust the template's
 * global offset and test again. Deliberately outside (app) — see the
 * comment in ../page.tsx for why.
 */
export default async function ChequePrintTestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile();
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
        <div className="flex items-center gap-2">
          <Link href={`/cheques/templates/${template.id}`} className="btn-ghost">
            تنظیم قالب چاپ
          </Link>
          <PrintTrigger chequeId={cheque.id} templateId={template.id} isTestPrint={true} />
        </div>
      </div>
      <div className="no-print mb-4 rounded-lg bg-status-waiting/10 px-4 py-3 text-sm text-ink">
        این یک چاپ آزمایشی روی کاغذ سفید است — وضعیت یا شمارندهٔ چاپ چک تغییر نمی‌کند. برای هم‌ترازی، شبکهٔ راهنما (هر خانه ۱۰ میلی‌متر) نمایش داده می‌شود.
      </div>
      <PrintSheet cheque={cheque} template={template} fields={fields} bankAccountInfo={bankAccountInfo} showGrid />
    </div>
  );
}
