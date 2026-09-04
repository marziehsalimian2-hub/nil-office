import { requireProfile } from "@/lib/auth";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OpportunitiesLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const hasAccess = profile.role === "ADMIN" || profile.crm_role != null;
  if (!hasAccess) {
    return (
      <Card>
        <p className="text-sm font-medium text-ink">دسترسی به بخش فرصت‌های تجاری ندارید.</p>
        <p className="mt-1 text-sm text-ink-muted">برای دسترسی، از مدیر سامانه بخواهید نقش CRM برای شما تعیین کند.</p>
      </Card>
    );
  }
  return <>{children}</>;
}
