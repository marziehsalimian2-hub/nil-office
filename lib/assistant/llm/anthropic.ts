import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, TextBlockParam, ImageBlockParam, ToolUseBlockParam, ToolResultBlockParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import type { LLMProvider, LlmMessage, LlmTool, LlmTurnResult } from "./provider";

const MAX_TOKENS = 2000;

/**
 * @anthropic-ai/sdk@0.32.1 has no DocumentBlockParam export (PDF support
 * was added in a later SDK release) — hand-typed here against Anthropic's
 * own documented PDF-support wire format
 * (https://docs.anthropic.com/en/docs/build-with-claude/pdf-support).
 * The SDK's TS types are compile-time only; what actually goes over the
 * wire is whatever JSON this file builds, so this is a real, working
 * request shape, not a workaround — just not one the installed SDK
 * version happens to have a type for yet. Verify live after deploy
 * rather than assuming, same as every other new integration point this
 * session (see docs/NIL_ASSISTANT_MULTIMODAL.md).
 */
interface DocumentBlockParam {
  type: "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
}

type AnthropicContentBlockParam = TextBlockParam | ImageBlockParam | DocumentBlockParam | ToolUseBlockParam | ToolResultBlockParam;

function toAnthropicMessages(messages: LlmMessage[]): MessageParam[] {
  // The installed SDK's own MessageParam["content"] union has no
  // DocumentBlockParam slot (see the interface's own doc comment above)
  // — this cast is exactly that one known, deliberate gap, not a
  // blanket type-safety opt-out.
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b): AnthropicContentBlockParam => {
      if (b.type === "text") return { type: "text", text: b.text };
      if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      if (b.type === "tool_result") return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
      if (b.type === "image") return { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.data } };
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b.data } };
    }),
  })) as unknown as MessageParam[];
}

function toAnthropicTools(tools: LlmTool[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Tool.InputSchema,
  }));
}

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not configured");
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export class AnthropicProvider implements LLMProvider {
  async converseWithTools(input: { systemPrompt: string; messages: LlmMessage[]; tools: LlmTool[] }): Promise<LlmTurnResult> {
    const model = process.env.LLM_MODEL || "claude-sonnet-5";
    const response = await client().messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: input.systemPrompt,
      messages: toAnthropicMessages(input.messages),
      tools: toAnthropicTools(input.tools),
    });

    let text = "";
    const toolUses: LlmTurnResult["toolUses"] = [];
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") toolUses.push({ id: block.id, name: block.name, input: block.input });
    }

    const stopReason =
      response.stop_reason === "tool_use" ? "tool_use" : response.stop_reason === "end_turn" ? "end_turn" : response.stop_reason === "max_tokens" ? "max_tokens" : "other";

    return { text, toolUses, stopReason };
  }
}
