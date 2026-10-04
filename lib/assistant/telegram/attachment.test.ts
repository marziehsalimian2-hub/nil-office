import { describe, it, expect } from "vitest";
import { detectTelegramAttachment, MAX_TELEGRAM_ATTACHMENT_BYTES } from "./attachment";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("detectTelegramAttachment (type from magic bytes, never from the declared MIME)", () => {
  it("recognises PDF, JPEG, PNG, GIF and WebP", () => {
    expect(detectTelegramAttachment(bytes(0x25, 0x50, 0x44, 0x46))).toMatchObject({ ok: true, kind: "document", mediaType: "application/pdf", ext: "pdf" });
    expect(detectTelegramAttachment(bytes(0xff, 0xd8, 0xff, 0xe0))).toMatchObject({ ok: true, kind: "image", mediaType: "image/jpeg", ext: "jpg" });
    expect(detectTelegramAttachment(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toMatchObject({ ok: true, mediaType: "image/png", ext: "png" });
    expect(detectTelegramAttachment(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toMatchObject({ ok: true, mediaType: "image/gif", ext: "gif" });
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0]);
    expect(detectTelegramAttachment(webp)).toMatchObject({ ok: true, mediaType: "image/webp", ext: "webp" });
  });

  it("a PNG is reported as PNG (it used to be archived as «jpg»)", () => {
    const r = detectTelegramAttachment(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
    expect(r.ok && r.mediaType).toBe("image/png");
  });

  it("rejects executables, scripts, archives and Office files renamed to look like images", () => {
    expect(detectTelegramAttachment(bytes(0x4d, 0x5a, 0x90, 0x00)).ok).toBe(false);       // Windows PE "MZ"
    expect(detectTelegramAttachment(new TextEncoder().encode("<script>alert(1)</script>")).ok).toBe(false);
    expect(detectTelegramAttachment(bytes(0x50, 0x4b, 0x03, 0x04)).ok).toBe(false);       // ZIP / DOCX
    expect(detectTelegramAttachment(bytes(0x7f, 0x45, 0x4c, 0x46)).ok).toBe(false);       // ELF
  });

  it("rejects RIFF files that are not WebP (e.g. WAV)", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45, 0, 0]);
    expect(detectTelegramAttachment(wav).ok).toBe(false);
  });

  it("rejects empty and oversized files", () => {
    expect(detectTelegramAttachment(new Uint8Array(0)).ok).toBe(false);
    const big = new Uint8Array(MAX_TELEGRAM_ATTACHMENT_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46]);
    const r = detectTelegramAttachment(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("حجم");
  });
});
