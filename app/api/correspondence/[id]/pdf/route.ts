import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildLetterPdfForCorrespondence } from "@/lib/pdf/letterData";
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
    // NIL Verify: a verified letter is served from its FROZEN file (the exact bytes whose SHA-256 is on record), never re-rendered.
    // ?no_stamp=1 (the print-and-sign variant) keeps the on-demand rendering and carries no QR.
    if (!noStamp) {
      const frozen = await getFrozenPdf(supabase, "OUTGOING_CORRESPONDENCE", id);
      if (frozen) {
        return new NextResponse(new Uint8Array(frozen.buffer), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="letter-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(`نامه-${frozen.number}.pdf`)}`,
            "Cache-Control": "private, no-store",
          },
        });
      }
    }
    const { buffer, fileName } = await buildLetterPdfForCorrespondence(supabase, id, { noStamp });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        // RFC 5987 filename* carries the real (Persian) name in every current
        // browser; the plain filename= is a safe ASCII fallback for the rest.
        "Content-Disposition": `inline; filename="letter-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (err) {
    console.error("GET /api/correspondence/[id]/pdf failed", err);
    return NextResponse.json({ error: "تولید PDF ناموفق بود." }, { status: 500 });
  }
}
