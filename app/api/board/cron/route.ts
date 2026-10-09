import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyBoardCronSecret } from "@/lib/board/telegram/security";
import { dispatchBoardNotifications } from "@/lib/board/telegram/notify";
import { tehranDate } from "@/lib/board/time";

export const dynamic = "force-dynamic";

/**
 * Daily board job, called by the server's crontab at 09:00 Tehran (docs/BOARD_SECRETARIAT.md):
 *   curl -fsS -X POST -H "x-board-cron-secret: $BOARD_CRON_SECRET" https://<host>/api/board/cron
 * Queues the reminders / digest of the Tehran day (idempotent per day — a second call the same day queues nothing new), then drains the
 * outbox (also retries earlier failed sends). No session: protected by its own secret (constant-time compare), like the webhooks.
 */
export async function POST(req: NextRequest) {
  if (!verifyBoardCronSecret(req.headers.get("x-board-cron-secret"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const today = tehranDate(new Date())!;
  const service = createServiceClient();
  const { data: queued, error } = await service.rpc("board_enqueue_reminders", { p_today: today });
  if (error) {
    console.error("[board-cron] enqueue failed", error.message);
    return NextResponse.json({ ok: false, error: "ENQUEUE_FAILED" }, { status: 500 });
  }
  const sent = await dispatchBoardNotifications(200);
  return NextResponse.json({ ok: true, day: today, queued, ...sent });
}
