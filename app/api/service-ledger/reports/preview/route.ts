import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reportBuilderSchema } from "@/lib/validation-service-ledger";
import { buildClientServiceReportPdf } from "@/lib/pdf/clientServiceReportData";

/**
 * Configure -> PREVIEW -> Generate (spec §54): builds and streams the
 * same PDF generateClientServiceReportCore would produce, but never
 * writes an archival row or touches storage — a genuinely separate code
 * path from "Generate", not a client-side re-render.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const formData = await req.formData();
  const parsed = reportBuilderSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "داده نامعتبر است." }, { status: 400 });

  try {
    const { buffer, fileName } = await buildClientServiceReportPdf(supabase, parsed.data);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (err) {
    console.error("POST /api/service-ledger/reports/preview failed", err);
    return NextResponse.json({ error: "تولید پیش‌نمایش ناموفق بود." }, { status: 500 });
  }
}
