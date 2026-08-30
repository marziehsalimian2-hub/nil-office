import { PageHeader } from "@/components/ui";
import { CompanyForm } from "./CompanyForm";
export const dynamic = "force-dynamic";
export default function NewCompanyPage() {
  return (
    <div>
      <PageHeader title="شرکت جدید" subtitle="افزودن شرکت / طرف مکاتبه" />
      <CompanyForm />
    </div>
  );
}
