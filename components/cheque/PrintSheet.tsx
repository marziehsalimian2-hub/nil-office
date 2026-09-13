import { formatJalali, formatGregorian, toFaDigits } from "@/lib/jalali";
import { CHEQUE_CURRENCY_LABEL } from "@/lib/enums";
import type { Cheque, ChequePrintTemplate, ChequePrintTemplateField } from "@/lib/types/database";

/**
 * Renders the cheque fields at their template-defined mm coordinates,
 * plus the template's global printer offset (spec §20 — composes at
 * render time, never stored redundantly). @page carries the template's
 * exact physical dimensions — no A4 assumption, no browser margins
 * (spec §22). Shared by both the real print page and the test-print
 * page (which additionally overlays a calibration grid).
 */
export function PrintSheet({
  cheque,
  template,
  fields,
  bankAccountInfo,
  showGrid,
}: {
  cheque: Cheque;
  template: ChequePrintTemplate;
  fields: ChequePrintTemplateField[];
  bankAccountInfo?: string;
  showGrid?: boolean;
}) {
  const amountText = `${toFaDigits(new Intl.NumberFormat("en-US").format(cheque.amount))} ${CHEQUE_CURRENCY_LABEL[cheque.currency_code] ?? cheque.currency_code}`;
  const dateText = template.print_date_format === "GREGORIAN" ? formatGregorian(cheque.cheque_date) : formatJalali(cheque.cheque_date);

  function textFor(field: ChequePrintTemplateField): string {
    switch (field.field_key) {
      case "DATE":
        return dateText;
      case "PAYEE":
        return cheque.counterparty_name_snapshot;
      case "AMOUNT_NUMERIC":
        return amountText;
      case "AMOUNT_WORDS":
        return cheque.amount_in_words;
      case "PURPOSE":
        return cheque.purpose ?? "";
      case "SAYAD_ID":
        return cheque.sayad_id ? toFaDigits(cheque.sayad_id) : "";
      case "ACCOUNT_INFO":
        return bankAccountInfo ?? "";
      case "CUSTOM_TEXT":
        return field.custom_label ?? "";
      default:
        return "";
    }
  }

  return (
    <>
      <style>{`
        @page { size: ${template.page_width_mm}mm ${template.page_height_mm}mm; margin: 0; }
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div
        className="cheque-print-sheet relative bg-white"
        style={{ width: `${template.page_width_mm}mm`, height: `${template.page_height_mm}mm` }}
      >
        {showGrid && (
          <svg className="absolute inset-0 h-full w-full" style={{ opacity: 0.25 }}>
            <defs>
              <pattern id="grid10" width="10mm" height="10mm" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#c00" strokeWidth="0.2" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid10)" />
          </svg>
        )}
        {fields.map((f) => (
          <div
            key={f.id}
            style={{
              position: "absolute",
              left: `${f.x_mm + template.offset_x_mm}mm`,
              top: `${f.y_mm + template.offset_y_mm}mm`,
              width: `${f.width_mm}mm`,
              height: `${f.height_mm}mm`,
              fontSize: `${f.font_size_pt}pt`,
              textAlign: f.alignment.toLowerCase() as "left" | "right" | "center",
              direction: f.direction === "RTL" ? "rtl" : "ltr",
              transform: f.rotation_deg ? `rotate(${f.rotation_deg}deg)` : undefined,
              whiteSpace: "nowrap",
              overflow: "hidden",
              color: "#000",
            }}
          >
            {textFor(f)}
          </div>
        ))}
      </div>
    </>
  );
}
