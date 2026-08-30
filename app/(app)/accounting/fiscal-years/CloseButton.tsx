"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { closeFiscalYear } from "@/app/actions/accounting";
export function CloseButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  function close(force: boolean) {
    const fd = new FormData();
    fd.append("id", id);
    if (force) fd.append("force", "true");
    start(async () => {
      const r = await closeFiscalYear(null, fd);
      if (r && "error" in r && r.error) {
        if (r.error.includes("پیش‌نویس") && confirm("اسناد پیش‌نویس وجود دارد. با این حال سال مالی بسته شود؟")) return close(true);
        setErr(r.error);
      } else router.refresh();
    });
  }
  return (
    <div>
      <button disabled={pending} className="btn-ghost text-status-cancelled" onClick={() => close(false)}>بستن سال مالی</button>
      {err && <p className="mt-1 text-xs text-status-cancelled">{err}</p>}
    </div>
  );
}
