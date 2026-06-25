import { resolve } from "node:path";
import {
  allRules,
  FilesystemMetadataProvider,
  NullMetadataProvider,
} from "@cloudalgo/apex-core";
import { parse, parseForESLint, visitorKeys } from "@cloudalgo/eslint-parser-apex";
import { toEslintRule } from "./adapter.js";

// ─── Metadata provider ────────────────────────────────────────────────────────
// Rules that need SObject names (UnguardedCrudOperation) read metadataRoot
// from the plugin's shared settings or fall back to cwd.

function makeMetadataGetter(settings?: Record<string, unknown>) {
  let cached: FilesystemMetadataProvider | NullMetadataProvider | null = null;
  return () => {
    if (cached) return cached;
    const root =
      (settings?.["apex/metadataRoot"] as string | undefined) ??
      (settings?.["apexMetadataRoot"] as string | undefined);
    cached = root
      ? new FilesystemMetadataProvider([resolve(root)])
      : new NullMetadataProvider();
    return cached;
  };
}

// ─── Rules ────────────────────────────────────────────────────────────────────

const rules: Record<string, any> = {};
for (const rule of allRules) {
  // Use a lazy metadata getter — we don't have ESLint context at module load time
  rules[rule.id] = toEslintRule(rule, makeMetadataGetter());
}

// ─── Parser re-export ─────────────────────────────────────────────────────────
// Including the parser in the plugin lets users configure with just the plugin.

const parser = { parse, parseForESLint, meta: { name: "@cloudalgo/eslint-parser-apex", version: "0.1.0" } };

// ─── Recommended rule config ──────────────────────────────────────────────────

const recommendedRules: Record<string, string> = {};
for (const rule of allRules) {
  const level =
    rule.severity === "critical" || rule.severity === "high" ? "error" : "warn";
  recommendedRules[`apex/${rule.id}`] = level;
}

// ─── Plugin export (legacy + flat config) ─────────────────────────────────────

const plugin = {
  meta: {
    name: "@cloudalgo/eslint-plugin-apex",
    version: "0.1.0",
  },

  /** The custom Apex parser — include in `parser:` for legacy config. */
  parser,

  rules,

  /**
   * Legacy eslintrc config (ESLint v8 and below):
   *   { "extends": ["plugin:apex/recommended"] }
   */
  configs: {
    recommended: {
      parser: "@cloudalgo/eslint-parser-apex",
      plugins: ["apex"],
      rules: recommendedRules,
    },
  },

  /**
   * Flat config objects (ESLint v9+):
   *   import apex from '@cloudalgo/eslint-plugin-apex';
   *   export default [ ...apex.flatConfigs.recommended ];
   */
  flatConfigs: {
    recommended: [
      {
        files: ["**/*.cls", "**/*.trigger"],
        languageOptions: {
          parser,
          parserOptions: { sourceType: "module" },
        },
        plugins: { apex: { rules } },
        rules: recommendedRules,
      },
    ] as const,
  },
};

export default plugin;
export { plugin, rules, parser, visitorKeys };
