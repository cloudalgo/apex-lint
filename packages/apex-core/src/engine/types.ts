import type { MetadataProvider } from "../metadata/provider.js";

export type Severity = "critical" | "high" | "moderate" | "low" | "info";

export type Category =
  | "performance"
  | "security"
  | "error-prone"
  | "best-practices"
  | "code-style"
  | "design"
  | "documentation";

/** A single finding. `file` is filled in by the engine, not the rule. */
export interface Violation {
  ruleId: string;
  message: string;
  severity: Severity;
  category: Category;
  line: number;
  column: number;
  endLine?: number;
  file?: string;
}

/**
 * Everything a rule needs at runtime. The `metadata` provider is the seam that
 * lets the same rule run against a live org (jsforce) or an sfdx project on
 * disk (filesystem) without the rule knowing which.
 */
export interface RuleContext {
  filePath: string;
  source: string;
  metadata: MetadataProvider;
  /** Rules call this to emit a finding; severity/category default from the rule. */
  report(node: any, message: string, overrides?: Partial<Violation>): void;
}

/**
 * A rule returns a listener: an object keyed by parse-tree context type name
 * (e.g. "QueryContext", "DeleteStatementContext"). The engine does ONE walk and
 * dispatches each node to the matching handlers. This is the ESLint model —
 * cheap to add rules, and traversal cost is shared across all of them.
 */
export type RuleListener = Record<string, ((node: any) => void) | undefined>;

export interface Rule {
  /** Stable identifier, PascalCase, e.g. "SoqlInLoop". Used in configs/suppressions. */
  id: string;
  category: Category;
  severity: Severity;
  /** One-line human description shown in `--list-rules` and reports. */
  description: string;
  /**
   * Set to true for rules that consult `ctx.metadata`. The CLI can warn when a
   * type-aware rule runs with a null provider (no org / no project metadata).
   */
  needsMetadata?: boolean;
  create(ctx: RuleContext): RuleListener;
}
