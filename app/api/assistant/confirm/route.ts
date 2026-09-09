import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { confirmPendingAction, cancelPendingAction } from "@/lib/assistant/confirmation";

const bodySchema = z.object({
  pending_action_id: z.string().uuid(),
  decision: z.enum(["confirm", "cancel"]),
});

/**
 * The Action Preview card's تأیید/لغو buttons call this directly — no
 * LLM round-trip involved in actually executing a write (plan
 * decision #5). Same inline-auth-check shape as the chat route, for the
 * same fetch()-vs-redirect() reason.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "لطفاً وارد شوید." }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ورودی نامعتبر است." }, { status: 400 });

  try {
    if (parsed.data.decision === "cancel") {
      const result = await cancelPendingAction(supabase, user.id, parsed.data.pending_action_id);
      return NextResponse.json({ ok: result.ok });
    }
    const result = await confirmPendingAction(supabase, user.id, parsed.data.pending_action_id);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, result_id: result.resultId });
  } catch (err) {
    console.error("POST /api/assistant/confirm failed", err);
    return NextResponse.json({ error: "عملیات ناموفق بود." }, { status: 500 });
  }
}
