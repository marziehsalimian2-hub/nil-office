import "server-only";
import type { SpeechToTextProvider } from "./provider";
import { OpenAIWhisperProvider } from "./openaiWhisper";

export type { SpeechToTextProvider, TranscriptionResult, TranscriptionConfidence } from "./provider";

let cached: SpeechToTextProvider | null = null;

/** Selects the configured provider (STT_PROVIDER env var) — only "openai-whisper" exists today, but nothing outside this file knows that. */
export function getSpeechToTextProvider(): SpeechToTextProvider {
  if (cached) return cached;
  const providerName = process.env.STT_PROVIDER || "openai-whisper";
  if (providerName !== "openai-whisper") {
    throw new Error(`Unsupported STT_PROVIDER "${providerName}" — only "openai-whisper" is implemented.`);
  }
  cached = new OpenAIWhisperProvider();
  return cached;
}
