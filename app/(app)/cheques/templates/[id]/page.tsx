import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { toFaDigits } from "@/lib/jalali";
import { GlobalOffsetForm } from "./GlobalOffsetForm";
import { FieldForm, AddFieldForm } from "./FieldForm";
import type { ChequePrintTemplate, ChequePrintTemplateField } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function ChequeTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: template }, { data: fields }] = await Promise.all([
    supabase.from("cheque_print_templates").select("*").eq("id", id).single(),
    supabase.from("cheque_print_template_fields").select("*").eq("template_id", id).order("field_key"),
  ]);
  if (!template) notFound();
  const t = template as ChequePrintTemplate;
  const fieldRows = (fields ?? []) as ChequePrintTemplateField[];

  return (
    <div>
      <PageHeader
        title={`تنظیم قالب چاپ — ${t.name}`}
        subtitle={`ابعاد برگه: ${toFaDigits(t.page_width_mm)} × ${toFaDigits(t.page_height_mm)} میلی‌متر`}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-medium text-ink">مختصات فیلدها (میلی‌متر)</h2>
          {fieldRows.map((f) => (
            <FieldForm key={f.id} field={f} />
          ))}
          <AddFieldForm templateId={t.id} existingKeys={fieldRows.map((f) => f.field_key)} />
        </div>
        <Card>
          <h2 className="mb-3 text-sm font-medium text-ink">افست کلی چاپگر</h2>
          <p className="mb-3 text-xs text-ink-muted">
            برای جبران اختلاف چاپگرهای مختلف — بدون نیاز به تغییر تک‌تک فیلدها. ابتدا چاپ آزمایشی بگیرید، انحراف واقعی را اندازه‌گیری کنید، سپس این مقدار را تنظیم و دوباره چاپ آزمایشی بگیرید.
          </p>
          <GlobalOffsetForm templateId={t.id} offsetX={t.offset_x_mm} offsetY={t.offset_y_mm} />
        </Card>
      </div>
    </div>
  );
}
