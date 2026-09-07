import { PageHeader } from "@/components/ui";
import { TradeOfferForm } from "../TradeOfferForm";

export const dynamic = "force-dynamic";

export default function NewTradeOfferPage() {
  return (
    <div>
      <PageHeader title="آفر تجاری جدید" subtitle="ثبت پیش‌نویس آفر برای انتشار بعدی" />
      <TradeOfferForm />
    </div>
  );
}
