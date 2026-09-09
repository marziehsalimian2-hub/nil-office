import "server-only";
import type { LLMProvider } from "./provider";
import { AnthropicProvider } from "./anthropic";

export type { LLMProvider, LlmMessage, LlmContentBlock, LlmTool, LlmTurnResult } from "./provider";

let cached: LLMProvider | null = null;

/** Selects the configured provider (LLM_PROVIDER env var) — only "anthropic" exists today, but nothing outside this file knows that. */
export function getLLMProvider(): LLMProvider {
  if (cached) return cached;
  const providerName = process.env.LLM_PROVIDER || "anthropic";
  if (providerName !== "anthropic") {
    throw new Error(`Unsupported LLM_PROVIDER "${providerName}" — only "anthropic" is implemented.`);
  }
  cached = new AnthropicProvider();
  return cached;
}
