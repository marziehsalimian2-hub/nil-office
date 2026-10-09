// Exports the catalog's own infographics (diagrams, flows, timelines) as standalone PNGs into catalog/assets/graphics.
// usage: node catalog/export-graphics.mjs   (run after `node catalog/build.mjs print` so src/_print.html exists)
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "assets", "graphics");
fs.mkdirSync(out, { recursive: true });

const targets = [
  ["architecture-hub", "#p5 .hub"],
  ["islands-problem", "#p3 .isl"],
  ["security-layers", "#p14 .layers"],
  ["letter-lifecycle", "#p6 .flow"],
  ["accounting-flow", "#p7 .flow"],
  ["contract-lifecycle", "#p8 .flow"],
  ["invoice-to-cash-flow", "#p9 .flow"],
  ["service-ledger-flow", "#p12 .flow"],
  ["service-traceability", "#p12 .trace"],
  ["payroll-flow", "#p11 .flow"],
  ["assistant-flow", "#p13 .flow"],
  ["module-grid", "#p4 .chipgrid"],
  ["kpi-strip", "#p4 .kpis"],
  ["scenario-opportunity-to-cash", "#p15 .scen", 0],
  ["scenario-timesheet-to-payslip", "#p15 .scen", 1],
  ["scenario-telegram-to-letter", "#p15 .scen", 2],
  ["scenario-board-to-minutes", "#p15 .scen", 3],
  ["deployment-phases", "#p18 .phases"],
  ["board-phases", "#pb1 .phasebar"],
  ["board-meeting-lifecycle", "#pb1 .flow"],
  ["board-followup-flow", "#pb2 .flow", 0],
  ["board-assistant-flow", "#pb2 .flow", 1],
  ["value-matrix", "#p16 .matrix"],
];

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 3 });
  await page.goto(pathToFileURL(path.join(here, "src", "_print.html")).href, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  for (const [name, sel, idx = 0] of targets) {
    const el = (await page.$$(sel))[idx];
    if (!el) { console.log("MISSING", name, sel); continue; }
    await el.screenshot({ path: path.join(out, `${name}.png`) });
    console.log("ok", name);
  }
} finally {
  await browser.close();
}
