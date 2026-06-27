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
const STRING_ARRAY_FIELDS = ["rules", "disabledRules", "excludeRules", "categories", "metadataRoots", "excludePaths"] as const;
const SEVERITIES = ["critical", "high", "moderate", "low", "info"];

/** `cwd` and each of its ancestors up to the filesystem root. */
function ancestorDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(cwd);
  for (;;) {
    dirs.push(dir);
    const parent = dirname(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}

/** Validate the shape of a parsed config object; throw a clear error on mismatch. */
function validateConfig(raw: unknown, path: string): asserts raw is Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid config ${path}: expected a JSON object.`);
  }
  const r = raw as Record<string, unknown>;
  for (const f of STRING_ARRAY_FIELDS) {
    const v = r[f];
    if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === "string"))) {
      throw new Error(`Invalid config ${path}: "${f}" must be an array of strings.`);
    }
  }
  const so = r.severityOverrides;
  if (so !== undefined && (typeof so !== "object" || so === null || Array.isArray(so))) {
    throw new Error(`Invalid config ${path}: "severityOverrides" must be an object.`);
  }
  if (r.maxViolationsPerFile !== undefined && typeof r.maxViolationsPerFile !== "number") {
    throw new Error(`Invalid config ${path}: "maxViolationsPerFile" must be a number.`);
  }
  if (r.failOn !== undefined && (typeof r.failOn !== "string" || !SEVERITIES.includes(r.failOn))) {
    throw new Error(`Invalid config ${path}: "failOn" must be one of ${SEVERITIES.join(" | ")}.`);
  }
}

/**
 * Load config from:
 * 1. Explicit file path (--config flag)
 * 2. Nearest config file in cwd or an ancestor directory (project-scoped — never
 *    a config inside a scanned target dir, which could apply third-party rules).
 */
export function loadConfig(
  cwd: string,
  explicitFile?: string,
): { config: ApexLintConfig; path?: string } {
  const candidates = explicitFile
    ? [explicitFile]
    : ancestorDirs(cwd).flatMap((dir) => CONFIG_NAMES.map((n) => join(dir, n)));

  for (const p of candidates) {
    if (existsSync(p)) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(p, "utf8"));
      } catch (e) {
        throw new Error(`Failed to parse ${p}: ${(e as Error).message}`);
      }
      validateConfig(raw, p);
      const config: ApexLintConfig = {
        rules: raw.rules as string[] | undefined,
        disabledRules: (raw.disabledRules as string[]) ?? [],
        excludeRules: raw.excludeRules as string[] | undefined,
        categories: raw.categories as string[] | undefined,
        severityOverrides: (raw.severityOverrides as Record<string, Severity>) ?? {},
        metadataRoots: (raw.metadataRoots as string[]) ?? [],
        excludePaths: raw.excludePaths as string[] | undefined,
        maxViolationsPerFile: raw.maxViolationsPerFile as number | undefined,
        failOn: raw.failOn as Severity | undefined,
      };
      return { config, path: p };
    }
  }
  return { config: { ...DEFAULT_CONFIG } };
}
