import QRCode from "qrcode";

/**
 * QR image for a verification URL. Error-correction level M (15 %): robust for print and for a small plate on a letterhead without making
 * the symbol dense. The content is ONLY the public URL — never an id, amount, storage URL or secret (the caller passes nothing else).
 */
export async function qrPng(url: string): Promise<Uint8Array> {
  if (!/^https?:\/\/[^\s]+\/verify\/[A-Za-z0-9_-]{43}$/.test(url)) throw new Error("VERIFY_QR_URL_INVALID");
  const buf = await QRCode.toBuffer(url, {
    errorCorrectionLevel: "M",
    margin: 1,                // 1 module here + the white card around it
    scale: 14,                // crisp when the PNG is scaled to ~22 mm
    type: "png",
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  return new Uint8Array(buf);
}
