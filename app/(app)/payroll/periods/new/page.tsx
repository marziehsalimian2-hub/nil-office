import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { payrollAccess } from "@/lib/payroll/access";
import { PageHeader } from "@/components/ui";
import { currentJalaliYMD } from "@/lib/jalali";
import { NewPeriodForm } from "./NewPeriodForm";

export const dynamic = "force-dynamic";

export default async function NewPeriodPage() {
  const profile = await requireProfile();
  if (!payrollAccess(profile).create) redirect("/payroll/periods");
  const { jy, jm } = currentJalaliYMD();
  return (
    <div className="max-w-xl">
      <PageHeader title="دورهٔ حقوقی جدید" subtitle="بازهٔ دوره از روی تقویم شمسی محاسبه می‌شود؛ ابتدا و انتهای ماه هر دو جزو دوره هستند" />
      <NewPeriodForm defaultYear={jy} defaultMonth={jm} />
    </div>
  );
}
