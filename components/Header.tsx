"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, Search, LogOut, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sidebar } from "@/components/Sidebar";

export function Header({ userName }: { userName: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term) router.push(`/archive?q=${encodeURIComponent(term)}`);
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-paper-line bg-paper-card/90 px-4 backdrop-blur">
        <button
          className="btn-quiet -mr-2 p-2 lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="باز کردن منو"
        >
          <Menu className="h-5 w-5" />
        </button>

        <form onSubmit={submitSearch} className="relative flex-1 max-w-xl">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو در شماره نامه، موضوع، شرکت، پرونده…"
            className="input pr-9"
          />
        </form>

        <div className="mr-auto flex items-center gap-2">
          <Link href="/profile" className="hidden text-sm text-ink-muted hover:text-ink sm:block">
            {userName}
          </Link>
          <button className="btn-quiet p-2" onClick={signOut} aria-label="خروج">
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 w-72 max-w-[85%] bg-paper-card shadow-xl">
            <div className="flex justify-end p-2">
              <button className="btn-quiet p-2" onClick={() => setOpen(false)} aria-label="بستن">
                <X className="h-5 w-5" />
              </button>
            </div>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
