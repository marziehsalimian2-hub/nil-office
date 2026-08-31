import { PageHeader } from "@/components/ui";
import { TypeForm } from "./TypeForm";

export const dynamic = "force-dynamic";

export default function NewContractTypePage() {
  return (
    <div>
      <PageHeader title="نوع قرارداد جدید" />
      <TypeForm />
    </div>
  );
}
