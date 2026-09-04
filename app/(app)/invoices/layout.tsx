import { requireProfile } from "@/lib/auth";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InvoicesLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const hasAccess = profile.role === "ADMIN" || profile.invoice_role != null;
  if (!hasAccess) {
    return (
      <Card>
        <p className="text-sm font-medium text-ink">دسترسی به بخش فاکتورها ندارید.</p>
        <p className="mt-1 text-sm text-ink-muted">برای دسترسی به فاکتورها، از مدیر سامانه بخواهید نقش فاکتورها برای شما تعیین کند.</p>
      </Card>
    );
  }
  return <>{children}</>;
}
