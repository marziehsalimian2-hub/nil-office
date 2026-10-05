/**
 * Storage cleanup helpers. The LIST of objects to delete is produced by the database (system_reset_storage_items, built from the
 * server-side classification before any record disappears) — the browser never supplies a path. These helpers are a second,
 * independent safety net applied to every path right before it is removed.
 */
export const STORAGE_BUCKET = "nil-files";

/** Branding and signatures live here: never removable by a reset, whatever any list says. */
export const STORAGE_PRESERVE_PREFIXES = ["settings/", "signatures/"] as const;

export function isSafeStoragePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  if (path.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) return false;
  return true;
}

export function isPreservedStoragePath(path: string): boolean {
  return STORAGE_PRESERVE_PREFIXES.some((p) => path.startsWith(p));
}

/** Splits a server-provided list into the paths that may be removed and the ones refused by the safety net. */
export function splitRemovable(paths: string[]): { removable: string[]; refused: string[] } {
  const removable: string[] = [];
  const refused: string[] = [];
  for (const p of paths) (isSafeStoragePath(p) && !isPreservedStoragePath(p) ? removable : refused).push(p);
  return { removable, refused };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
