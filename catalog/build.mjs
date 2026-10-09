// NIL Office catalog — build: HTML/CSS -> PDF (Chromium; Persian + RTL; fonts embedded automatically as subsets)
// usage: node catalog/build.mjs [print|share]   (default: print)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] === "share" ? "share" : "print";
const assets = mode === "share" ? "../assets-share" : "../assets";
const out = path.join(here, "output", mode === "share" ? "NIL-Office-Catalog-Share.pdf" : "NIL-Office-Catalog-Print.pdf");

const sub = (s) => s.replaceAll("{{A}}", assets);
const html = sub(fs.readFileSync(path.join(here, "src", "catalog.html"), "utf8")).replace('href="catalog.css"', `href="_${mode}.css"`);
fs.writeFileSync(path.join(here, "src", `_${mode}.html`), html);
fs.writeFileSync(path.join(here, "src", `_${mode}.css`), sub(fs.readFileSync(path.join(here, "src", "catalog.css"), "utf8")));

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, "src", `_${mode}.html`)).href, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const info = await page.evaluate(() => ({
    pages: document.querySelectorAll(".page").length,
    fontOk: document.fonts.check('700 12px "Vazirmatn"'),
    // any page whose content overflows its box, or any element sticking out of its page
    overflow: [...document.querySelectorAll(".page")].flatMap((p) => {
      const pr = p.getBoundingClientRect(), bad = [];
      p.querySelectorAll(".inner").forEach((n) => { if (n.scrollHeight > n.clientHeight + 1) bad.push(`${p.id}: inner overflows by ${n.scrollHeight - n.clientHeight}px`); });
      p.querySelectorAll("*").forEach((n) => {
        if (n.closest(".cover") || n.classList.contains("ghost") || n.tagName === "IMG" && n.alt === "") return;
        const r = n.getBoundingClientRect();
        if (r.width && (r.right > pr.right + 1 || r.left < pr.left - 1 || r.bottom > pr.bottom + 1)) bad.push(`${p.id}: <${n.tagName.toLowerCase()} class="${n.className}"> sticks out`);
      });
      return bad;
    }),
  }));
  console.log(JSON.stringify(info, null, 1));
  await page.pdf({ path: out, width: "210mm", height: "297mm", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  console.log("wrote", out, (fs.statSync(out).size / 1024 / 1024).toFixed(2) + " MB");
} finally {
  await browser.close();
}
