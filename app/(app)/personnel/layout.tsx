import { requireProfile } from "@/lib/auth";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PersonnelLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const hasAccess = profile.role === "ADMIN" || profile.hr_role != null;
  if (!hasAccess) {
    return (
      <Card>
        <p className="text-sm font-medium text-ink">دسترسی به بخش پرسنل ندارید.</p>
        <p className="mt-1 text-sm text-ink-muted">برای دسترسی، از مدیر سامانه بخواهید نقش منابع انسانی برای شما تعیین کند.</p>
      </Card>
    );
  }
  return <>{children}</>;
}
