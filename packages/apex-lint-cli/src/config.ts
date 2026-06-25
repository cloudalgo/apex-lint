import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Severity } from "@cloudalgo/apex-core";

export interface ApexLintConfig {
  /**
   * If set, ONLY these rule IDs run. All other rules are skipped.
   * CLI flag --rules takes precedence over this field.
   * Example: ["SoqlInLoop", "ApexSOQLInjection"]
   */
  rules?: string[];

  /**
   * Rule IDs to disable. Merged with --exclude-rules CLI flag.
   * @deprecated Use excludeRules instead; both are accepted.
   */
  disabledRules: string[];

  /**
   * Rule IDs to disable. Preferred name for disabledRules.
   * Example: ["MethodNamingConventions", "AvoidGlobalModifier"]
   */
  excludeRules?: string[];

  /**
   * If set, only run rules in these categories.
   * CLI flag --categories takes precedence.
   * Valid values: security | performance | error-prone | design | best-practices | code-style
   */
  categories?: string[];

  /**
   * Per-rule severity overrides.
   * Example: { "EmptyCatchBlock": "critical", "AvoidGlobalModifier": "info" }
   */
  severityOverrides: Record<string, Severity>;

  /** sfdx project roots scanned for SObject metadata. Empty = auto-detect. */
  metadataRoots: string[];

  /**
   * File glob patterns to exclude from scanning. Matched against full file path.
   * Supports * (any chars except /), ** (any path segments), ? (any single char).
   * Example: ["**\/test\/**", "**\/*Test.cls", "**\/legacy\/**"]
   */
  excludePaths?: string[];

  /**
   * Stop after this many violations per file (default: unlimited).
   * Useful in large codebases to keep initial reports manageable.
   */
  maxViolationsPerFile?: number;

  /**
   * Minimum severity that causes a non-zero exit code.
   * CLI flag --fail-on takes precedence.
   * Default: "moderate"
   */
  failOn?: Severity;
}

export const DEFAULT_CONFIG: ApexLintConfig = {
  disabledRules: [],
  severityOverrides: {},
  metadataRoots: [],
};

const CONFIG_NAMES = ["apexlint.config.json", ".apexlintrc.json"];

/**
 * Load config from:
 * 1. Explicit file path (--config flag)
 * 2. Config file in cwd
 * 3. Config file in the directory of each scan path (first match wins)
 */
export function loadConfig(
  cwd: string,
  explicitFile?: string,
  scanPaths?: string[],
): { config: ApexLintConfig; path?: string } {
  const searchDirs = [cwd];
  for (const p of scanPaths ?? []) {
    const d = resolve(p);
    const dir = existsSync(d) && !d.endsWith(".cls") && !d.endsWith(".trigger") ? d : dirname(d);
    if (!searchDirs.includes(dir)) searchDirs.push(dir);
  }

  const candidates = explicitFile
    ? [explicitFile]
    : searchDirs.flatMap((dir) => CONFIG_NAMES.map((n) => join(dir, n)));

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf8"));
        const config: ApexLintConfig = {
          rules: raw.rules,
          disabledRules: raw.disabledRules ?? [],
          excludeRules: raw.excludeRules,
          categories: raw.categories,
          severityOverrides: raw.severityOverrides ?? {},
          metadataRoots: raw.metadataRoots ?? [],
          excludePaths: raw.excludePaths,
          maxViolationsPerFile: raw.maxViolationsPerFile,
          failOn: raw.failOn,
        };
        return { config, path: p };
      } catch (e) {
        throw new Error(`Failed to parse ${p}: ${(e as Error).message}`);
      }
    }
  }
  return { config: { ...DEFAULT_CONFIG } };
}
