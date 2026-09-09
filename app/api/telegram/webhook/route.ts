import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyWebhookSecret } from "@/lib/assistant/telegram/security";
import { claimUpdateOnce } from "@/lib/assistant/telegram/idempotency";
import { handleTelegramUpdate } from "@/lib/assistant/telegram/handleUpdate";

/**
 * Telegram webhook — POST only, no page, no auth cookie. Order matters:
 * 1) secret header check (spec §4) — before the body is even parsed, so
 *    a request without the right secret costs nothing.
 * 2) idempotency claim (spec §30) — before any auth/session work, so a
 *    retried delivery is a single cheap insert, not a repeated LLM call.
 * 3) handleTelegramUpdate does its own allowlist -> identity -> session
 *    pipeline per spec §5/§6/§14.
 *
 * ALWAYS returns 200 once the secret/idempotency gates pass — Telegram
 * retries aggressively on anything else, and a slow/failed downstream
 * step is reported to the user as a chat message (handleUpdate's own
 * try/catch), never as a webhook-level error Telegram would retry into
 * a duplicate (spec §37).
 */
export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json().catch(() => null);
  if (!update || typeof update !== "object") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const updateId = (update as { update_id?: number }).update_id;
  if (updateId === undefined) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const service = createServiceClient();
  const isNew = await claimUpdateOnce(service, "TELEGRAM", updateId);
  if (!isNew) {
    return NextResponse.json({ ok: true }); // already processed — ack and stop
  }

  try {
    await handleTelegramUpdate(update as Parameters<typeof handleTelegramUpdate>[0]);
  } catch (err) {
    // handleTelegramUpdate already reports failures to the user inside its
    // own try/catch blocks — this is a genuinely unexpected failure
    // (e.g. a malformed update shape). Log only, still ack 200: retrying
    // this same update_id would just hit the idempotency claim above and
    // do nothing, so a 5xx here would only cost Telegram retry budget.
    console.error("POST /api/telegram/webhook failed", err);
  }

  return NextResponse.json({ ok: true });
}
