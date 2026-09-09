import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildInvoicePdf } from "@/lib/pdf/invoiceData";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const noStamp = req.nextUrl.searchParams.get("no_stamp") === "1";

  try {
    const { buffer, fileName } = await buildInvoicePdf(supabase, id, { noStamp });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        // RFC 5987 filename* carries the real (Persian) name in every current
        // browser; the plain filename= is a safe ASCII fallback for the rest.
        "Content-Disposition": `inline; filename="invoice-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (err) {
    console.error("GET /api/invoices/[id]/pdf failed", err);
    return NextResponse.json({ error: "تولید PDF ناموفق بود." }, { status: 500 });
  }
}
