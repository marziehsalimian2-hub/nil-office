import { requireProfile } from "@/lib/auth";
import { Card } from "@/components/ui";
import { boardAccess } from "@/lib/board/types";
import { BoardNav } from "./BoardNav";

export const dynamic = "force-dynamic";

export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  if (!boardAccess(profile).view) {
    return (
      <Card>
        <p className="text-sm font-medium text-ink">دسترسی به دبیرخانهٔ هیئت‌مدیره ندارید.</p>
        <p className="mt-1 text-sm text-ink-muted">صورت‌جلسات هیئت‌مدیره محرمانه است؛ برای دسترسی، از مدیر سامانه بخواهید نقش «هیئت‌مدیره» برای شما تعیین کند.</p>
      </Card>
    );
  }
  return (
    <div>
      <BoardNav />
      {children}
    </div>
  );
}
