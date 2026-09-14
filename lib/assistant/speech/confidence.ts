import type { TranscriptionConfidence } from "./provider";

type WhisperSegment = { avg_logprob: number; no_speech_prob: number };

/**
 * Whisper's plain API has no word-level confidence score. The verbose
 * JSON response's per-segment avg_logprob/no_speech_prob is the closest
 * available proxy (spec §8's "if confidence is low, ask the user to
 * confirm/correct" requirement) — averaged across segments, since a
 * single bad segment in an otherwise clear recording shouldn't flag the
 * whole transcript LOW. Deliberately kept in its own pure, dependency-
 * free module (no "server-only", no fetch) so it's directly unit-
 * testable with plain Node — see supabase/tests/whisper-confidence.test.mjs.
 */
export function classifyConfidence(segments: WhisperSegment[] | undefined): TranscriptionConfidence {
  if (!segments || segments.length === 0) return "LOW";
  const avgLogprob = segments.reduce((sum, s) => sum + s.avg_logprob, 0) / segments.length;
  const maxNoSpeechProb = Math.max(...segments.map((s) => s.no_speech_prob));
  if (avgLogprob >= -0.3 && maxNoSpeechProb <= 0.3) return "HIGH";
  if (avgLogprob >= -0.6 && maxNoSpeechProb <= 0.6) return "MEDIUM";
  return "LOW";
}
