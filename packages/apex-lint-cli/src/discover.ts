import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const APEX_EXT = new Set([".cls", ".trigger"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".sfdx", "dist"]);

/**
 * Collect every .cls / .trigger file under the given paths. A path may be a
 * single file or a directory (walked recursively).
 */
export function discoverApexFiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) walk(p, out);
  return out.sort();
}

function walk(p: string, out: string[]): void {
  let st;
  try {
    st = statSync(p);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (APEX_EXT.has(extname(p))) out.push(p);
    return;
  }
  if (!st.isDirectory()) return;
  for (const entry of readdirSync(p)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    walk(join(p, entry), out);
  }
}
