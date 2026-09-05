"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createCompany, type ActionState } from "@/app/actions/entities";
import { checkSimilarCompanies, type SimilarCompany } from "@/app/actions/crm-duplicates";
import { Field, FormError, SubmitButton } from "@/components/form";
import { DuplicateWarning } from "@/components/DuplicateWarning";

export function CompanyForm() {
  const [state, action] = useActionState<ActionState, FormData>(createCompany, null);
  const [legalName, setLegalName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [similar, setSimilar] = useState<SimilarCompany[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!legalName.trim()) {
      setSimilar([]);
      return;
    }
    timer.current = setTimeout(() => {
      checkSimilarCompanies(legalName, email, phone).then(setSimilar);
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [legalName, email, phone]);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام شرکت (حقوقی)" required>
            <input name="legal_name" required className="input" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </Field>
          <Field label="نام انگلیسی">
            <input name="english_name" dir="ltr" className="input text-left" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="کشور"><input name="country" className="input" /></Field>
          <Field label="شخص رابط"><input name="contact_person" className="input" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ایمیل"><input name="email" dir="ltr" className="input text-left" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="تلفن"><input name="phone" dir="ltr" className="input text-left" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
        <Field label="نشانی"><textarea name="address" rows={2} className="input" /></Field>
        <Field label="یادداشت"><textarea name="notes" rows={2} className="input" /></Field>
        <DuplicateWarning
          items={similar.map((c) => ({ id: c.id, label: c.legal_name, sublabel: c.english_name, href: `/companies/${c.id}` }))}
        />
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ثبت شرکت</SubmitButton>
        <Link href="/companies" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}
