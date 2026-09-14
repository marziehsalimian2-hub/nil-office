import "server-only";

/**
 * The ONLY shape any speech-to-text vendor's API is allowed to leak
 * into the rest of the app — mirrors lib/assistant/llm/provider.ts's
 * own "one honest interface, one adapter file per vendor" convention
 * (spec §68's DocumentUnderstandingProvider/SpeechToTextProvider
 * abstraction requirement). Business logic (the Telegram voice handler)
 * is written against this interface, never against a vendor SDK/HTTP
 * shape directly.
 */

export type TranscriptionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type TranscriptionResult = {
  text: string;
  confidence: TranscriptionConfidence;
};

export interface SpeechToTextProvider {
  transcribe(audio: Buffer, opts: { mimeType: string; language?: string }): Promise<TranscriptionResult>;
}
