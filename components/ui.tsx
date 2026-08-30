import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  CORR_STATUS_LABEL,
  CORR_STATUS_TONE,
  type CorrStatus,
} from "@/lib/enums";

export function StatusBadge({ status }: { status: CorrStatus }) {
  return (
    <span className={cn("badge bg-paper", CORR_STATUS_TONE[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CORR_STATUS_LABEL[status]}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-paper-line bg-paper-card px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-ink-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("card p-5", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  href,
  tone = "ink",
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
  tone?: "ink" | "seal" | "warn" | "danger";
}) {
  const toneClass = {
    ink: "text-ink",
    seal: "text-seal",
    warn: "text-status-waiting",
    danger: "text-status-cancelled",
  }[tone];
  const body = (
    <div className="card p-5 transition hover:shadow-md">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tnum", toneClass)}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
