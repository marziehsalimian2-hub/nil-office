"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSalaryComponentActive } from "@/app/actions/payroll-components";

export function ActiveToggle({ componentId, isActive }: { componentId: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  function toggle() {
    const fd = new FormData();
    fd.set("component_id", componentId);
    fd.set("active", String(!isActive));
    start(async () => {
      const r = await setSalaryComponentActive(null, fd);
      if (r && "error" in r && r.error) setErr(r.error);
      else router.refresh();
    });
  }
  return (
    <div>
      <button type="button" disabled={pending} className="btn-quiet !py-1 text-xs" onClick={toggle}>
        {isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
      </button>
      {err && <p className="mt-1 text-xs text-status-cancelled">{err}</p>}
    </div>
  );
}
