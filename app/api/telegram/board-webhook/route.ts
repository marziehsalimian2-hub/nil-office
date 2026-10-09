import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyBoardWebhookSecret } from "@/lib/board/telegram/security";
import { handleBoardTelegramUpdate } from "@/lib/board/telegram/handleUpdate";

export const dynamic = "force-dynamic";

/**
 * Board bot webhook — its own path, token and secret (never the assistant's /api/telegram/webhook or the external bot's). Same discipline:
 * secret check before parsing, idempotency claim (board_bot_updates) before any logic, always 200 once both pass (a failed step is told to
 * the member in the chat, never turned into a webhook error Telegram would retry into a duplicate).
 */
export async function POST(req: NextRequest) {
  if (!verifyBoardWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const updateId = (update as { update_id?: number } | null)?.update_id;
  if (!update || typeof update !== "object" || typeof updateId !== "number") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const service = createServiceClient();
  const { error } = await service.from("board_bot_updates").insert({ update_id: String(updateId) });
  if (error) {
    if ((error as { code?: string }).code === "23505") return NextResponse.json({ ok: true });   // already processed
    console.error("[board-telegram] idempotency claim failed", error.message);
    return NextResponse.json({ ok: true });
  }
  try {
    await handleBoardTelegramUpdate(update as Parameters<typeof handleBoardTelegramUpdate>[0]);
  } catch (err) {
    console.error("POST /api/telegram/board-webhook failed", err);
  }
  return NextResponse.json({ ok: true });
}
