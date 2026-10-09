import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { boardAccess } from "@/lib/board/types";
import { NewMeetingForm } from "./NewMeetingForm";

export const dynamic = "force-dynamic";

export default async function NewBoardMeetingPage() {
  const profile = await requireProfile();
  if (!boardAccess(profile).create) {
    return <Card><p className="text-sm text-ink">برای ساخت جلسه به دسترسی «تهیهٔ پیش‌نویس» هیئت‌مدیره نیاز دارید.</p></Card>;
  }
  const supabase = await createClient();
  const { data: settings } = await supabase.from("board_settings").select("default_location").eq("id", 1).maybeSingle();
  return (
    <div className="max-w-2xl">
      <PageHeader title="جلسهٔ جدید هیئت‌مدیره" subtitle="ابتدا زمان و محل را ثبت کنید؛ دستور جلسه، حضور و مصوبات در صفحهٔ جلسه تکمیل می‌شود." />
      <NewMeetingForm defaultLocation={settings?.default_location ?? ""} />
    </div>
  );
}
