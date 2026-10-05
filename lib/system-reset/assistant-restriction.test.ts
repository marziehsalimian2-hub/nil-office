import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACTION_REGISTRY } from "@/lib/assistant/actions/registry";

/** The internal AI Assistant must never be able to execute (or even propose) a Factory Reset. */
describe("assistant cannot reset the system", () => {
  it("no action in the registry is a reset / wipe / purge", () => {
    for (const a of ACTION_REGISTRY) expect(a.name, a.name).not.toMatch(/RESET|WIPE|PURGE|TRUNCATE|FACTORY|CLEAN_START|DELETE_ALL/i);
  });

  it("no assistant source file calls the reset RPCs or imports the reset actions", () => {
    const root = join(process.cwd(), "lib", "assistant");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) {
          const src = readFileSync(p, "utf8");
          if (/system_reset|system-reset|factory_reset|executeReset|createResetDryRun/i.test(src)) hits.push(p);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });

  it("the reset server actions are not importable from the Telegram / assistant entry points", () => {
    for (const rel of ["app/api/telegram/webhook/route.ts", "app/api/telegram/external-webhook/route.ts"]) {
      let src = "";
      try { src = readFileSync(join(process.cwd(), rel), "utf8"); } catch { continue; }
      expect(src, rel).not.toMatch(/system-reset/);
    }
  });
});
