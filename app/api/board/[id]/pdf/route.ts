import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildBoardMinutesPdf } from "@/lib/pdf/boardMinutesData";
import { getFrozenPdf } from "@/lib/verify/frozen";

export const dynamic = "force-dynamic";

/**
 * Board minutes PDF. A verified (approved) meeting is served from its FROZEN file — the exact bytes whose SHA-256 NIL Verify holds;
 * otherwise it is rendered on demand: the approved snapshot, or a watermarked «پیش‌نویس» preview of a draft. RLS (board access) is the gate.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "شناسه نامعتبر است." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  try {
    const frozen = await getFrozenPdf(supabase, "BOARD_MINUTES", id);
    if (frozen) {
      return new NextResponse(new Uint8Array(frozen.buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="board-minutes-${frozen.number}.pdf"; filename*=UTF-8''${encodeURIComponent(`صورت‌جلسه-هیئت‌مدیره-${frozen.number}.pdf`)}`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    const { buffer, fileName } = await buildBoardMinutesPdf(supabase, id);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="board-minutes-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/board/[id]/pdf failed", err);
    return NextResponse.json({ error: "تولید PDF ناموفق بود." }, { status: 500 });
  }
}
