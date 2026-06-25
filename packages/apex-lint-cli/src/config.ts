import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Severity } from "@cloudalgo/apex-core";

export interface ApexLintConfig {
  /** Rule ids to disable. */
  disabledRules: string[];
  /** Per-rule severity overrides, e.g. { "MethodNamingConventions": "info" }. */
  severityOverrides: Record<string, Severity>;
  /** sfdx project roots scanned for SObject metadata. Empty = auto-detect. */
  metadataRoots: string[];
}

export const DEFAULT_CONFIG: ApexLintConfig = {
  disabledRules: [],
  severityOverrides: {},
  metadataRoots: [],
};

const CONFIG_NAMES = ["apexlint.config.json", ".apexlintrc.json"];

/** Load config: explicit file if given, else the nearest known file at `cwd`. */
export function loadConfig(cwd: string, explicitFile?: string): { config: ApexLintConfig; path?: string } {
  const candidates = explicitFile ? [explicitFile] : CONFIG_NAMES.map((n) => join(cwd, n));
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const parsed = JSON.parse(readFileSync(p, "utf8"));
        return {
          config: {
            disabledRules: parsed.disabledRules ?? [],
            severityOverrides: parsed.severityOverrides ?? {},
            metadataRoots: parsed.metadataRoots ?? [],
          },
          path: p,
        };
      } catch (e) {
        throw new Error(`Failed to parse ${p}: ${(e as Error).message}`);
      }
    }
  }
  return { config: { ...DEFAULT_CONFIG } };
}
