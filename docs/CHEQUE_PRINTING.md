# Cheque Printing v1.0

Printing applies **only to PAYABLE cheques** — a RECEIVABLE cheque is a physical document NIL Office already received; it's recorded and optionally attached (scanned image), never printed.

## Template schema

Two tables, not a JSON blob (matches this codebase's preference for real columns, e.g. `journal_entry_lines`):

- **`cheque_print_templates`**: `name`, optional `bank_account_id` (null = usable for any bank), `page_width_mm`/`page_height_mm`, `orientation`, `print_date_format` (`JALALI`/`GREGORIAN`), and the global `offset_x_mm`/`offset_y_mm`.
- **`cheque_print_template_fields`**: one row per field (`DATE`/`PAYEE`/`AMOUNT_NUMERIC`/`AMOUNT_WORDS`/`PURPOSE`/`SAYAD_ID`/`ACCOUNT_INFO`/`CUSTOM_TEXT`), each with `x_mm`/`y_mm`/`width_mm`/`height_mm`/`font_size_pt`/`alignment`/`direction`/`rotation_deg`.

## Calibration UI (confirmed for v1: numeric form, not drag-and-drop)

`/cheques/templates/[id]` renders one form per field with plain mm/pt number inputs (`FieldForm.tsx`), plus a global offset form (`GlobalOffsetForm.tsx`). This was a deliberate choice over a live drag-and-drop editor: a numeric form is faster to build, has zero pixel-rounding risk, and is exactly as testable (known input → known rendered position). A future v1.1 could add a visual drag layer on top of the same `x_mm`/`y_mm` columns without any schema change — that's an explicit non-goal for this version.

## Global offset

`effective_x_mm = field.x_mm + template.offset_x_mm` (same for Y), computed at **render time** in `PrintSheet.tsx` — never stored redundantly. This lets a single "the printer is 2mm off" correction apply to every field on the template at once, instead of editing each field's coordinates individually.

## Print rendering

`components/cheque/PrintSheet.tsx` renders each field as an absolutely-positioned `<div>` inside a sheet sized exactly to the template's `page_width_mm`/`page_height_mm`, with:

```css
@page { size: <width>mm <height>mm; margin: 0; }
@media print { body { margin: 0; } .no-print { display: none !important; } }
```

No A4 assumption anywhere — the physical dimensions always come from the template row. Text direction/alignment/rotation per field come straight from that field's own columns (Persian fields default `RTL`/`RIGHT`; a Latin date can be `LTR`/`CENTER`).

## Test print vs. real print

`PrintTrigger.tsx` calls the `record_cheque_print` RPC **before** opening the browser print dialog (`window.print()`), so a print attempt is always audited even if the physical printer step fails or is cancelled:

- **Test print** (`/cheques/[id]/print/test`): `p_is_test_print = true`. Touches nothing but an audit log entry (`TEST_PRINTED`) — `print_count`/`status` never change. A red 10mm calibration grid is overlaid (`PrintSheet`'s `showGrid` prop) so real-world deviation can be measured against a ruler on plain paper.
- **Real print** (`/cheques/[id]/print`): `p_is_test_print = false`. Increments `print_count`, stamps `first_printed_at`/`last_printed_at`/`printed_by`. If the cheque's status is already `ISSUED` or later, the RPC additionally requires `can_approve_cheque()` (APPROVE+ tier) and logs a distinguished `REPRINT_ISSUED_CHEQUE` action instead of the plain `PRINTED` one — the UI also shows a standing warning banner on the cheque detail page once `print_count > 0` and status is beyond DRAFT.

## Calibration workflow (matches the manual acceptance test)

1. Create a template with the bank leaf's real physical dimensions.
2. Open **چاپ آزمایشی** (test print) on a real cheque draft, print on plain paper, hold it against a real (unused) leaf up to a light source.
3. Measure the X/Y deviation in mm.
4. Adjust the template's global offset (`GlobalOffsetForm`) by that amount.
5. Test-print again — repeat until aligned. Only then use **چاپ** (real print) on an actual leaf.

## Security

Bank/cheque data never appears in a URL query string, and `record_cheque_print`/print pages log only IDs and field/template metadata — never raw bank account numbers — to `activity_logs`. Bank account details (`bank_accounts.account_number`/`iban`) are fetched only for rendering the `ACCOUNT_INFO` print field and for on-page display gated behind `cheque_role`/admin visibility checks in the UI, matching how sensitive fields are already hidden inline elsewhere in this codebase (no separate "restricted view" route).
