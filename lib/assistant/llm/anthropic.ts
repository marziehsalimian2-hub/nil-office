import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, TextBlockParam, ImageBlockParam, ToolUseBlockParam, ToolResultBlockParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import type { LLMProvider, LlmMessage, LlmTool, LlmTurnResult } from "./provider";

const MAX_TOKENS = 2000;
type AnthropicContentBlockParam = TextBlockParam | ImageBlockParam | ToolUseBlockParam | ToolResultBlockParam;

function toAnthropicMessages(messages: LlmMessage[]): MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b): AnthropicContentBlockParam => {
      if (b.type === "text") return { type: "text", text: b.text };
      if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
    }),
  }));
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
