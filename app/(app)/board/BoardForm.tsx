"use client";

import { useActionState, useEffect, useRef, startTransition } from "react";
import { FormError } from "@/components/form";
import { cn } from "@/lib/utils";
import type { BoardActionState } from "@/app/actions/board";

/**
 * Small form wrapper for the board editor. Submits through onSubmit (not the `action` prop) so React does NOT auto-reset the form:
 * a long discussion text survives a server-side validation error. `resetOnSuccess` clears «add» forms after a successful save.
 */
export function BoardForm({
  action, children, submitLabel, className, resetOnSuccess, variant = "primary", confirmText, extra,
}: {
  action: (s: BoardActionState, f: FormData) => Promise<BoardActionState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  resetOnSuccess?: boolean;
  variant?: "primary" | "seal" | "ghost" | "danger";
  confirmText?: string;
  extra?: React.ReactNode;
}) {
  const [state, run, pending] = useActionState<BoardActionState, FormData>(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const btn = { primary: "btn-primary", seal: "btn-seal", ghost: "btn-ghost", danger: "btn-ghost text-status-cancelled" }[variant];
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => run(fd));
      }}
    >
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={cn(btn)}>{pending ? "در حال انجام…" : submitLabel}</button>
        {extra}
        {state?.ok && state.message && <span className="text-xs text-status-final">{state.message}</span>}
      </div>
      {state?.error && <div className="mt-2"><FormError message={state.error} /></div>}
    </form>
  );
}

/** A single-button form (delete etc.). */
export function BoardButton({
  action, fields, label, confirmText, className,
}: {
  action: (s: BoardActionState, f: FormData) => Promise<BoardActionState>;
  fields: Record<string, string>;
  label: string;
  confirmText?: string;
  className?: string;
}) {
  const [state, run, pending] = useActionState<BoardActionState, FormData>(action, null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        className={cn("btn-ghost text-xs", className)}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          const fd = new FormData();
          for (const [k, v] of Object.entries(fields)) fd.append(k, v);
          startTransition(() => run(fd));
        }}
      >
        {pending ? "…" : label}
      </button>
      {state?.error && <span className="mt-1 text-xs text-status-cancelled">{state.error}</span>}
    </span>
  );
}
