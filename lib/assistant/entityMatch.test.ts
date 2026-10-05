import { describe, it, expect } from "vitest";
import { normalizeFa, stripLegalWords, scoreName, scoreMatch, classify, meetsStrict, humanMentioned, THRESHOLDS } from "./entityMatch";

describe("normalizeFa", () => {
  it("unifies Arabic and Persian letter variants", () => {
    expect(normalizeFa("رضايي")).toBe(normalizeFa("رضایی"));
    expect(normalizeFa("كارخانه")).toBe("کارخانه");
    expect(normalizeFa("رضائی")).toBe(normalizeFa("رضایی"));
  });
  it("treats ZWNJ, NBSP and repeated spaces as one space", () => {
    expect(normalizeFa("دبیرخانه‌ هوشمند")).toBe("دبیرخانه هوشمند");
    expect(normalizeFa("دبیرخانه  هوشمند")).toBe("دبیرخانه هوشمند");
  });
  it("maps Persian and Arabic digits to ASCII, lower-cases Latin and drops punctuation", () => {
    expect(normalizeFa("INV-۱۴۰۵/٠٠١٢")).toBe("inv 1405 0012");
    expect(normalizeFa("ACME, Ltd.")).toBe("acme ltd");
  });
  it("removes tatweel and diacritics", () => {
    expect(normalizeFa("شــرکت")).toBe("شرکت");
    expect(normalizeFa("رِضایی")).toBe("رضایی");
  });
  it("is safe on empty / null", () => {
    expect(normalizeFa("")).toBe("");
    expect(normalizeFa(null)).toBe("");
    expect(normalizeFa(undefined)).toBe("");
  });
});

describe("stripLegalWords", () => {
  it("removes legal-form words and phrases but never everything", () => {
    expect(stripLegalWords(normalizeFa("شرکت رضایی"))).toBe("رضایی");
    expect(stripLegalWords(normalizeFa("رضایی (سهامی خاص)"))).toBe("رضایی");
    expect(stripLegalWords(normalizeFa("ACME Co. Ltd"))).toBe("acme");
    expect(stripLegalWords(normalizeFa("شرکت"))).toBe("شرکت");
  });
});

describe("scoreName", () => {
  it("exact normalized name = 1", () => {
    expect(scoreName("شرکت رضائی", "شرکت رضایی")).toBe(1);
    expect(scoreName("دبیرخانه‌ی هوشمند", "دبیرخانه ی هوشمند")).toBe(1);
  });
  it("same name apart from the legal form = 0.97", () => {
    expect(scoreName("رضایی", "شرکت رضایی")).toBe(0.97);
    expect(scoreName("acme", "ACME Co.")).toBe(0.97);
  });
  it("a query that is only part of the name scores 0.80-0.92", () => {
    const s = scoreName("رضایی", "رضایی صنعت");
    expect(s).toBeGreaterThan(0.8);
    expect(s).toBeLessThanOrEqual(0.92);
    expect(scoreName("رضایی", "رضایی صنعت")).toBeGreaterThan(scoreName("رضایی", "رضایی صنعت و تجارت پارس"));
  });
  it("a fuzzy match stays ≤ 0.78 and unrelated names score low", () => {
    expect(scoreName("رضایان", "رضایی")).toBeLessThanOrEqual(0.78);
    expect(scoreName("رضایی", "پارس آتیه")).toBeLessThan(0.45);
  });
  it("document numbers match as exact fields", () => {
    expect(scoreMatch("INV-1405-0012", ["مشتری الف", "inv-1405-0012"])).toBe(1);
  });
  it("empty inputs score 0", () => {
    expect(scoreName("", "x")).toBe(0);
    expect(scoreName("x", "")).toBe(0);
    expect(scoreMatch("x", [null, undefined])).toBe(0);
  });
});

const S = (id: string, score: number) => ({ id, score });

describe("classify — normal threshold", () => {
  it("one clear winner is RESOLVED", () => {
    const c = classify([S("a", 1), S("b", 0.6)]);
    expect(c.tier).toBe("RESOLVED");
    expect(c.top?.id).toBe("a");
    expect(c.margin).toBeCloseTo(0.4);
  });
  it("two close candidates are AMBIGUOUS — the situation behind «رضایی»", () => {
    const names = ["شرکت رضایی", "رضایی صنعت", "رضایی تجارت"];
    const scored = names.map((n, i) => ({ id: String(i), score: scoreMatch("رضایی", [n]) }));
    expect(classify(scored).tier).toBe("AMBIGUOUS");
  });
  it("an exact full name beats look-alikes", () => {
    const names = ["رضایی صنعت", "رضایی تجارت", "رضایی صنعت و تجارت"];
    const scored = names.map((n, i) => ({ id: String(i), score: scoreMatch("رضایی صنعت", [n]) }));
    expect(classify(scored).tier).toBe("RESOLVED");
  });
  it("two entities with the SAME name can never be resolved automatically", () => {
    expect(classify([S("a", 1), S("b", 1)]).tier).toBe("AMBIGUOUS");
  });
  it("a single middling candidate is WEAK (ask «منظورتان … است؟»)", () => {
    expect(classify([S("a", 0.86)]).tier).toBe("WEAK");
  });
  it("nothing plausible is NONE", () => {
    expect(classify([]).tier).toBe("NONE");
    expect(classify([S("a", 0.3), S("b", 0.2)]).tier).toBe("NONE");
  });
});

describe("classify — strict (financial / official)", () => {
  it("0.93 vs 0.5 resolves normally but not strictly", () => {
    const scored = [S("a", 0.93), S("b", 0.5)];
    expect(classify(scored, "normal").tier).toBe("RESOLVED");
    expect(classify(scored, "strict").tier).not.toBe("RESOLVED");
  });
  it("an exact match with a wide margin passes strict", () => {
    expect(classify([S("a", 1), S("b", 0.6)], "strict").tier).toBe("RESOLVED");
    expect(classify([S("a", 0.97), S("b", 0.6)], "strict").tier).toBe("RESOLVED");
  });
  it("thresholds are stricter than normal", () => {
    expect(THRESHOLDS.strict.min).toBeGreaterThan(THRESHOLDS.normal.min);
    expect(THRESHOLDS.strict.gap).toBeGreaterThan(THRESHOLDS.normal.gap);
  });
});

describe("meetsStrict", () => {
  it("a human button tap always satisfies the strict bar", () => {
    expect(meetsStrict({ how: "USER_PICKED", score: 0.6, margin: 0 })).toBe(true);
  });
  it("an automatic resolution needs ≥ 0.97 and a margin ≥ 0.25", () => {
    expect(meetsStrict({ how: "AUTO", score: 0.97, margin: 0.25 })).toBe(true);
    expect(meetsStrict({ how: "AUTO", score: 0.96, margin: 0.9 })).toBe(false);
    expect(meetsStrict({ how: "AUTO", score: 1, margin: 0.2 })).toBe(false);
  });
});

describe("humanMentioned", () => {
  it("is true when the user's own message contains the candidate's name as whole tokens", () => {
    expect(humanMentioned("برای شرکت رضایی صنعت نامه بنویس", ["رضایی صنعت"])).toBe(true);
    expect(humanMentioned("رضائی صنعت", ["شرکت رضایی صنعت"])).toBe(true);
  });
  it("is false for a different candidate or a partial token", () => {
    expect(humanMentioned("برای رضایی نامه بنویس", ["رضایی صنعت"])).toBe(false);
    expect(humanMentioned("دومی", ["رضایی صنعت"])).toBe(false);
    expect(humanMentioned("رضایی", ["رضا"])).toBe(false);
    expect(humanMentioned(undefined, ["x"])).toBe(false);
  });
});
