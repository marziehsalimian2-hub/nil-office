import { requireProfile } from "@/lib/auth";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const hasAccess = profile.role === "ADMIN" || profile.accounting_role != null;
  if (!hasAccess) {
    return (
      <Card>
        <p className="text-sm font-medium text-ink">دسترسی به بخش مالی ندارید.</p>
        <p className="mt-1 text-sm text-ink-muted">برای دسترسی به حسابداری، از مدیر سامانه بخواهید نقش مالی برای شما تعیین کند.</p>
      </Card>
    );
  }
  return <>{children}</>;
}
