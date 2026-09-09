import { PageHeader } from "@/components/ui";
import { ChatPanel } from "./ChatPanel";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  return (
    <div>
      <PageHeader title="دستیار نیل" subtitle="سؤال بپرسید یا کار/پیگیری جدید بخواهید — بر اساس اطلاعات واقعی NIL Office" />
      <ChatPanel />
    </div>
  );
}
