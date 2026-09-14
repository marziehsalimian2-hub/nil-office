// =============================================================================
// NIL Office — Whisper transcription-confidence heuristic tests.
// Pure-function tests for lib/assistant/speech/confidence.ts's
// classifyConfidence — deterministic, no network dependency.
//
// Run:  node --experimental-strip-types supabase/tests/whisper-confidence.test.mjs
// =============================================================================
import { classifyConfidence } from '../../lib/assistant/speech/confidence.ts';

let failures = 0;
function check(name, cond) {
  if (cond) console.log('PASS:', name);
  else { failures++; console.error('FAIL:', name); }
}

check('no segments -> LOW', classifyConfidence(undefined) === 'LOW');
check('empty segments -> LOW', classifyConfidence([]) === 'LOW');

check(
  'clear speech (high avg_logprob, low no_speech_prob) -> HIGH',
  classifyConfidence([{ avg_logprob: -0.1, no_speech_prob: 0.02 }, { avg_logprob: -0.15, no_speech_prob: 0.01 }]) === 'HIGH',
);

check(
  'borderline speech -> MEDIUM',
  classifyConfidence([{ avg_logprob: -0.45, no_speech_prob: 0.2 }]) === 'MEDIUM',
);

check(
  'garbled/mostly-silent speech -> LOW',
  classifyConfidence([{ avg_logprob: -0.9, no_speech_prob: 0.8 }]) === 'LOW',
);

check(
  'one bad segment among clear ones averages down but not necessarily to LOW',
  classifyConfidence([
    { avg_logprob: -0.1, no_speech_prob: 0.01 },
    { avg_logprob: -0.1, no_speech_prob: 0.01 },
    { avg_logprob: -0.9, no_speech_prob: 0.5 },
  ]) === 'MEDIUM',
);

check(
  'a single very-high no_speech_prob segment alone drags confidence down',
  classifyConfidence([{ avg_logprob: -0.1, no_speech_prob: 0.95 }]) === 'LOW',
);

console.log(failures === 0 ? '\nAll whisper-confidence tests passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
