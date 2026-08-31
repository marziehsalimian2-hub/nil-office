"use client";

import { useState } from "react";
import { toEnDigits } from "@/lib/jalali";
import { cn } from "@/lib/utils";

function toRawDigits(displayValue: string): string {
  const cleaned = toEnDigits(displayValue).replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
}

function toGrouped(raw: string): string {
  if (!raw) return "";
  const [intPart, decPart] = raw.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

/**
 * Numeric amount input that groups digits by three (500,000,000) while
 * typing — plain digit-only inputs made it too easy to drop or add a zero
 * without noticing. Submits the raw ungrouped digit string under `name`
 * (uncontrolled) or reports it via `onChange` (controlled), never the
 * grouped display text.
 */
export function MoneyInput({
  name,
  value,
  defaultValue,
  onChange,
  required,
  placeholder,
  className,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (raw: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const raw = controlled ? value : internal;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = toRawDigits(e.target.value);
    if (!controlled) setInternal(next);
    onChange?.(next);
  }

  return (
    <>
      <input
        inputMode="decimal"
        dir="ltr"
        className={cn("input tnum text-left", className)}
        value={toGrouped(raw)}
        onChange={handleChange}
        placeholder={placeholder}
      />
      {name && <input type="hidden" name={name} value={raw} required={required} />}
    </>
  );
}
