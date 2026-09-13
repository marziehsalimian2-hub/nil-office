import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Cheque, ChequeBook, ChequePrintTemplate, ChequePrintTemplateField } from "@/lib/types/database";

export type ChequePrintContext = {
  cheque: Cheque;
  chequeBook: ChequeBook | null;
  template: ChequePrintTemplate | null;
  fields: ChequePrintTemplateField[];
  bankAccountInfo?: string;
};

/**
 * Resolves what to render on the print/test-print pages: the cheque
 * (must be PAYABLE — printing a RECEIVABLE cheque makes no sense, we
 * never issued it), its assigned template if set, else the first active
 * template for its cheque book's bank, else any active template.
 */
export async function loadChequePrintContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  chequeId: string,
): Promise<ChequePrintContext | null> {
  const { data: chequeRow } = await supabase.from("cheques").select("*").eq("id", chequeId).single();
  if (!chequeRow || chequeRow.direction !== "PAYABLE") return null;
  const cheque = chequeRow as Cheque;

  const { data: book } = cheque.cheque_book_id
    ? await supabase.from("cheque_books").select("*").eq("id", cheque.cheque_book_id).single()
    : { data: null };
  const chequeBook = book as ChequeBook | null;

  let templateId = cheque.print_template_id;
  if (!templateId && chequeBook) {
    const { data: byBank } = await supabase
      .from("cheque_print_templates")
      .select("id")
      .eq("bank_account_id", chequeBook.bank_account_id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    templateId = byBank?.id ?? null;
  }
  if (!templateId) {
    const { data: anyTemplate } = await supabase.from("cheque_print_templates").select("id").eq("is_active", true).limit(1).maybeSingle();
    templateId = anyTemplate?.id ?? null;
  }
  if (!templateId) return { cheque, chequeBook, template: null, fields: [] };

  const [{ data: template }, { data: fields }, { data: bankAccount }] = await Promise.all([
    supabase.from("cheque_print_templates").select("*").eq("id", templateId).single(),
    supabase.from("cheque_print_template_fields").select("*").eq("template_id", templateId),
    chequeBook
      ? supabase.from("bank_accounts").select("bank_name, branch, account_number").eq("id", chequeBook.bank_account_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const bankAccountInfo = bankAccount
    ? [bankAccount.bank_name, bankAccount.branch, bankAccount.account_number].filter(Boolean).join(" — ")
    : undefined;

  return {
    cheque,
    chequeBook,
    template: template as ChequePrintTemplate,
    fields: (fields ?? []) as ChequePrintTemplateField[],
    bankAccountInfo,
  };
}
