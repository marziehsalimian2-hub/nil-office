import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { stampVerificationQr } from "@/lib/verify/stamp";
import { layoutSchema } from "@/lib/verify/layout";
import { VERIFY_DOCUMENT_TYPES, type VerifyDocumentType } from "@/lib/verify/types";

export const dynamic = "force-dynamic";

const A4: [number, number] = [595.28, 841.89];

/**
 * ADMIN-only layout preview: a blank A4 page with the REAL letterhead image and the verification plate placed with the CURRENT (or
 * query-supplied) layout, so the QR can be positioned away from the letterhead artwork. Uses a fake token — it is not a verification
 * and nothing is stored.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const type = req.nextUrl.searchParams.get("type") as VerifyDocumentType | null;
  if (!type || !(VERIFY_DOCUMENT_TYPES as readonly string[]).includes(type)) return NextResponse.json({ error: "نوع سند نامعتبر است." }, { status: 400 });

  // verify_get_settings is ADMIN-only inside the database; anyone else simply gets an error here
  const { data: cfg, error } = await supabase.rpc("verify_get_settings");
  if (error || !cfg) return NextResponse.json({ error: "دسترسی ندارید." }, { status: 403 });
  const row = ((cfg as { types: Record<string, unknown>[] }).types ?? []).find((t) => t.document_type === type);
  if (!row) return NextResponse.json({ error: "تنظیماتی برای این نوع سند نیست." }, { status: 404 });

  const layout = layoutSchema.safeParse({
    page: row.page, x_mm: row.x_mm, y_mm: row.y_mm, size_mm: row.size_mm,
    show_label: row.show_label, show_code: row.show_code, label_text: row.label_text,
  });
  if (!layout.success) return NextResponse.json({ error: "چیدمان نامعتبر است." }, { status: 422 });

  try {
    const doc = await PDFDocument.create();
    const page = doc.addPage(A4);

    const { data: settings } = await supabase.from("app_settings").select("letterhead_path").eq("id", 1).single();
    const lp = settings?.letterhead_path as string | null | undefined;
    if (lp && /\.(png|jpe?g)$/i.test(lp)) {
      const { data: file } = await supabase.storage.from("nil-files").download(lp);
      if (file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const img = /\.png$/i.test(lp) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        page.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
      }
    }
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("LAYOUT PREVIEW - not a real verification", { x: 36, y: A4[1] - 24, size: 8, font, color: rgb(0.6, 0.1, 0.1) });

    const stamped = await stampVerificationQr(await doc.save(), {
      url: `https://example.com/verify/${"A".repeat(43)}`,
      code: "NIL-V-XXXX-XXXX",
      layout: layout.data,
    });
    return new NextResponse(new Uint8Array(stamped.bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="verify-layout-${type}.pdf"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    console.error("GET /api/verify/preview failed", e);
    return NextResponse.json({ error: "ساخت پیش‌نمایش ناموفق بود (چیدمان ممکن است خارج از صفحه باشد)." }, { status: 500 });
  }
}
