import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Streams an already-archived report PDF straight from the private
 * nil-files bucket — never a signed URL (matches every other document
 * type in this codebase). The report row lookup goes through the
 * caller's own RLS-bound client, so zero rows = zero access; no
 * separate permission check is needed here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const { data: report, error } = await supabase.from("client_service_reports").select("storage_path, file_name").eq("id", id).single();
  if (error || !report) return NextResponse.json({ error: "گزارش یافت نشد." }, { status: 404 });

  const { data: file, error: downloadErr } = await supabase.storage.from("nil-files").download(report.storage_path);
  if (downloadErr || !file) return NextResponse.json({ error: "بازیابی فایل ناموفق بود." }, { status: 500 });

  const buffer = Buffer.from(await file.arrayBuffer());
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="report-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(report.file_name)}`,
    },
  });
}
