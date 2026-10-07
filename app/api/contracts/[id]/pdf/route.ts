import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildContractPdf } from "@/lib/pdf/contractData";
import { getFrozenPdf } from "@/lib/verify/frozen";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const noStamp = req.nextUrl.searchParams.get("no_stamp") === "1";

  try {
    // NIL Verify: a verified contract is served from its FROZEN file; ?no_stamp=1 keeps the on-demand print-and-sign variant (no QR).
    if (!noStamp) {
      const frozen = await getFrozenPdf(supabase, "CONTRACT", id);
      if (frozen) {
        return new NextResponse(new Uint8Array(frozen.buffer), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="contract-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(`قرارداد-${frozen.number}.pdf`)}`,
            "Cache-Control": "private, no-store",
          },
        });
      }
    }
    const { buffer, fileName } = await buildContractPdf(supabase, id, { noStamp });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        // RFC 5987 filename* carries the real (Persian) name in every current
        // browser; the plain filename= is a safe ASCII fallback for the rest.
        "Content-Disposition": `inline; filename="contract-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (err) {
    console.error("GET /api/contracts/[id]/pdf failed", err);
    return NextResponse.json({ error: "تولید PDF ناموفق بود." }, { status: 500 });
  }
}
