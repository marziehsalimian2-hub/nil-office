"use client";

import { useActionState } from "react";
import { uploadSignature, type ActionState } from "@/app/actions/branding";
import { FormError, SubmitButton } from "@/components/form";

export function SignatureUpload({
  userId,
  hasSignature,
}: {
  userId: string;
  hasSignature: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(uploadSignature, null);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="text-xs" required />
      <SubmitButton variant="ghost">{hasSignature ? "جایگزینی" : "بارگذاری"}</SubmitButton>
      <FormError message={state?.error} />
    </form>
  );
}
