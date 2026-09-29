import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyExternalWebhookSecret } from "@/lib/external-bot/telegram/security";
import { claimExternalUpdateOnce } from "@/lib/external-bot/telegram/idempotency";
import { handleExternalTelegramUpdate } from "@/lib/external-bot/telegram/handleUpdate";

/**
 * External Correspondence Telegram Bot webhook — an entirely separate
 * path, token, and secret from the internal bot's own
 * /api/telegram/webhook (spec §0/§53/§54). Same ordering discipline as
 * the internal webhook: secret check before body parsing, idempotency
 * claim before any business logic, always 200 once both gates pass (a
 * failed downstream step is reported to the user as a chat message,
 * never as a webhook-level error Telegram would retry into a duplicate).
 */
export async function POST(req: NextRequest) {
  if (!verifyExternalWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
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
  const isNew = await claimExternalUpdateOnce(service, updateId);
  if (!isNew) {
    return NextResponse.json({ ok: true }); // already processed — ack and stop
  }

  try {
    await handleExternalTelegramUpdate(update as Parameters<typeof handleExternalTelegramUpdate>[0]);
  } catch (err) {
    console.error("POST /api/telegram/external-webhook failed", err);
  }

  return NextResponse.json({ ok: true });
}
