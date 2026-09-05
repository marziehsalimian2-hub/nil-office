"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { TASK_STATUS, TASK_STATUS_LABEL, PM_PRIORITY, PM_PRIORITY_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };

export function FilterBar({ profiles, projects }: { profiles: Opt[]; projects: Opt[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function set(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/tasks?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <select className="input w-auto" value={searchParams.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">همهٔ وضعیت‌ها</option>
        {TASK_STATUS.map((s) => (<option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("priority") ?? ""} onChange={(e) => set("priority", e.target.value)}>
        <option value="">همهٔ اولویت‌ها</option>
        {PM_PRIORITY.map((p) => (<option key={p} value={p}>{PM_PRIORITY_LABEL[p]}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("assigned_to") ?? ""} onChange={(e) => set("assigned_to", e.target.value)}>
        <option value="">همهٔ مسئولان</option>
        {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("project_id") ?? ""} onChange={(e) => set("project_id", e.target.value)}>
        <option value="">همهٔ پروژه‌ها</option>
        <option value="none">بدون پروژه</option>
        {projects.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("due") ?? ""} onChange={(e) => set("due", e.target.value)}>
        <option value="">همهٔ مهلت‌ها</option>
        <option value="overdue">عقب‌افتاده</option>
        <option value="today">امروز</option>
        <option value="upcoming">پیش‌رو</option>
        <option value="none">بدون تاریخ</option>
      </select>
    </div>
  );
}
