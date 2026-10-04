import { ShieldAlert } from "lucide-react";

/** Permanent reminder of the spec's non-negotiable: nothing legal is ever guessed or pre-filled. */
export function NoRuleBanner() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-paper-line bg-paper/60 px-3 py-2 text-xs text-ink-muted">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        هیچ نرخ، آستانه یا حداقل دستمزد قانونی به‌صورت پیش‌فرض در سامانه وجود ندارد؛ همهٔ قواعد باید توسط مدیر وارد و تأیید شوند.
        بدون قاعدهٔ تأییدشده، هیچ مقداری حدس زده نمی‌شود.
      </p>
    </div>
  );
}
