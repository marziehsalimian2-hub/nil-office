import { PageHeader } from "@/components/ui";
import { CategoryForm } from "./CategoryForm";

export const dynamic = "force-dynamic";

export default function NewServiceCategoryPage() {
  return (
    <div>
      <PageHeader title="دستهٔ خدمت جدید" />
      <CategoryForm />
    </div>
  );
}
