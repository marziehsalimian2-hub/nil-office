import "server-only";
import type { SpeechToTextProvider, TranscriptionResult } from "./provider";
import { classifyConfidence } from "./confidence";

type WhisperSegment = { avg_logprob: number; no_speech_prob: number };
type WhisperVerboseResponse = { text: string; segments?: WhisperSegment[] };

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

export class OpenAIWhisperProvider implements SpeechToTextProvider {
  async transcribe(audio: Buffer, opts: { mimeType: string; language?: string }): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: opts.mimeType }), "voice.ogg");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    if (opts.language) form.append("language", opts.language);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Never interpolate the API key into a log line — only the response.
      console.error("[whisper] transcription failed", res.status, body.slice(0, 500));
      throw new Error("VOICE_TRANSCRIPTION_FAILED");
    }
    const json = (await res.json()) as WhisperVerboseResponse;
    return { text: json.text?.trim() ?? "", confidence: classifyConfidence(json.segments) };
  }
}
