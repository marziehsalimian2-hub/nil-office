import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Streams an ARCHIVED payslip PDF from the private nil-files bucket — never a signed URL, never regenerated.
 * Both lookups use the CALLER's own session: payroll_payslips and storage.objects (path `payslips/%`) are RLS-gated to
 * payroll-access users and to the owning employee, so zero rows / a failed download = no access (IDOR-safe).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "فیش یافت نشد." }, { status: 404 });

  const { data: slip, error } = await supabase.from("payroll_payslips").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (error || !slip) return NextResponse.json({ error: "فیش یافت نشد." }, { status: 404 });

  const { data: file, error: downloadErr } = await supabase.storage.from("nil-files").download(slip.storage_path);
  if (downloadErr || !file) return NextResponse.json({ error: "بازیابی فایل ناموفق بود." }, { status: 500 });

  await supabase.rpc("record_payslip_access", { p_payslip_id: id });   // audit (no amounts); a logging failure must not block the owner
  const buffer = Buffer.from(await file.arrayBuffer());
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="payslip-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(slip.file_name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
