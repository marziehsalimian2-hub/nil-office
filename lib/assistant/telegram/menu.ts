import type { Profile } from "@/lib/types/database";
import { canCreateAccounting, canCreateInvoice, hasServiceLedgerAccess } from "@/lib/assistant/actions/access";

/**
 * Telegram quick-action menu (Slice 3, spec §58). Natural language stays the main interface — this is an OPTIONAL
 * shortcut keyboard. Pure (no Telegram / DB calls) so the rules are unit-tested:
 *
 *  - the menu only shows what the user's role can actually do (a button for an action you cannot perform would only
 *    produce a refusal);
 *  - callbacks are opaque, fixed keys («menu:today») that carry NO data (spec §56) and are re-authorised on every tap —
 *    handleCallbackQuery runs the same allowlist → identity → profile pipeline as a message before this is consulted;
 *  - an ASK item re-uses a fixed question through the normal turn (the same gated tools, never a shortcut around them);
 *    a GUIDE item replies with a fixed how-to and never writes anything.
 */

export type MenuKey = "today" | "overdue" | "letter" | "receipt" | "payment" | "service" | "proforma" | "customers" | "reports";

export type MenuItem = {
  key: MenuKey;
  label: string;
  kind: "ASK" | "GUIDE";
  /** ASK: the fixed question sent through runChatTurn */
  prompt?: string;
  /** GUIDE: the fixed reply */
  guide?: string;
  allowed: (p: Profile) => boolean;
};

const anyone = () => true;

export const MENU_ITEMS: MenuItem[] = [
  { key: "today", label: "📅 امروز من", kind: "ASK", prompt: "امروز چه کارهایی دارم؟", allowed: anyone },
  { key: "overdue", label: "⏰ کارهای عقب‌افتاده", kind: "ASK", prompt: "کارها و پیگیری‌های عقب‌افتادهٔ من را نشان بده.", allowed: anyone },
  {
    key: "letter", label: "✉️ نامه جدید", kind: "GUIDE", allowed: anyone,
    guide: "برای نامهٔ جدید بگو یا بنویس، مثلاً:\n«برای شرکت X نامه‌ای دربارهٔ Y بنویس.»\nپیش‌نویس ساخته می‌شود و شمارهٔ رسمی فقط با تأیید جداگانهٔ شما صادر می‌شود. می‌توانی ویس هم بفرستی.",
  },
  {
    key: "receipt", label: "📥 دریافت جدید", kind: "GUIDE", allowed: canCreateAccounting,
    guide: "عکس رسید واریز را بفرست (یا بگو: «امروز شرکت X صد میلیون ریال به حساب Y واریز کرد»).\nفقط پیش‌نویس دریافت ساخته می‌شود؛ تأیید، ثبت قطعی و تسویهٔ فاکتور کار حسابدار در NIL Office است.",
  },
  {
    key: "payment", label: "📤 پرداخت جدید", kind: "GUIDE", allowed: canCreateAccounting,
    guide: "عکس یا PDF فاکتور تأمین‌کننده / رسید هزینه را بفرست (یا بگو چه مبلغی به چه کسی پرداخت شد).\nفقط پیش‌نویس پرداخت ساخته می‌شود؛ تأیید و ثبت قطعی کار حسابدار در NIL Office است.",
  },
  {
    key: "service", label: "🧾 ثبت خدمت", kind: "GUIDE", allowed: hasServiceLedgerAccess,
    guide: "بگو چه خدمتی برای کدام مشتری انجام شد، مثلاً:\n«امروز برای شرکت X پیگیری ثبت شرکت انجام دادم، یک ساعت و نیم زمان برد.»\nاگر هزینه‌ای هم بود بگو و اینکه قابل بازپرداخت از مشتری است یا نه.",
  },
  {
    key: "proforma", label: "📄 پیش‌فاکتور", kind: "GUIDE", allowed: canCreateInvoice,
    guide: "بگو برای کدام شرکت، چه اقلامی، با چه تعداد و قیمتی (و واحد پول)، مثلاً:\n«برای شرکت X پیش‌فاکتور بزن: ۲ عدد Y با قیمت واحد …».\nپیش‌نویس ساخته می‌شود و شمارهٔ رسمی فقط با تأیید جداگانهٔ شما صادر می‌شود.",
  },
  {
    key: "customers", label: "🏢 مشتریان", kind: "GUIDE", allowed: anyone,
    guide: "نام مشتری را بنویس تا پیدا کنم یا وضعیتش را نشان بدهم، مثلاً:\n«وضعیت شرکت X» یا «مانده حساب شرکت X».\nاگر چند شرکت مشابه باشد، گزینه‌ها را به‌صورت دکمه می‌بینی.",
  },
  { key: "reports", label: "📊 گزارش‌ها", kind: "ASK", prompt: "گزارش امروز را بده.", allowed: anyone },
];

export const MENU_TITLE = "منوی سریع — یا هر چیزی را مثل همیشه بنویس یا بگو:";
export const MENU_CALLBACK_PREFIX = "menu:";

type Button = { text: string; callback_data: string };

/** Role-filtered keyboard, two buttons per row. */
export function buildMenuKeyboard(profile: Profile): Button[][] {
  const buttons = MENU_ITEMS.filter((i) => i.allowed(profile)).map((i) => ({ text: i.label, callback_data: `${MENU_CALLBACK_PREFIX}${i.key}` }));
  const rows: Button[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

/** callback_data -> the item to run, or null for an unknown key / a key this user's role may not use. */
export function resolveMenuCallback(data: string, profile: Profile): MenuItem | null {
  if (!data.startsWith(MENU_CALLBACK_PREFIX)) return null;
  const key = data.slice(MENU_CALLBACK_PREFIX.length);
  const item = MENU_ITEMS.find((i) => i.key === key);
  return item && item.allowed(profile) ? item : null;
}

/** «/menu» or «منو» (the whole message, ignoring case / surrounding spaces / a bot @username suffix). */
export function isMenuRequest(text: string | undefined): boolean {
  const t = (text ?? "").trim().toLowerCase().replace(/@\w+$/, "");
  return t === "/menu" || t === "منو";
}
