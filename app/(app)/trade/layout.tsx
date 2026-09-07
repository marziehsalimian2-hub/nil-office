import { requireProfile } from "@/lib/auth";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TradeLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const hasAccess = profile.role === "ADMIN" || profile.trade_role != null;
  if (!hasAccess) {
    return (
      <Card>
        <p className="text-sm font-medium text-ink">دسترسی به بخش آفرهای تجاری ندارید.</p>
        <p className="mt-1 text-sm text-ink-muted">برای دسترسی، از مدیر سامانه بخواهید نقش پورتال معاملات برای شما تعیین کند.</p>
      </Card>
    );
  }
  return <>{children}</>;
}
