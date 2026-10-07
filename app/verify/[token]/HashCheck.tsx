"use client";

import { useState } from "react";

type Result =
  | { kind: "match" }
  | { kind: "mismatch" }
  | { kind: "error"; text: string };

const MAX_BYTES = 60 * 1024 * 1024;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Privacy-first file check: the SHA-256 is computed IN THE BROWSER (Web Crypto); only the 64-character hash is sent. The PDF itself is
 * never uploaded or stored. SHA-256 proves an exact binary match only — wording below is deliberately careful about what a mismatch means.
 */
export function HashCheck({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [result, setResult] = useState<Result | null>(null);

  async function onFile(file: File | undefined) {
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_BYTES) return setResult({ kind: "error", text: "حجم فایل بیش از حد مجاز است." });
    if (!window.crypto?.subtle) return setResult({ kind: "error", text: "مرورگر شما از بررسی امن فایل پشتیبانی نمی‌کند." });
    setBusy(true);
    try {
      const digest = await window.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const res = await fetch("/api/verify/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, hash: hex(digest) }),
      });
      if (res.status === 429) return setResult({ kind: "error", text: "تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید." });
      if (!res.ok) return setResult({ kind: "error", text: "بررسی انجام نشد؛ لطفاً دوباره تلاش کنید." });
      const data = (await res.json()) as { found?: boolean; match?: boolean };
      if (!data.found) return setResult({ kind: "error", text: "سندی با این شناسه قابل تأیید نیست." });
      setResult(data.match ? { kind: "match" } : { kind: "mismatch" });
    } catch {
      setResult({ kind: "error", text: "بررسی انجام نشد؛ لطفاً دوباره تلاش کنید." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mt-4 p-5">
      <h2 className="text-sm font-semibold text-ink">بررسی فایل PDF</h2>
      <p className="mt-1 text-xs leading-6 text-ink-muted">
        فایل PDF دریافتی را انتخاب کنید تا با نسخهٔ ثبت‌شده در NIL Office مقایسه شود. اثر انگشت فایل (SHA-256) روی دستگاه خودتان محاسبه می‌شود؛
        خودِ فایل بارگذاری یا ذخیره نمی‌شود.
      </p>
      <label className="mt-3 block">
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="block w-full text-sm text-ink file:ml-3 file:rounded-lg file:border file:border-paper-line file:bg-paper file:px-3 file:py-2 file:text-sm"
        />
      </label>
      {busy && <p className="mt-3 text-sm text-ink-muted">در حال بررسی «{fileName}»…</p>}
      {result?.kind === "match" && (
        <div className="mt-3 rounded-lg border border-status-final/40 bg-status-final/5 px-4 py-3 text-sm text-ink" role="status">
          ✓ فایل دقیقاً با نسخهٔ ثبت‌شده توسط NIL مطابقت دارد.
        </div>
      )}
      {result?.kind === "mismatch" && (
        <div className="mt-3 rounded-lg border border-status-waiting/40 bg-status-waiting/5 px-4 py-3 text-sm leading-7 text-ink" role="status">
          <p>✕ فایل ارائه‌شده با نسخهٔ ثبت‌شده مطابقت ندارد.</p>
          <p className="mt-1 text-xs text-ink-muted">
            این به‌تنهایی به معنای جعلی‌بودن سند نیست. فایل ممکن است دوباره ذخیره، فشرده، چاپ/اسکن یا ویرایش شده باشد؛ هر تغییری در محتوای باینری
            فایل نتیجه را عوض می‌کند. برای اطمینان، فایل اصلی را از صادرکنندهٔ سند بخواهید.
          </p>
        </div>
      )}
      {result?.kind === "error" && (
        <div className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink" role="alert">{result.text}</div>
      )}
      <p className="mt-3 text-[11px] leading-6 text-ink-muted">
        تطبیق فایل فقط «یکسان‌بودن دقیق فایل» را نشان می‌دهد. نسخهٔ چاپی یا اسکن‌شده معمولاً اثر انگشت متفاوتی دارد و با این روش قابل تطبیق نیست؛ در آن حالت
        به اطلاعات همین صفحه (شمارهٔ سند، تاریخ، وضعیت) تکیه کنید.
      </p>
    </section>
  );
}
