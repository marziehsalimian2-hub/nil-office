import { describe, it, expect } from "vitest";
import { evaluateCaps, type UsageToday } from "./usage";

const caps = { tokens: 1000, voicePerMin: 3 };
const usage = (over: Partial<UsageToday> = {}): UsageToday => ({ llm_tokens: 0, stt_seconds: 0, stt_last_minute: 0, ...over });

describe("evaluateCaps", () => {
  it("allows a user under both caps", () => {
    expect(evaluateCaps(usage({ llm_tokens: 999, stt_last_minute: 2 }), "LLM", caps).ok).toBe(true);
    expect(evaluateCaps(usage({ llm_tokens: 999, stt_last_minute: 2 }), "STT", caps).ok).toBe(true);
  });
  it("refuses the LLM at or over the daily token cap, with a Persian message", () => {
    const d = evaluateCaps(usage({ llm_tokens: 1000 }), "LLM", caps);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe("TOKENS");
      expect(d.message).toContain("سقف");
    }
  });
  it("refuses voice at the per-minute cap but still lets the LLM run", () => {
    const u = usage({ stt_last_minute: 3 });
    const stt = evaluateCaps(u, "STT", caps);
    expect(stt.ok).toBe(false);
    if (!stt.ok) expect(stt.reason).toBe("VOICE_RATE");
    expect(evaluateCaps(u, "LLM", caps).ok).toBe(true);
  });
  it("fails OPEN when the meter itself is unavailable (a broken counter must not lock the office out)", () => {
    expect(evaluateCaps(null, "LLM", caps).ok).toBe(true);
    expect(evaluateCaps(null, "STT", caps).ok).toBe(true);
  });
});
