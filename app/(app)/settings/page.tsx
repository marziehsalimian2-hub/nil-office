import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";
import { SequenceForm } from "./SequenceForm";
import { DisplayUnitForm } from "./DisplayUnitForm";
import { AccountingRoleSelect } from "./AccountingRoleSelect";
import { ContractRoleSelect } from "./ContractRoleSelect";
import { UserNameTitleEdit } from "./UserNameTitleEdit";
import { BrandingUpload } from "@/components/BrandingUpload";
import { SignatureUpload } from "@/components/SignatureUpload";
import { uploadLetterhead, uploadStamp } from "@/app/actions/branding";
import { ACCOUNTING_ROLE_LABEL, CONTRACT_ROLE_LABEL } from "@/lib/enums";
import { currentJalaliYear, toFaDigits } from "@/lib/jalali";
import type { AppSettings, NumberSequence, Profile } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<string, string> = { OUTGOING: "صادره", INCOMING: "وارده", CASE: "پرونده" };
const ROLE_LABEL: Record<string, string> = { ADMIN: "مدیر", USER: "کاربر" };

export default async function SettingsPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === "ADMIN";
  const supabase = await createClient();

  const [{ data: seqs }, { data: users }, { data: settings }] = await Promise.all([
    supabase.from("number_sequences").select("*").order("scope").order("year", { ascending: false }),
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("app_settings").select("*").eq("id", 1).single(),
  ]);
  const displayUnit = (settings?.display_unit as "RIAL" | "TOMAN") ?? "RIAL";
  const sequences = (seqs ?? []) as NumberSequence[];
  const people = (users ?? []) as Profile[];
  const appSettings = settings as AppSettings | null;

  let signedLetterheadUrl: string | null = null;
  let signedStampUrl: string | null = null;
  const signedSignatureUrls = new Map<string, string>();
  if (isAdmin) {
    if (appSettings?.letterhead_path) {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(appSettings.letterhead_path, 3600);
      signedLetterheadUrl = data?.signedUrl ?? null;
    }
    if (appSettings?.stamp_path) {
      const { data } = await supabase.storage.from("nil-files").createSignedUrl(appSettings.stamp_path, 3600);
      signedStampUrl = data?.signedUrl ?? null;
    }
    await Promise.all(
      people
        .filter((p) => p.signature_path)
        .map(async (p) => {
          const { data } = await supabase.storage
            .from("nil-files")
            .createSignedUrl(p.signature_path as string, 3600);
          if (data?.signedUrl) signedSignatureUrls.set(p.id, data.signedUrl);
        }),
    );
  }

  return (
    <div>
      <PageHeader title="تنظیمات" subtitle="مقداردهی اولیهٔ شماره‌ها و کاربران" />

      {!isAdmin ? (
        <Card><p className="text-sm text-ink-muted">این بخش فقط برای مدیر سامانه در دسترس است.</p></Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <p className="mb-1 text-sm font-medium text-ink">سربرگ و مهر شرکت</p>
            <p className="mb-4 text-xs text-ink-muted">
              برای تولید خودکار PDF نامهٔ صادره روی سربرگ رسمی استفاده می‌شود.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs text-ink-muted">سربرگ</p>
                {signedLetterheadUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signedLetterheadUrl} alt="سربرگ فعلی" className="mb-2 h-20 border border-line bg-white p-1" />
                )}
                <BrandingUpload action={uploadLetterhead} hasImage={!!appSettings?.letterhead_path} />
              </div>
              <div>
                <p className="mb-2 text-xs text-ink-muted">مهر شرکت</p>
                {signedStampUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signedStampUrl} alt="مهر فعلی" className="mb-2 h-20 border border-line bg-white p-1" />
                )}
                <BrandingUpload action={uploadStamp} hasImage={!!appSettings?.stamp_path} />
              </div>
            </div>
          </Card>

          <Card>
            <p className="mb-1 text-sm font-medium text-ink">واحد پول حسابداری</p>
            <p className="mb-4 text-xs text-ink-muted">واحد نمایش مبالغ در بخش مالی و حسابداری.</p>
            <DisplayUnitForm current={displayUnit} />
          </Card>

          <Card>
            <p className="mb-1 text-sm font-medium text-ink">مقداردهی اولیهٔ سری شماره‌ها</p>
            <p className="mb-4 text-xs text-ink-muted">برای انتقال بایگانی موجود بدون شماره‌گذاری مجدد استفاده می‌شود.</p>
            <SequenceForm currentYear={currentJalaliYear()} />
          </Card>

          <Card>
            <p className="mb-3 text-sm font-medium text-ink">سری شماره‌های فعلی</p>
            {sequences.length === 0 ? (
              <p className="text-sm text-ink-muted">هنوز سری شماره‌ای تعریف نشده است.</p>
            ) : (
              <table className="w-full">
                <thead><tr className="table-head">
                  <th className="px-3 py-2">دامنه</th><th className="px-3 py-2">سال</th>
                  <th className="px-3 py-2">آخرین شماره</th><th className="px-3 py-2">شمارهٔ بعدی</th>
                </tr></thead>
                <tbody>
                  {sequences.map((s) => (
                    <tr key={s.id} className="table-row">
                      <td className="px-3 py-2 text-ink">{SCOPE_LABEL[s.scope] ?? s.scope}</td>
                      <td className="px-3 py-2 tnum text-ink-muted">{toFaDigits(s.year)}</td>
                      <td className="px-3 py-2 tnum text-ink-muted">{toFaDigits(s.last_value)}</td>
                      <td className="px-3 py-2 tnum font-medium text-seal">{toFaDigits(s.last_value + 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <p className="mb-3 text-sm font-medium text-ink">کاربران</p>
            <table className="w-full">
              <thead><tr className="table-head">
                <th className="px-3 py-2">نام و سمت</th>
                <th className="px-3 py-2">نقش</th><th className="px-3 py-2">دسترسی مالی</th>
                <th className="px-3 py-2">دسترسی قراردادها</th>
                <th className="px-3 py-2">امضا</th><th className="px-3 py-2">وضعیت</th>
              </tr></thead>
              <tbody>
                {people.map((u) => (
                  <tr key={u.id} className="table-row">
                    <td className="px-3 py-2">
                      <UserNameTitleEdit userId={u.id} fullName={u.full_name} title={u.title} />
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td className="px-3 py-2">
                      {u.role === "ADMIN"
                        ? <span className="text-xs text-ink-muted">{ACCOUNTING_ROLE_LABEL.ADMIN} (کامل)</span>
                        : <AccountingRoleSelect userId={u.id} current={u.accounting_role} />}
                    </td>
                    <td className="px-3 py-2">
                      {u.role === "ADMIN"
                        ? <span className="text-xs text-ink-muted">{CONTRACT_ROLE_LABEL.ADMIN} (کامل)</span>
                        : <ContractRoleSelect userId={u.id} current={u.contract_role} />}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {signedSignatureUrls.get(u.id) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={signedSignatureUrls.get(u.id)} alt="امضا" className="h-8 border border-line bg-white p-0.5" />
                        )}
                        <SignatureUpload userId={u.id} hasSignature={!!u.signature_path} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{u.is_active ? "فعال" : "غیرفعال"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
