import { relative } from "node:path";
import type { Violation } from "@cloudalgo/apex-core";

const SEV_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  info: 4,
};

// ANSI without a dependency; disabled when not a TTY.
const useColor = process.stdout.isTTY;
const c = (code: string, s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const sevColor: Record<string, (s: string) => string> = {
  critical: (s) => c("31;1", s),
  high: (s) => c("31", s),
  moderate: (s) => c("33", s),
  low: (s) => c("36", s),
  info: (s) => c("90", s),
};

export function reportPretty(violations: Violation[], cwd: string): string {
  if (violations.length === 0) return c("32", "✓ No violations found.");

  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    const key = v.file ?? "<input>";
    (byFile.get(key) ?? byFile.set(key, []).get(key)!).push(v);
  }

  const lines: string[] = [];
  for (const [file, vs] of byFile) {
    lines.push("");
    lines.push(c("4", relative(cwd, file) || file));
    vs.sort(
      (a, b) => a.line - b.line || (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]),
    );
    for (const v of vs) {
      const loc = c("90", `${v.line}:${v.column}`.padEnd(7));
      const sev = (sevColor[v.severity] ?? ((s: string) => s))(v.severity.padEnd(8));
      const id = c("90", v.ruleId);
      lines.push(`  ${loc} ${sev} ${v.message}  ${id}`);
    }
  }

  const counts = countBySeverity(violations);
  lines.push("");
  lines.push(
    `${violations.length} problem${violations.length === 1 ? "" : "s"} ` +
      `(${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate, ${counts.low} low, ${counts.info} info)`,
  );
  return lines.join("\n");
}

export function reportJson(violations: Violation[]): string {
  return JSON.stringify(
    { violationCount: violations.length, violations },
    null,
    2,
  );
}

export function countBySeverity(violations: Violation[]) {
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const v of violations) counts[v.severity]++;
  return counts;
}
