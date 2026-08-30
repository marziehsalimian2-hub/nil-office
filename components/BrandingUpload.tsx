"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions/branding";
import { FormError, SubmitButton } from "@/components/form";

export function BrandingUpload({
  action,
  hasImage,
}: {
  action: (p: ActionState, f: FormData) => Promise<ActionState>;
  hasImage: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="text-xs" required />
      <SubmitButton variant="ghost">{hasImage ? "جایگزینی" : "بارگذاری"}</SubmitButton>
      <FormError message={state?.error} />
    </form>
  );
}
