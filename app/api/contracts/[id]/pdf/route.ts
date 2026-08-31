import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildContractPdf } from "@/lib/pdf/contractData";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", _req.url));

  try {
    const pdf = await buildContractPdf(supabase, id);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="contract-${id}.pdf"`,
      },
    });
  } catch (err) {
    console.error("GET /api/contracts/[id]/pdf failed", err);
    return NextResponse.json({ error: "تولید PDF ناموفق بود." }, { status: 500 });
  }
}
