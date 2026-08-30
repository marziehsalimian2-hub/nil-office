import { PageHeader } from "@/components/ui";
import { FiscalYearForm } from "./FiscalYearForm";
export const dynamic = "force-dynamic";
export default function NewFiscalYearPage() {
  return (<div><PageHeader title="سال مالی جدید" subtitle="تعریف دورهٔ مالی" /><FiscalYearForm /></div>);
}
