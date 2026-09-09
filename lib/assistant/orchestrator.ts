import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types/database";
import { getLLMProvider, type LlmMessage, type LlmContentBlock } from "@/lib/assistant/llm";
import { getAction, buildLlmTools } from "@/lib/assistant/actions/registry";
import { hasAccess, type ResultCard, type ReadActionResult, type WriteProposal } from "@/lib/assistant/actions/types";
import { buildSystemPrompt } from "@/lib/assistant/systemPrompt";
import { createPendingAction, confirmPendingAction, isAffirmativePhrase, findSinglePendingAction } from "@/lib/assistant/confirmation";

const RATE_LIMIT_PER_MINUTE = 20;
const HISTORY_WINDOW = 20; // spec §52 — bounded context, not full history
const MAX_TOOL_ROUNDS = 5; // guards a runaway tool-use loop (spec §49)

export type ChatTurnResult = {
  text: string;
  cards: ResultCard[];
  pendingAction: { id: string; previewText: string } | null;
  rateLimited?: boolean;
};

async function checkRateLimit(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 1000).toISOString();
  const { count } = await supabase
    .from("assistant_messages")
    .select("id, assistant_conversations!inner(user_id)", { count: "exact", head: true })
    .eq("role", "user")
    .eq("assistant_conversations.user_id", userId)
    .gte("created_at", since);
  return (count ?? 0) < RATE_LIMIT_PER_MINUTE;
}

async function saveMessage(supabase: SupabaseClient, conversationId: string, role: "user" | "assistant" | "tool", content: string, toolCalls?: unknown) {
  await supabase.from("assistant_messages").insert({ conversation_id: conversationId, role, content, tool_calls: toolCalls ?? null });
}

async function loadHistory(supabase: SupabaseClient, conversationId: string): Promise<LlmMessage[]> {
  const { data } = await supabase
    .from("assistant_messages")
    .select("role, content, tool_calls")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_WINDOW);
  const rows = (data ?? []).reverse();
  // Only user/assistant plain-text turns are replayed as history — tool
  // call/result plumbing from a PRIOR turn is not reconstructed for the
  // model (each turn's own tool loop is self-contained), keeping this
  // simple and firmly within the "bounded, not full history" budget.
  return rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({ role: r.role as "user" | "assistant", content: [{ type: "text", text: r.content ?? "" }] }));
}

/** Truncates a tool result before it goes back to the model — data minimization (spec §22), not a token-budget afterthought. */
function summarizeForModel(data: unknown): string {
  const json = JSON.stringify(data);
  return json.length > 4000 ? json.slice(0, 4000) + "…(truncated)" : json;
}

export async function runChatTurn(
  supabase: SupabaseClient,
  profile: Profile,
  conversationId: string,
  userMessageText: string,
): Promise<ChatTurnResult> {
  if (!(await checkRateLimit(supabase, profile.id))) {
    return { text: "لطفاً کمی صبر کنید و دوباره تلاش کنید.", cards: [], pendingAction: null, rateLimited: true };
  }

  await saveMessage(supabase, conversationId, "user", userMessageText);

  // Deterministic confirm-by-plain-text (spec §19) — never the LLM's call.
  if (isAffirmativePhrase(userMessageText)) {
    const single = await findSinglePendingAction(supabase, profile.id);
    if (single) {
      const result = await confirmPendingAction(supabase, profile.id, single.id);
      const text = result.ok ? "انجام شد. ثبت شد." : result.error;
      await saveMessage(supabase, conversationId, "assistant", text);
      return { text, cards: [], pendingAction: null };
    }
    // zero or >1 pending actions — fall through to a normal LLM turn so it can ask for disambiguation.
  }

  const history = await loadHistory(supabase, conversationId);
  const messages: LlmMessage[] = history;
  const systemPrompt = buildSystemPrompt(profile.full_name);
  const tools = buildLlmTools();
  const provider = getLLMProvider();

  const cards: ResultCard[] = [];
  let pendingAction: ChatTurnResult["pendingAction"] = null;
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const turn = await provider.converseWithTools({ systemPrompt, messages, tools });

    if (turn.toolUses.length === 0) {
      finalText = turn.text;
      break;
    }

    const assistantBlocks: LlmContentBlock[] = [];
    if (turn.text) assistantBlocks.push({ type: "text", text: turn.text });
    for (const tu of turn.toolUses) assistantBlocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
    messages.push({ role: "assistant", content: assistantBlocks });

    const resultBlocks: LlmContentBlock[] = [];
    for (const tu of turn.toolUses) {
      const action = getAction(tu.name);
      if (!action) {
        resultBlocks.push({ type: "tool_result", toolUseId: tu.id, content: "ابزار نامعتبر است.", isError: true });
        continue;
      }
      if (!hasAccess(profile, action.requiredAccess)) {
        resultBlocks.push({ type: "tool_result", toolUseId: tu.id, content: "کاربر به این بخش دسترسی ندارد.", isError: true });
        continue;
      }
      const parsed = action.inputSchema.safeParse(tu.input);
      if (!parsed.success) {
        resultBlocks.push({ type: "tool_result", toolUseId: tu.id, content: `ورودی نامعتبر: ${parsed.error.issues[0]?.message}`, isError: true });
        continue;
      }

      const ctx = { supabase, userId: profile.id, profile };
      try {
        // requiresConfirmation is a plain runtime flag, not a type
        // discriminant (see the comment on ActionDefinition in
        // actions/types.ts for why) — cast to the shape it's documented
        // to return on each branch.
        if (action.requiresConfirmation) {
          const proposal = (await action.handler(parsed.data, ctx)) as WriteProposal;
          const created = await createPendingAction(supabase, profile.id, action.name, proposal.payload, proposal.previewText);
          pendingAction = { id: created.pendingActionId, previewText: created.previewText };
          resultBlocks.push({
            type: "tool_result",
            toolUseId: tu.id,
            content: `پیشنهاد ساخته شد و منتظر تأیید کاربر است. این متن را دقیقاً به کاربر نشان بده و بپرس آیا تأیید می‌کند:\n${created.previewText}`,
          });
        } else {
          const result = (await action.handler(parsed.data, ctx)) as ReadActionResult;
          if (result.cards) cards.push(...result.cards);
          resultBlocks.push({ type: "tool_result", toolUseId: tu.id, content: summarizeForModel(result.data) });
        }
      } catch (err) {
        console.error(`[assistant] action ${action.name} failed`, err);
        resultBlocks.push({ type: "tool_result", toolUseId: tu.id, content: err instanceof Error ? err.message : "خطای غیرمنتظره.", isError: true });
      }
    }
    messages.push({ role: "user", content: resultBlocks });
  }

  if (!finalText) finalText = "متأسفم، پاسخ کامل نشد. لطفاً دوباره بپرسید.";
  await saveMessage(supabase, conversationId, "assistant", finalText, { cards, pendingAction });
  await supabase.from("assistant_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

  return { text: finalText, cards, pendingAction };
}
