"use client";

const PROMPTS = [
  "امروز چه کارهایی دارم؟",
  "چه چیزهایی عقب افتاده؟",
  "وضعیت مالی نیل چیست؟",
  "قراردادهای نزدیک سررسید",
  "پروژه‌های نیازمند توجه",
  "فرصت‌های فروش بدون پیگیری",
];

export function QuickPrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PROMPTS.map((p) => (
        <button key={p} type="button" onClick={() => onPick(p)} className="btn-ghost text-xs">
          {p}
        </button>
      ))}
    </div>
  );
}
