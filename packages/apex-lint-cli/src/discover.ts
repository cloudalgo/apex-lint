import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const APEX_EXT = new Set([".cls", ".trigger"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".sfdx", "dist"]);

/**
 * Compile a glob pattern into a RegExp.
 * Supports: * (any chars except /), ** (any path segments), ? (any single char).
 */
function compileGlob(pattern: string): RegExp {
  // Normalise separators so patterns work on Windows too
  const norm = pattern.replace(/\\/g, "/");
  let rx = "";
  let i = 0;
  while (i < norm.length) {
    const ch = norm[i];
    if (ch === "*" && norm[i + 1] === "*") {
      // ** — matches any path segment sequence (including empty)
      rx += ".*";
      i += 2;
      if (norm[i] === "/") i++; // consume trailing slash
    } else if (ch === "*") {
      rx += "[^/]*";
      i++;
    } else if (ch === "?") {
      rx += "[^/]";
      i++;
    } else {
      // Escape regex metacharacters
      rx += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(rx);
}

/**
 * Collect every .cls / .trigger file under the given paths.
 * Files matching any excludePatterns glob are omitted.
 */
export function discoverApexFiles(paths: string[], excludePatterns?: string[]): string[] {
  const compiled = (excludePatterns ?? []).map(compileGlob);
  const out: string[] = [];
  for (const p of paths) walk(p, out, compiled);
  return out.sort();
}

function isExcluded(p: string, patterns: RegExp[]): boolean {
  const norm = p.replace(/\\/g, "/");
  return patterns.some((rx) => rx.test(norm));
}

function walk(p: string, out: string[], excluded: RegExp[]): void {
  let st;
  try {
    st = statSync(p);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (APEX_EXT.has(extname(p)) && !isExcluded(p, excluded)) out.push(p);
    return;
  }
  if (!st.isDirectory()) return;
  for (const entry of readdirSync(p)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    walk(join(p, entry), out, excluded);
  }
}
