"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { postReceipt, postPayment } from "@/app/actions/accounting";
export function PostDocButton({ id, kind }: { id: string; kind: "receipt" | "payment" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  function go() {
    const fd = new FormData(); fd.append("id", id);
    start(async () => {
      const r = await (kind === "receipt" ? postReceipt : postPayment)(null, fd);
      if (r && "error" in r && r.error) setErr(r.error); else router.refresh();
    });
  }
  return (
    <div className="text-left">
      <button disabled={pending} onClick={go} className="btn-ghost !py-1 text-xs">{pending ? "…" : "ثبت قطعی"}</button>
      {err && <p className="mt-1 text-xs text-status-cancelled">{err}</p>}
    </div>
  );
}
