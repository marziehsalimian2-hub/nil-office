import { describeWarning, WARNING_SEVERITY_LABEL, type PayrollWarning } from "@/lib/payroll/warnings";
import { groupWarningsByPersonnel } from "@/lib/payroll/review";

const TONE: Record<string, string> = { CRITICAL: "status-cancelled", WARNING: "status-waiting", INFO: "status-draft" };

/** Server component: warnings are codes mapped to Persian text — never amounts. */
export function WarningsList({ warnings, names }: { warnings: PayrollWarning[]; names: Record<string, string> }) {
  if (warnings.length === 0) return <p className="text-sm text-ink-muted">هشداری ثبت نشده است.</p>;
  const groups = groupWarningsByPersonnel(warnings);
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : (names[a] ?? "").localeCompare(names[b] ?? "")));
  return (
    <div className="space-y-4">
      {keys.map((k) => (
        <div key={k || "batch"} className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">{k === "" ? "کل دسته" : (names[k] ?? "—")}</h3>
          <ul className="space-y-1.5">
            {(groups.get(k) ?? []).map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={`badge shrink-0 ${TONE[w.severity]}`}>{WARNING_SEVERITY_LABEL[w.severity]}</span>
                <span className="text-ink">{describeWarning(w)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
