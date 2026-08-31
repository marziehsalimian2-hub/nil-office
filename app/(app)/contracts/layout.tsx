import { requireProfile } from "@/lib/auth";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ContractsLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const hasAccess = profile.role === "ADMIN" || profile.contract_role != null;
  if (!hasAccess) {
    return (
      <Card>
        <p className="text-sm font-medium text-ink">دسترسی به بخش قراردادها ندارید.</p>
        <p className="mt-1 text-sm text-ink-muted">برای دسترسی به قراردادها، از مدیر سامانه بخواهید نقش قراردادها برای شما تعیین کند.</p>
      </Card>
    );
  }
  return <>{children}</>;
}
