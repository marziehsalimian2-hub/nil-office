import "server-only";

/**
 * The ONLY shape any LLM vendor's SDK is allowed to leak into the rest
 * of the app. Business logic (the Action Registry, the confirmation
 * engine, the chat route) is written against this interface, never
 * against `@anthropic-ai/sdk` directly — swapping vendors later means
 * writing one new adapter file, not touching anything else (spec §34).
 *
 * Shape mirrors Anthropic's own content-block turns closely (role +
 * content[]) rather than inventing something further removed from every
 * real vendor's wire format — a second provider still needs a thin
 * translation layer, but a real, honest one instead of a leaky fake.
 */

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export type LlmMessage = { role: "user" | "assistant"; content: LlmContentBlock[] };

export type LlmTool = {
  name: string;
  description: string;
  /** JSON Schema for the tool's input — built from each action's zod schema. */
  inputSchema: Record<string, unknown>;
};

export type LlmToolUseRequest = { id: string; name: string; input: unknown };

export type LlmTurnResult = {
  /** Plain natural-language text the model produced this turn (may be empty if it only called tools). */
  text: string;
  /** Tool calls the model wants executed before it can finish answering. */
  toolUses: LlmToolUseRequest[];
  /** Why the model stopped — "tool_use" means the caller must execute the tools and call converseWithTools again. */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
};

export interface LLMProvider {
  /**
   * One request/response turn — no streaming in v1 (plan decision #10).
   * The caller drives the tool-use loop: if stopReason is "tool_use",
   * execute the requested tools, append the assistant's tool_use blocks
   * and the resulting tool_result blocks to `messages`, and call again.
   */
  converseWithTools(input: {
    systemPrompt: string;
    messages: LlmMessage[];
    tools: LlmTool[];
  }): Promise<LlmTurnResult>;
}
