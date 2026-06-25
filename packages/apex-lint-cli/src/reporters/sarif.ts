import { pathToFileURL } from "node:url";
import { relative } from "node:path";
import type { Rule, Violation } from "@cloudalgo/apex-core";

// SARIF severity is one of error | warning | note. Map our scale onto it.
const SARIF_LEVEL: Record<string, "error" | "warning" | "note"> = {
  critical: "error",
  high: "error",
  moderate: "warning",
  low: "note",
  info: "note",
};

/**
 * Emit SARIF 2.1.0. GitHub's code-scanning upload (and many CI dashboards)
 * consume this directly, so violations show up as inline PR annotations.
 */
export function reportSarif(
  violations: Violation[],
  rules: Rule[],
  cwd: string,
): string {
  const ruleIndex = new Map<string, number>();
  const sarifRules = rules.map((r, i) => {
    ruleIndex.set(r.id, i);
    return {
      id: r.id,
      name: r.id,
      shortDescription: { text: r.description },
      defaultConfiguration: { level: SARIF_LEVEL[r.severity] },
      properties: { category: r.category, severity: r.severity },
    };
  });

  const results = violations.map((v) => ({
    ruleId: v.ruleId,
    ruleIndex: ruleIndex.get(v.ruleId) ?? 0,
    level: SARIF_LEVEL[v.severity],
    message: { text: v.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: toUri(v.file ?? "<input>", cwd),
          },
          region: {
            startLine: v.line || 1,
            startColumn: (v.column ?? 0) + 1,
            ...(v.endLine ? { endLine: v.endLine } : {}),
          },
        },
      },
    ],
  }));

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "apex-lint",
            informationUri: "https://github.com/cloudalgo/apex-lint",
            version: "0.1.0",
            rules: sarifRules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

function toUri(file: string, cwd: string): string {
  if (file === "<input>") return file;
  const rel = relative(cwd, file);
  // Prefer a repo-relative POSIX path; fall back to a file URL if outside cwd.
  if (!rel.startsWith("..")) return rel.split("\\").join("/");
  return pathToFileURL(file).toString();
}
