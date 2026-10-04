import { requireProfile } from "@/lib/auth";
import { Card } from "@/components/ui";
import { payrollAccess } from "@/lib/payroll/access";

export const dynamic = "force-dynamic";

export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  if (!payrollAccess(profile).view) {
    return (
      <Card>
        <p className="text-sm font-medium text-ink">دسترسی به بخش حقوق و دستمزد ندارید.</p>
        <p className="mt-1 text-sm text-ink-muted">برای دسترسی، از مدیر سامانه بخواهید نقش «حقوق و دستمزد» برای شما تعیین کند. نقش منابع انسانی به‌تنهایی کافی نیست.</p>
      </Card>
    );
  }
  return <>{children}</>;
}
