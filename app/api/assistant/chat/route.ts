import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { runChatTurn } from "@/lib/assistant/orchestrator";
import type { Profile } from "@/lib/types/database";

const bodySchema = z.object({
  // .nullish() (not just .optional()) — the client sends an explicit
  // `null` for conversation_id on the first message of a new
  // conversation (JSON.stringify keeps `null` but drops `undefined`
  // keys entirely), so plain .optional() alone rejected every first
  // message with a generic "ورودی نامعتبر است."
  conversation_id: z.string().uuid().nullish(),
  message: z.string().trim().min(1).max(2000),
});

/**
 * One turn: rate-limit check -> load bounded history -> tool-use loop ->
 * persist messages -> respond. No streaming in v1 (plan decision #10) —
 * a single JSON response per turn.
 *
 * Deliberately does NOT use lib/auth.ts's requireProfile() here — that
 * helper redirect()s to /login, which is right for a page render but
 * wrong for a fetch()-driven JSON API (the client would receive an HTML
 * redirect response instead of the JSON error it can actually render).
 * Same inline auth-check + JSON-error shape the three existing PDF API
 * routes already use for the same reason.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "لطفاً وارد شوید." }, { status: 401 });

  const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profileRow || !profileRow.is_active) return NextResponse.json({ error: "حساب شما غیرفعال است." }, { status: 403 });
  const profile = profileRow as Profile;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ورودی نامعتبر است." }, { status: 400 });

  let conversationId = parsed.data.conversation_id;
  if (!conversationId) {
    const { data, error } = await supabase.from("assistant_conversations").insert({ user_id: profile.id, title: parsed.data.message.slice(0, 60) }).select("id").single();
    if (error || !data) return NextResponse.json({ error: "ایجاد مکالمه ناموفق بود." }, { status: 500 });
    conversationId = data.id;
  } else {
    const { data: owned } = await supabase.from("assistant_conversations").select("id").eq("id", conversationId).eq("user_id", profile.id).maybeSingle();
    if (!owned) return NextResponse.json({ error: "مکالمه پیدا نشد." }, { status: 404 });
  }

  if (!conversationId) return NextResponse.json({ error: "شناسهٔ مکالمه نامعتبر است." }, { status: 500 });
  const cid: string = conversationId;
  try {
    const result = await runChatTurn(supabase, profile, cid, parsed.data.message);
    return NextResponse.json({ conversation_id: cid, ...result });
  } catch (err) {
    console.error("POST /api/assistant/chat failed", err);
    return NextResponse.json({ error: "دستیار نیل موقتاً در دسترس نیست." }, { status: 503 });
  }
}
