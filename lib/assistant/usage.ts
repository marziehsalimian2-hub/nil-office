import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Assistant audit + cost control (spec §59/§60/§61). Both are best-effort by design: an audit or
 * accounting failure must never break the user's request, but it is always logged to the server console.
 * The pure cap decision lives in `evaluateCaps` so it is unit-tested without a database.
 */

export type AuditEvent =
  | "PROPOSED" | "CONFIRMED" | "CANCELLED" | "PERMISSION_DENIED" | "PAYLOAD_TAMPERED" | "EXPIRED"
  | "FILE_PROCESSED" | "FILE_REJECTED" | "VOICE_TRANSCRIBED" | "RATE_LIMITED" | "CAP_EXCEEDED"
  | "UNAUTHORIZED_TELEGRAM" | "PAYSLIP_DELIVERED" | "FAILED";

/** Never put payloads, amounts, salary or free user text in `meta` — codes, ids and counts only. */
export async function auditAssistant(
  supabase: SupabaseClient,
  userId: string | null,
  event: AuditEvent,
  actionName?: string | null,
  meta: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  try {
    const { error } = await supabase.rpc("assistant_audit", { p_user_id: userId, p_event: event, p_action: actionName ?? null, p_meta: meta });
    if (error) console.error("[assistant] audit failed", event, error.message);
  } catch (err) {
    console.error("[assistant] audit threw", event, err);
  }
}

export type UsageKind = "LLM" | "STT" | "VISION";

export async function recordUsage(
  supabase: SupabaseClient,
  userId: string,
  channel: "TELEGRAM" | "WEB",
  kind: UsageKind,
  unitsIn: number,
  unitsOut: number,
  ms: number,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("assistant_record_usage", {
      p_user_id: userId, p_channel: channel, p_kind: kind,
      p_units_in: Math.round(unitsIn), p_units_out: Math.round(unitsOut), p_ms: Math.round(ms),
    });
    if (error) console.error("[assistant] usage record failed", error.message);
  } catch (err) {
    console.error("[assistant] usage record threw", err);
  }
}

export type UsageToday = { llm_tokens: number; stt_seconds: number; stt_last_minute: number };

export async function getUsageToday(supabase: SupabaseClient, userId: string): Promise<UsageToday | null> {
  try {
    const { data, error } = await supabase.rpc("assistant_usage_today", { p_user_id: userId });
    if (error || !data) {
      console.error("[assistant] usage lookup failed", error?.message);
      return null;
    }
    const d = data as Partial<UsageToday>;
    return { llm_tokens: Number(d.llm_tokens ?? 0), stt_seconds: Number(d.stt_seconds ?? 0), stt_last_minute: Number(d.stt_last_minute ?? 0) };
  } catch (err) {
    console.error("[assistant] usage lookup threw", err);
    return null;
  }
}

export const DEFAULT_DAILY_TOKEN_CAP = 600_000;
export const DEFAULT_MAX_VOICE_PER_MIN = 4;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function dailyTokenCap(): number {
  return envInt("ASSISTANT_DAILY_TOKEN_CAP", DEFAULT_DAILY_TOKEN_CAP);
}
export function maxVoicePerMinute(): number {
  return envInt("ASSISTANT_MAX_VOICE_PER_MIN", DEFAULT_MAX_VOICE_PER_MIN);
}

export type CapDecision = { ok: true } | { ok: false; reason: "TOKENS" | "VOICE_RATE"; message: string };

/** Pure: should this user's next LLM call / voice transcription be refused? `usage === null` (lookup failed) fails OPEN — a broken meter must not lock the office out. */
export function evaluateCaps(usage: UsageToday | null, want: "LLM" | "STT", caps = { tokens: dailyTokenCap(), voicePerMin: maxVoicePerMinute() }): CapDecision {
  if (!usage) return { ok: true };
  if (want === "LLM" && usage.llm_tokens >= caps.tokens) {
    return { ok: false, reason: "TOKENS", message: "سقف مصرف روزانهٔ دستیار برای شما پر شده است. لطفاً فردا دوباره تلاش کنید یا موضوع را با مدیر سامانه در میان بگذارید." };
  }
  if (want === "STT" && usage.stt_last_minute >= caps.voicePerMin) {
    return { ok: false, reason: "VOICE_RATE", message: "پیام‌های صوتی پشت‌سرهم زیاد بود. چند لحظه صبر کنید و دوباره بفرستید." };
  }
  return { ok: true };
}
