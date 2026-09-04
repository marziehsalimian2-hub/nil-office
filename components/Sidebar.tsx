"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Send,
  Inbox,
  FolderOpen,
  FileText,
  BellRing,
  Building2,
  Search,
  Settings,
  Calculator,
  BookOpen,
  ArrowDownCircle,
  ArrowUpCircle,
  Landmark,
  Scale,
  CalendarRange,
  Wallet,
  FileSignature,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "داشبورد", icon: LayoutDashboard },
  { href: "/correspondence/outgoing", label: "نامه‌های صادره", icon: Send },
  { href: "/correspondence/incoming", label: "نامه‌های وارده", icon: Inbox },
  { href: "/cases", label: "پرونده‌ها", icon: FolderOpen },
  { href: "/documents", label: "اسناد", icon: FileText },
  { href: "/followups", label: "پیگیری‌ها", icon: BellRing },
  { href: "/companies", label: "شرکت‌ها", icon: Building2 },
  { href: "/contracts", label: "قراردادها", icon: FileSignature },
  { href: "/invoices", label: "فاکتورها", icon: Receipt },
  { href: "/archive", label: "آرشیو و جستجو", icon: Search },
  { href: "/settings", label: "تنظیمات", icon: Settings },
];

const accountingNav = [
  { href: "/accounting", label: "داشبورد مالی", icon: Calculator },
  { href: "/accounting/journal", label: "اسناد حسابداری", icon: BookOpen },
  { href: "/accounting/receipts", label: "دریافت‌ها", icon: ArrowDownCircle },
  { href: "/accounting/payments", label: "پرداخت‌ها", icon: ArrowUpCircle },
  { href: "/accounting/banks", label: "بانک و صندوق", icon: Wallet },
  { href: "/accounting/accounts", label: "کدینگ حساب‌ها", icon: Landmark },
  { href: "/accounting/ledger", label: "دفتر کل", icon: BookOpen },
  { href: "/accounting/trial-balance", label: "تراز آزمایشی", icon: Scale },
  { href: "/accounting/pnl", label: "سود و زیان", icon: Scale },
  { href: "/accounting/balance-sheet", label: "ترازنامه", icon: Scale },
  { href: "/accounting/fiscal-years", label: "سال مالی", icon: CalendarRange },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex items-center gap-3 px-2 pt-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-sm font-bold text-seal-soft">
          نیل
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-ink">دبیرخانه نیل</p>
          <p className="text-[11px] text-ink-muted">مدیریت راهبردی نیل</p>
        </div>
      </div>
      {nav.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn("nav-link", active && "nav-link-active")}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </Link>
        );
      })}

      <p className="mt-5 mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        مالی و حسابداری
      </p>
      {accountingNav.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href ||
          (href !== "/accounting" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn("nav-link", active && "nav-link-active")}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
