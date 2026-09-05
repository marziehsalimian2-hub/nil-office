"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CRM_OPPORTUNITY_TYPE, CRM_OPPORTUNITY_TYPE_LABEL, CRM_OPPORTUNITY_PRIORITY, CRM_OPPORTUNITY_PRIORITY_LABEL } from "@/lib/enums";

type Opt = { id: string; label: string };
type Pipeline = { id: string; name: string; stages: Opt[] };

export function FilterBar({ pipelines, profiles }: { pipelines: Pipeline[]; profiles: Opt[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function set(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key === "pipeline_id") params.delete("stage_id");
    router.push(`/opportunities?${params.toString()}`);
  }

  const pipelineId = searchParams.get("pipeline_id") ?? "";
  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <select className="input w-auto" value={pipelineId} onChange={(e) => set("pipeline_id", e.target.value)}>
        <option value="">همهٔ پایپ‌لاین‌ها</option>
        {pipelines.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
      </select>
      {pipelineId && (
        <select className="input w-auto" value={searchParams.get("stage_id") ?? ""} onChange={(e) => set("stage_id", e.target.value)}>
          <option value="">همهٔ مراحل</option>
          {stages.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
        </select>
      )}
      <select className="input w-auto" value={searchParams.get("owner_user_id") ?? ""} onChange={(e) => set("owner_user_id", e.target.value)}>
        <option value="">همهٔ مالکان</option>
        {profiles.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("opportunity_type") ?? ""} onChange={(e) => set("opportunity_type", e.target.value)}>
        <option value="">همهٔ انواع</option>
        {CRM_OPPORTUNITY_TYPE.map((t) => (<option key={t} value={t}>{CRM_OPPORTUNITY_TYPE_LABEL[t]}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("priority") ?? ""} onChange={(e) => set("priority", e.target.value)}>
        <option value="">همهٔ اولویت‌ها</option>
        {CRM_OPPORTUNITY_PRIORITY.map((p) => (<option key={p} value={p}>{CRM_OPPORTUNITY_PRIORITY_LABEL[p]}</option>))}
      </select>
      <select className="input w-auto" value={searchParams.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">باز و بسته</option>
        <option value="open">باز</option>
        <option value="won">موفق</option>
        <option value="lost">ازدست‌رفته</option>
        <option value="stale">بدون فعالیت</option>
      </select>
    </div>
  );
}
