"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { completeFollowup } from "@/app/actions/entities";
export function FollowupComplete({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      className="btn-quiet p-1.5 text-status-final"
      aria-label="تکمیل"
      onClick={() => {
        const fd = new FormData();
        fd.append("id", id);
        start(async () => { await completeFollowup(null, fd); router.refresh(); });
      }}
    >
      <Check className="h-4 w-4" />
    </button>
  );
}
