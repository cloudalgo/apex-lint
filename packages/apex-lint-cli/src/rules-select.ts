import type { Rule } from "@cloudalgo/apex-core";
import type { ApexLintConfig } from "./config.js";

/** CLI rule-selection flags that override config. */
export interface RuleSelection {
  rules?: string[];
  excludeRules?: string[];
  categories?: string[];
}

/**
 * Filter and configure the rule set.
 * Priority: CLI flags > config file > defaults (all rules, all categories).
 * Pure over its inputs, so a worker can reconstruct the identical rule set from
 * `allRules` + the config + the CLI selection (Rule objects can't cross threads).
 */
export function selectRules(
  rules: Rule[],
  config: ApexLintConfig,
  cli: RuleSelection,
): Rule[] {
  const includeIds = cli.rules ?? config.rules;
  const includeSet = includeIds ? new Set(includeIds.map((s) => s.toLowerCase())) : null;
  const excludeIds = new Set<string>([
    ...config.disabledRules,
    ...(config.excludeRules ?? []),
    ...(cli.excludeRules ?? []),
  ]);
  const cats = cli.categories ?? config.categories;

  return rules
    .filter((r) => !excludeIds.has(r.id))
    // Opt-in rules run only when named explicitly in the include list.
    .filter((r) => !r.optIn || (includeSet?.has(r.id.toLowerCase()) ?? false))
    .filter((r) => !includeSet || includeSet.has(r.id.toLowerCase()))
    .filter((r) => !cats || cats.map((s) => s.toLowerCase()).includes(r.category.toLowerCase()))
    .map((r) => (config.severityOverrides[r.id] ? { ...r, severity: config.severityOverrides[r.id] } : r));
}
