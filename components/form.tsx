"use client";

import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function SubmitButton({
  children,
  variant = "primary",
  name,
  value,
  className,
}: {
  children: React.ReactNode;
  variant?: "primary" | "seal" | "ghost";
  name?: string;
  value?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const cls = {
    primary: "btn-primary",
    seal: "btn-seal",
    ghost: "btn-ghost",
  }[variant];
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={cn(cls, className)}
    >
      {pending ? "در حال انجام…" : children}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-status-cancelled/30 bg-status-cancelled/5 px-3 py-2 text-sm text-status-cancelled">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

export function Field({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label}
        {required && <span className="text-status-cancelled"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}
