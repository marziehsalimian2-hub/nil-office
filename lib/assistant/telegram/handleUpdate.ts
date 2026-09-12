import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { isAllowedTelegramUser, isPrivateChat } from "./security";
import { resolveProfileForTelegramUser } from "./identity";
import { getSessionClientForProfile } from "./session";
import { sendMessage, answerCallbackQuery, clearInlineKeyboard } from "./bot";
import { formatChatTurnForTelegram } from "./format";
import { runChatTurn } from "@/lib/assistant/orchestrator";
import { confirmPendingAction, cancelPendingAction } from "@/lib/assistant/confirmation";
import type { Profile } from "@/lib/types/database";

// Minimal shape of what this handler actually reads — not the full Telegram Update schema.
type TelegramUpdate = {
  message?: { message_id: number; chat: { id: number; type: string }; from?: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number; type: string } } };
};

const ACCESS_DENIED_TEXT = "دسترسی شما به این ربات مجاز نیست.";
const NOT_LINKED_TEXT = "حساب شما هنوز به NIL Office متصل نشده است. لطفاً با مدیر سامانه تماس بگیرید.";
const UNAVAILABLE_TEXT = "دستیار نیل موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.";

const SLASH_ALIASES: Record<string, string> = {
  "/start": "سلام نیل",
  "/today": "امروز چه کارهایی دارم؟",
  "/attention": "چه چیزهایی نیاز به توجه دارند؟",
  "/projects": "وضعیت پروژه‌ها را نشان بده",
  "/contracts": "قراردادهای نزدیک پایان را نشان بده",
  "/invoices": "فاکتورهای پرداخت‌نشده را نشان بده",
  "/help": "چه کارهایی می‌توانی برای من انجام بدی؟",
};

/**
 * Resolves a Telegram sender to a NIL Office profile + a real, RLS-bound
 * session client — the SAME allowlist -> identity -> session pipeline
 * for both a text message and a button tap (spec §14 requires the
 * callback path to re-verify everything a fresh message would).
 * Authorization is read only from the caller's own numeric id — never
 * from forwarded-message metadata (spec §28) or a username (spec §1).
 */
async function authorize(telegramUserId: number): Promise<{ profile: Profile; sessionClient: Awaited<ReturnType<typeof getSessionClientForProfile>> } | { denied: "NOT_ALLOWED" | "NOT_LINKED" }> {
  if (!isAllowedTelegramUser(telegramUserId)) return { denied: "NOT_ALLOWED" };

  const service = createServiceClient();
  const mapped = await resolveProfileForTelegramUser(service, telegramUserId);
  if (!mapped) return { denied: "NOT_LINKED" };

  const sessionClient = await getSessionClientForProfile(mapped.profileId);
  const { data: profile, error: profileErr } = await sessionClient.from("profiles").select("*").eq("id", mapped.profileId).single();
  // TEMP DIAGNOSTIC — remove once the NOT_LINKED cause is confirmed.
  console.error("[telegram][diag4] profile fetch", JSON.stringify({ profileId: mapped.profileId, found: !!profile, is_active: profile?.is_active, error: profileErr }));
  if (!profile || !profile.is_active) return { denied: "NOT_LINKED" };

  return { profile: profile as Profile, sessionClient };
}

async function findOrCreateTelegramConversation(sessionClient: Awaited<ReturnType<typeof getSessionClientForProfile>>, profileId: string): Promise<string> {
  const { data: existing } = await sessionClient
    .from("assistant_conversations")
    .select("id")
    .eq("user_id", profileId)
    .eq("channel", "TELEGRAM")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await sessionClient
    .from("assistant_conversations")
    .insert({ user_id: profileId, channel: "TELEGRAM", title: "تلگرام" })
    .select("id")
    .single();
  if (error || !created) throw new Error(`failed to create Telegram conversation: ${error?.message}`);
  return created.id;
}

async function handleMessage(msg: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  if (!isPrivateChat(msg.chat.type)) return; // spec §26/§27 — groups/channels ignored entirely, no reply
  const telegramUserId = msg.from?.id;
  if (!telegramUserId || !msg.text) return;

  const auth = await authorize(telegramUserId);
  if ("denied" in auth) {
    await sendMessage(msg.chat.id, auth.denied === "NOT_ALLOWED" ? ACCESS_DENIED_TEXT : NOT_LINKED_TEXT);
    return;
  }

  const text = SLASH_ALIASES[msg.text.trim()] ?? msg.text;

  try {
    const conversationId = await findOrCreateTelegramConversation(auth.sessionClient, auth.profile.id);
    const result = await runChatTurn(auth.sessionClient, auth.profile, conversationId, text);
    const { chunks, keyboard } = formatChatTurnForTelegram(result);
    for (let i = 0; i < chunks.length; i++) {
      await sendMessage(msg.chat.id, chunks[i], i === chunks.length - 1 ? keyboard : undefined);
    }
  } catch (err) {
    console.error("[telegram] handleMessage failed", err);
    await sendMessage(msg.chat.id, UNAVAILABLE_TEXT);
  }
}

async function handleCallbackQuery(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  if (!cb.message || !isPrivateChat(cb.message.chat.type) || !cb.data) {
    await answerCallbackQuery(cb.id);
    return;
  }

  const auth = await authorize(cb.from.id);
  if ("denied" in auth) {
    await answerCallbackQuery(cb.id, ACCESS_DENIED_TEXT);
    return;
  }

  const [decision, pendingActionId] = cb.data.split(":");
  if (!pendingActionId || (decision !== "confirm" && decision !== "cancel")) {
    await answerCallbackQuery(cb.id);
    return;
  }

  try {
    // confirmPendingAction/cancelPendingAction are UNCHANGED from the web
    // path — their own .eq("user_id", userId) already refuses a
    // different user's pending action (spec §14), and the atomic UPDATE
    // already makes a double-tap a no-op (spec §31/§40).
    let ok: boolean;
    let errorMessage: string | undefined;
    if (decision === "confirm") {
      const result = await confirmPendingAction(auth.sessionClient, auth.profile.id, pendingActionId);
      ok = result.ok;
      errorMessage = result.ok ? undefined : result.error;
    } else {
      const result = await cancelPendingAction(auth.sessionClient, auth.profile.id, pendingActionId);
      ok = result.ok;
    }

    await answerCallbackQuery(cb.id);
    await clearInlineKeyboard(cb.message.chat.id, cb.message.message_id);
    const text = ok ? (decision === "confirm" ? "انجام شد. ثبت شد." : "لغو شد.") : (errorMessage ?? "این درخواست دیگر معتبر نیست.");
    await sendMessage(cb.message.chat.id, text);
  } catch (err) {
    console.error("[telegram] handleCallbackQuery failed", err);
    await answerCallbackQuery(cb.id);
    await sendMessage(cb.message.chat.id, UNAVAILABLE_TEXT);
  }
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message) return handleMessage(update.message);
  if (update.callback_query) return handleCallbackQuery(update.callback_query);
}
