import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import jsQR from "jsqr";
import sharp from "sharp";
import { generateVerifyToken, hashVerifyToken, sha256Hex } from "./token";
import { buildVerifyUrl, isSha256Hex, isWellFormedToken, shortHash, VERIFY_TOKEN_RE } from "./format";
import { computePlate, layoutSchema, plateFitsPage, plateTopMm, MIN_PLATE_WIDTH_MM } from "./layout";
import { qrPng } from "./qr";
import { publicRows, PUBLIC_PROJECTION_KEYS } from "./display";
import { clientIp, rateKey } from "./public";
import { VERIFY_DOCUMENT_TYPES, verifiedPdfPath, type VerifyLayout } from "./types";

const DEFAULTS: Record<string, VerifyLayout> = {
  OUTGOING_CORRESPONDENCE: { page: "LAST", x_mm: 20, y_mm: 8, size_mm: 24, show_label: true, show_code: true, label_text: "استعلام اصالت سند — NIL Verify" },
  PROFORMA: { page: "LAST", x_mm: 18, y_mm: 10, size_mm: 22, show_label: true, show_code: true, label_text: "استعلام اصالت سند — NIL Verify" },
  INVOICE: { page: "LAST", x_mm: 18, y_mm: 10, size_mm: 22, show_label: true, show_code: true, label_text: "استعلام اصالت سند — NIL Verify" },
  CONTRACT: { page: "LAST", x_mm: 20, y_mm: 10, size_mm: 22, show_label: true, show_code: true, label_text: "استعلام اصالت سند — NIL Verify" },
};

describe("public token", () => {
  it("is 256-bit random, base64url, never repeats, and only its SHA-256 is derived for storage", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generateVerifyToken();
      expect(VERIFY_TOKEN_RE.test(t)).toBe(true);
      expect(t).toHaveLength(43);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
    const t = generateVerifyToken();
    expect(hashVerifyToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashVerifyToken(t)).not.toContain(t);
  });
  it("SHA-256 is the real algorithm (known vector)", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(new Uint8Array([97, 98, 99]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("rejects anything that is not exactly 43 base64url characters (enumeration / junk never reaches the database)", () => {
    for (const bad of ["1", "2", "3", "", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "=", "A".repeat(42) + "!", "../../etc/passwd", "A".repeat(43) + "\n", null, undefined, 12345]) {
      expect(isWellFormedToken(bad as never), String(bad)).toBe(false);
    }
    expect(isWellFormedToken("A".repeat(43))).toBe(true);
    expect(isWellFormedToken("-_".repeat(21) + "A")).toBe(true);
  });
  it("hash helpers", () => {
    expect(isSha256Hex("a".repeat(64))).toBe(true);
    expect(isSha256Hex("A".repeat(64))).toBe(true);
    expect(isSha256Hex("g".repeat(64))).toBe(false);
    expect(isSha256Hex("a".repeat(63))).toBe(false);
    expect(shortHash("abcdef1234567890", 6)).toBe("abcdef");
    expect(shortHash(null)).toBe("—");
  });
});

describe("verification URL (the ONLY content of the QR)", () => {
  const token = "A".repeat(43);
  it("builds <origin>/verify/<token> and nothing else", () => {
    expect(buildVerifyUrl("https://office.example.com", token)).toBe(`https://office.example.com/verify/${token}`);
    expect(buildVerifyUrl("https://office.example.com///", token)).toBe(`https://office.example.com/verify/${token}`);
    expect(buildVerifyUrl("http://localhost:3000", token)).toBe(`http://localhost:3000/verify/${token}`);
  });
  it("refuses a missing, plain-http (non-local), path/query or malformed base — a broken QR must never be activated", () => {
    for (const bad of [undefined, null, "", "not a url", "http://office.example.com", "https://office.example.com/app", "https://office.example.com/?x=1", "ftp://x.com"]) {
      expect(() => buildVerifyUrl(bad as never, token), String(bad)).toThrow("VERIFY_BASE_URL_MISSING");
    }
    expect(() => buildVerifyUrl("https://office.example.com", "short")).toThrow("VERIFY_TOKEN_INVALID");
  });
  it("the stored file path is derived from the verification id only", () => {
    expect(verifiedPdfPath("11111111-1111-1111-1111-111111111111")).toBe("verified/11111111-1111-1111-1111-111111111111.pdf");
  });
});

describe("QR image", () => {
  const url = `https://office.example.com/verify/${generateVerifyToken()}`;
  it("decodes (jsQR) to exactly the URL — scannable", async () => {
    const png = await qrPng(url);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    expect(r?.data).toBe(url);
  });
  it("still decodes at the printed size / on a noisy background after scaling down", async () => {
    const png = await qrPng(url);
    const small = await sharp(png).resize(180, 180, { kernel: "nearest" }).flatten({ background: "#ffffff" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(jsQR(new Uint8ClampedArray(small.data), small.info.width, small.info.height)?.data).toBe(url);
  });
  it("refuses to encode anything that is not a verification URL (no ids, amounts, signed storage URLs, secrets)", async () => {
    for (const bad of ["https://x.com/storage/v1/object/sign/nil-files/a.pdf?token=abc", "550e8400-e29b-41d4-a716-446655440000", "amount=1000000", "https://x.com/verify/short", ""]) {
      await expect(qrPng(bad), bad).rejects.toThrow("VERIFY_QR_URL_INVALID");
    }
  });
});

describe("layout", () => {
  it("every default layout fits an A4 page, and its plate stays inside the renderer's bottom margin", () => {
    for (const t of VERIFY_DOCUMENT_TYPES) {
      const l = DEFAULTS[t];
      expect(plateFitsPage(l), t).toBe(true);
      // letters keep today's 48 mm footer zone; invoices/contracts get a reserved margin = plate top + 4 mm (issue.ts)
      const reserve = Math.ceil(plateTopMm(l) + 4);
      expect(reserve, t).toBeGreaterThan(plateTopMm(l));
      if (t === "OUTGOING_CORRESPONDENCE") expect(plateTopMm(l)).toBeLessThanOrEqual(48);
    }
  });
  it("the card is at least wide enough for the label and the QR is centred on it", () => {
    const g = computePlate(DEFAULTS.INVOICE);
    expect(g.plate.w).toBeGreaterThanOrEqual((MIN_PLATE_WIDTH_MM * 595.28) / 210 - 0.01);
    expect(g.qr.x - g.plate.x).toBeCloseTo(g.plate.x + g.plate.w - (g.qr.x + g.qr.size), 5);
    expect(g.text).not.toBeNull();
    expect(g.textLines).toBe(2);
  });
  it("a plate hanging off the page is refused", () => {
    expect(plateFitsPage({ ...DEFAULTS.INVOICE, x_mm: 190 })).toBe(false);
    expect(plateFitsPage({ ...DEFAULTS.INVOICE, y_mm: 280 })).toBe(false);
  });
  it("the schema enforces ranges and rejects extra fields", () => {
    const ok = { ...DEFAULTS.INVOICE };
    expect(layoutSchema.safeParse(ok).success).toBe(true);
    expect(layoutSchema.safeParse({ ...ok, size_mm: 10 }).success).toBe(false);
    expect(layoutSchema.safeParse({ ...ok, size_mm: 80 }).success).toBe(false);
    expect(layoutSchema.safeParse({ ...ok, x_mm: -1 }).success).toBe(false);
    expect(layoutSchema.safeParse({ ...ok, page: "MIDDLE" }).success).toBe(false);
    expect(layoutSchema.safeParse({ ...ok, label_text: "" }).success).toBe(false);
    expect(layoutSchema.safeParse({ ...ok, evil: 1 }).success).toBe(false);
  });
  it("without label and code there is no text area", () => {
    expect(computePlate({ ...DEFAULTS.INVOICE, show_label: false, show_code: false }).text).toBeNull();
  });
});

describe("public disclosure (deny by default, second allow-list on the page)", () => {
  it("shows only the allowed fields per type and ignores everything else", () => {
    const rows = publicRows("INVOICE", {
      customer: "شرکت نمونه", issue_date: "2026-10-05", currency: "IRR", total_amount: "12500000.0000",
      internal_notes: "SECRET", bank_account: "IR000", created_by: "uuid-1", case_id: "uuid-2", items: [{ d: "x" }], attachments: ["a.pdf"],
    });
    const text = JSON.stringify(rows);
    expect(rows.map((r) => r.label)).toEqual(["مشتری", "تاریخ صدور سند", "مبلغ کل"]);
    for (const leak of ["SECRET", "IR000", "uuid-1", "uuid-2", "a.pdf"]) expect(text).not.toContain(leak);
  });
  it("a contract amount is shown only when the snapshot carries it", () => {
    const base = { counterparty: "طرف قرارداد", contract_date: "2026-10-01" };
    expect(publicRows("CONTRACT", base).map((r) => r.label)).toEqual(["طرف قرارداد", "تاریخ قرارداد"]);
    expect(publicRows("CONTRACT", { ...base, total_amount: "900000", currency: "IRR" }).map((r) => r.label)).toContain("مبلغ قرارداد");
  });
  it("letters show recipient and subject only; proformas add the validity date", () => {
    expect(publicRows("OUTGOING_CORRESPONDENCE", { recipient: "الف", subject: "ب", internal_case: "X" }).map((r) => r.label)).toEqual(["گیرنده", "موضوع"]);
    expect(publicRows("PROFORMA", { customer: "ج", valid_until: "2026-11-01", total_amount: "1", currency: "USD" }).map((r) => r.label)).toContain("معتبر تا");
  });
  it("copes with null / hostile metadata", () => {
    expect(publicRows("INVOICE", null)).toEqual([]);
    expect(publicRows("INVOICE", { customer: 5, issue_date: {}, total_amount: "abc" } as never)).toEqual([]);
  });
  it("the public projection has no id, path, hash or reason key", () => {
    for (const k of PUBLIC_PROJECTION_KEYS) expect(/(^|_)(id|path|hash|reason|storage|token)($|_)/.test(k), k).toBe(false);
  });
});

describe("public access helpers", () => {
  it("takes the address the proxy appended (last X-Forwarded-For entry), never the spoofable first one", () => {
    const h = (m: Record<string, string>) => ({ get: (n: string) => m[n.toLowerCase()] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(h({ "x-real-ip": "5.5.5.5" }))).toBe("5.5.5.5");
    expect(clientIp(h({}))).toBe("unknown");
  });
  it("the rate-limit key is a daily-rotating hash that never contains the IP", () => {
    const k1 = rateKey("203.0.113.9", new Date("2026-10-05T10:00:00Z"), "secret");
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    expect(k1).not.toContain("203");
    expect(rateKey("203.0.113.9", new Date("2026-10-05T23:00:00Z"), "secret")).toBe(k1);
    expect(rateKey("203.0.113.9", new Date("2026-10-06T01:00:00Z"), "secret")).not.toBe(k1);
    expect(rateKey("203.0.113.10", new Date("2026-10-05T10:00:00Z"), "secret")).not.toBe(k1);
  });
});

describe("migration 0143 (static guards)", () => {
  const raw = readFileSync(join(process.cwd(), "supabase", "migrations", "0143_nil_verify.sql"), "utf8");
  const sql = raw.replace(/--[^\n]*/g, "");

  it("the raw token is never stored: only a hash column, no plain token column", () => {
    expect(sql).toMatch(/token_hash\s+text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).not.toMatch(/\btoken\s+text\b/);
  });
  it("RLS on every new table, no policies, no browser grants on tables", () => {
    for (const t of ["verification_settings", "verification_doc_types", "document_verifications", "verification_rate_limits"]) {
      expect(sql).toContain(`alter table public.${t}`);
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on public\.verification_settings[\s\S]*?from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete)[^;]*\sto\s+(anon|authenticated)/i);
  });
  it("public lookup / hash check / rate check are service_role ONLY; admin and issuance RPCs are not granted to anon", () => {
    const serviceOnly = sql.match(/foreach f in array array\[\s*([^\]]*)\]\s*loop\s*execute format\('revoke all on function public\.%s from public, anon, authenticated'/);
    expect(serviceOnly?.[1]).toContain("verify_public_lookup(text)");
    expect(serviceOnly?.[1]).toContain("verify_public_hash_check(text,text)");
    expect(serviceOnly?.[1]).toContain("verify_rate_check(text,text,integer,integer)");
    expect(sql).toMatch(/revoke all on function public\.%s from public, anon'/);
  });
  it("revoke / supersede / settings are ADMIN only and need a reason", () => {
    for (const fn of ["verify_revoke", "verify_supersede", "verify_update_settings", "verify_update_doc_type", "verify_get_settings", "verify_list_active"]) {
      const body = sql.slice(sql.indexOf(`function public.${fn}(`));
      expect(body.slice(0, 700), fn).toContain("is_admin()");
    }
    expect(sql.slice(sql.indexOf("function public.verify_revoke(")).slice(0, 900)).toContain("REASON_REQUIRED");
  });
  it("one live verification per document, enforced by the database", () => {
    expect(sql).toMatch(/create unique index if not exists uq_document_verification_live on public\.document_verifications \(document_type, document_id\) where status in \('PENDING', 'ACTIVE'\)/);
  });
  it("ACTIVE needs the file evidence; a revoked record can never be deleted or rewritten", () => {
    expect(sql).toContain("ck_verification_active_evidence");
    expect(sql).toContain("VERIFY_NO_DELETE");
    expect(sql).toContain("VERIFY_FIELD_IMMUTABLE");
  });
  it("the public snapshot is an explicit allow-list: no internal ids, notes, bank, items or attachments", () => {
    const snap = sql.slice(sql.indexOf("function public._verify_snapshot("), sql.indexOf("function public._verify_new_code("));
    for (const forbidden of ["internal_notes", "bank_account", "created_by", "case_id", "responsible_user", "description", "payment_terms", "notes", "sales_document_items", "attachments", "customer_national_id", "customer_phone"]) {
      expect(snap, forbidden).not.toContain(forbidden);
    }
    for (const allowed of ["'recipient'", "'subject'", "'customer'", "'issue_date'", "'valid_until'", "'currency'", "'total_amount'", "'counterparty'", "'contract_date'"]) {
      expect(snap, allowed).toContain(allowed);
    }
    expect(snap).toMatch(/if v_s\.show_contract_amount then/);
  });
  it("a cancelled document auto-revokes; no UPDATE/DELETE without WHERE (Supabase pg-safeupdate)", () => {
    expect(sql).toContain("tg_verification_autorevoke");
    for (const t of ["correspondence", "sales_documents", "contracts"]) expect(sql).toMatch(new RegExp(`trg_verification_autorevoke on public\\.${t}`));
    const bare: string[] = [];
    for (const m of sql.matchAll(/(^|[\s;(])(update\s+public\.\w+(?:\s+\w+)?\s+set|delete\s+from\s+public\.\w+)\s[^;]*;/gi)) {
      if (!/\swhere\s/i.test(m[0])) bare.push(m[0].trim().slice(0, 100));
    }
    expect(bare).toEqual([]);
  });
  it("Factory Reset: tables classified, verified/ is a DELETE storage prefix, the classifier knows registered verified paths", () => {
    expect(sql).toMatch(/'document_verifications',\s+'verify',\s+'DELETE'/);
    expect(sql).toMatch(/'verification_settings',\s+'verify',\s+'PRESERVE'/);
    expect(sql).toMatch(/'verified\/', 'DELETE'/);
    expect(sql).toContain("union select x.pdf_storage_path from public.document_verifications x");
  });
});
