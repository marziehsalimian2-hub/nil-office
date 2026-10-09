"use client";
import { useActionState } from "react";
import Link from "next/link";
import { createBoardMeeting, type BoardActionState } from "@/app/actions/board";
import { Field, FormError, SubmitButton } from "@/components/form";
import { JalaliDateInput } from "@/components/JalaliDateInput";
import { BOARD_MEETING_TYPE, BOARD_MEETING_TYPE_LABEL } from "@/lib/board/types";

export function NewMeetingForm({ defaultLocation }: { defaultLocation: string }) {
  const [state, run] = useActionState<BoardActionState, FormData>(createBoardMeeting, null);
  return (
    <form action={run} className="space-y-5">
      <FormError message={state?.error} />
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="تاریخ جلسه" required><JalaliDateInput name="date" required /></Field>
          <Field label="ساعت" required hint="به وقت تهران"><input name="time" required dir="ltr" placeholder="09:30" className="input text-center tnum" /></Field>
          <Field label="نوع جلسه" required>
            <select name="meeting_type" className="input" defaultValue="ORDINARY">
              {BOARD_MEETING_TYPE.map((t) => <option key={t} value={t}>{BOARD_MEETING_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="محل یا شیوهٔ برگزاری" required><input name="location" required defaultValue={defaultLocation} className="input" placeholder="دفتر نیل / برخط" /></Field>
      </div>
      <div className="flex gap-3">
        <SubmitButton variant="primary">ساخت جلسه</SubmitButton>
        <Link href="/board" className="btn-quiet">انصراف</Link>
      </div>
    </form>
  );
}
