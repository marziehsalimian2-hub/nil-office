import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { SignatureUpload } from "@/components/SignatureUpload";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  let signedSignatureUrl: string | null = null;
  if (profile.signature_path) {
    const { data } = await supabase.storage
      .from("nil-files")
      .createSignedUrl(profile.signature_path, 3600);
    signedSignatureUrl = data?.signedUrl ?? null;
  }

  return (
    <div>
      <PageHeader title="پروفایل من" subtitle="اطلاعات حساب و امضای شما" />
      <Card className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="field-label">نام</p>
            <p className="text-sm text-ink">{profile.full_name || "—"}</p>
          </div>
          <div>
            <p className="field-label">سمت</p>
            <p className="text-sm text-ink">{profile.title || "—"}</p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink">امضا</p>
          <p className="mb-3 text-xs text-ink-muted">
            این تصویر روی نامه‌های صادرهٔ ثبت‌نهایی‌شده که امضاکنندهٔ آن‌ها شما هستید نمایش داده می‌شود.
          </p>
          {signedSignatureUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signedSignatureUrl} alt="امضای فعلی" className="mb-3 h-16 border border-line bg-white p-1" />
          )}
          <SignatureUpload userId={profile.id} hasSignature={!!profile.signature_path} />
        </div>
      </Card>
    </div>
  );
}
