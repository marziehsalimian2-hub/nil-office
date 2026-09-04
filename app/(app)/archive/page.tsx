import Link from "next/link";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { toFaDigits, formatJalali } from "@/lib/jalali";
import type { SearchResult } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const GROUP_LABEL: Record<string, string> = {
  correspondence: "مکاتبات", case: "پرونده‌ها", company: "شرکت‌ها", document: "اسناد", contract: "قراردادها",
  sales_document: "فاکتور/پیش‌فاکتور", company_contact: "افراد رابط", opportunity: "فرصت‌های تجاری",
};
const HREF: Record<string, (id: string, extra: string | null) => string> = {
  correspondence: (id) => `/correspondence/${id}`,
  case: (id) => `/cases/${id}`,
  company: (id) => `/companies/${id}`,
  document: (id) => `/documents/${id}`,
  contract: (id) => `/contracts/${id}`,
  sales_document: (id) => `/invoices/${id}`,
  company_contact: (_id, extra) => `/companies/${extra}`,
  opportunity: (id) => `/opportunities/${id}`,
};

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  let results: SearchResult[] = [];
  if (query) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("search_all", { p_q: query });
    results = (data ?? []) as SearchResult[];
  }
  const groups = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.entity_type] ??= []).push(r); return acc;
  }, {});

  return (
    <div>
      <PageHeader title="آرشیو و جستجو" subtitle="جستجوی یکپارچه در کل سامانه" />
      <form action="/archive" method="get" className="mb-6">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input name="q" defaultValue={query} placeholder="شماره نامه، موضوع، شرکت، پرونده، سند…" className="input pr-9" />
        </div>
      </form>
      {!query ? (
        <EmptyState title="عبارتی برای جستجو وارد کنید." hint="مثلاً «افرا طب» یا «گوگرد» یا شمارهٔ نامه." />
      ) : results.length === 0 ? (
        <EmptyState title={`نتیجه‌ای برای «${query}» یافت نشد.`} />
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([type, items]) => (
            <Card key={type}>
              <p className="mb-3 text-sm font-medium text-ink">{GROUP_LABEL[type] ?? type} <span className="tnum text-ink-muted">({items.length})</span></p>
              <ul className="divide-y divide-paper-line/60">
                {items.map((r) => (
                  <li key={`${type}-${r.id}`} className="py-2.5 text-sm">
                    <Link href={(HREF[type] ?? (() => "#"))(r.id, r.extra)} className="flex items-center gap-3 hover:text-seal">
                      <span className="flex-1 text-ink">{r.title}</span>
                      {r.subtitle && <span className="tnum text-xs text-ink-muted">{toFaDigits(r.subtitle)}</span>}
                      <span className="text-xs text-ink-muted tnum">{formatJalali(r.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
