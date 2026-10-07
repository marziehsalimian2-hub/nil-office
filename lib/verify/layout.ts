import { z } from "zod";
import type { VerifyLayout } from "./types";

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const MM_TO_PT = 595.28 / 210;

/** Plate geometry (all in mm): white padding around the QR, then optional text lines below it. */
export const PLATE_PAD_MM = 1.5;
export const LABEL_LINE_MM = 4;
/** The card is at least this wide so the label stays legible under a small QR. */
export const MIN_PLATE_WIDTH_MM = 32;

export const layoutSchema = z
  .object({
    page: z.enum(["FIRST", "LAST"]),
    x_mm: z.coerce.number().min(0).max(150),
    y_mm: z.coerce.number().min(0).max(250),
    size_mm: z.coerce.number().min(15).max(60),
    show_label: z.boolean(),
    show_code: z.boolean(),
    label_text: z.string().trim().min(1).max(120),
  })
  .strict();

export type PlateGeometry = {
  /** plate (white card) rectangle, PDF points, origin bottom-left */
  plate: { x: number; y: number; w: number; h: number };
  qr: { x: number; y: number; size: number };
  /** text snippet area under the QR (null when neither label nor code is shown) */
  text: { x: number; y: number; w: number; h: number } | null;
  textLines: number;
};

export function textLineCount(l: Pick<VerifyLayout, "show_label" | "show_code">): number {
  return (l.show_label ? 1 : 0) + (l.show_code ? 1 : 0);
}

/** Converts a layout to page coordinates. y_mm / x_mm locate the plate's BOTTOM-LEFT corner. */
export function computePlate(l: VerifyLayout): PlateGeometry {
  const lines = textLineCount(l);
  const textH = lines * LABEL_LINE_MM;
  const plateW = Math.max(l.size_mm + 2 * PLATE_PAD_MM, MIN_PLATE_WIDTH_MM);
  const plateH = l.size_mm + 2 * PLATE_PAD_MM + textH;
  const x0 = l.x_mm * MM_TO_PT;
  const y0 = l.y_mm * MM_TO_PT;
  return {
    plate: { x: x0, y: y0, w: plateW * MM_TO_PT, h: plateH * MM_TO_PT },
    qr: { x: x0 + ((plateW - l.size_mm) / 2) * MM_TO_PT, y: y0 + (PLATE_PAD_MM + textH) * MM_TO_PT, size: l.size_mm * MM_TO_PT },
    text: lines > 0 ? { x: x0 + PLATE_PAD_MM * MM_TO_PT, y: y0 + PLATE_PAD_MM * MM_TO_PT, w: (plateW - 2 * PLATE_PAD_MM) * MM_TO_PT, h: textH * MM_TO_PT } : null,
    textLines: lines,
  };
}

/** True when the whole plate lies inside the page (the stamp is refused otherwise — a QR half off the paper is worse than none). */
export function plateFitsPage(l: VerifyLayout, pageWidthPt = 595.28, pageHeightPt = 841.89): boolean {
  const g = computePlate(l);
  return g.plate.x >= 0 && g.plate.y >= 0 && g.plate.x + g.plate.w <= pageWidthPt + 0.01 && g.plate.y + g.plate.h <= pageHeightPt + 0.01;
}

/** Total height of the plate above the page bottom edge (mm): how much bottom margin a renderer must reserve so the plate cannot touch content. */
export function plateTopMm(l: VerifyLayout): number {
  return l.y_mm + l.size_mm + 2 * PLATE_PAD_MM + textLineCount(l) * LABEL_LINE_MM;
}
