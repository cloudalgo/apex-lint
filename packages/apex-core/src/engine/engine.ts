import { parseApex } from "../ast/parser.js";
import {
  lineOf,
  columnOf,
  endLineOf,
  nodeType,
  walk,
} from "../ast/walk.js";
import type { Rule, RuleContext, Violation } from "./types.js";
import { NullMetadataProvider, type MetadataProvider } from "../metadata/provider.js";
import { buildSuppressions } from "./suppression.js";

export interface LintOptions {
  filePath?: string;
  metadata?: MetadataProvider;
  /** Rule ids to disable for this run. */
  disabled?: Set<string>;
}

/** Object form accepted by lint() — source code plus options in one bag. */
export interface LintFile extends LintOptions {
  source: string;
}

export interface LintResult {
  filePath: string;
  violations: Violation[];
  suppressedCount: number;
  syntaxErrors: { line: number; column: number; message: string }[];
}

/**
 * The engine. Construct once with a rule set, then lint many files. One
 * tree-walk per file dispatches every enabled rule's listeners — adding rules
 * does not add traversals.
 */
export class Linter {
  constructor(private readonly rules: Rule[]) {}

  lint(sourceOrFile: string | LintFile, opts: LintOptions = {}): LintResult {
    const source = typeof sourceOrFile === "string" ? sourceOrFile : sourceOrFile.source;
    const merged = typeof sourceOrFile === "string" ? opts : sourceOrFile;
    const filePath = merged.filePath ?? "<input>";
    const metadata = merged.metadata ?? new NullMetadataProvider();
    const disabled = merged.disabled ?? new Set<string>();
    const violations: Violation[] = [];

    const { tree, syntaxErrors } = parseApex(source);

    const active = this.rules.filter((r) => !disabled.has(r.id));

    // Build one listener per rule, sharing a context that reports into `violations`.
    const bound = active.map((rule) => {
      const ctx: RuleContext = {
        filePath,
        source,
        metadata,
        report: (node, message, overrides) => {
          violations.push({
            ruleId: rule.id,
            message,
            severity: overrides?.severity ?? rule.severity,
            category: overrides?.category ?? rule.category,
            line: overrides?.line ?? lineOf(node),
            column: overrides?.column ?? columnOf(node),
            endLine: overrides?.endLine ?? endLineOf(node),
            file: filePath,
          });
        },
      };
      return { rule, listener: rule.create(ctx) };
    });

    walk(tree, (node) => {
      const t = nodeType(node);
      for (const { listener } of bound) {
        const handler = listener[t];
        if (handler) handler(node);
      }
    });

    const suppressions = buildSuppressions(source, tree);
    const finalViolations = violations.filter(
      (v) =>
        !suppressions.some(
          (s) =>
            v.line >= s.startLine &&
            v.line <= s.endLine &&
            (s.ruleId === null || s.ruleId === v.ruleId),
        ),
    );
    finalViolations.sort((a, b) => a.line - b.line || a.column - b.column);
    return {
      filePath,
      violations: finalViolations,
      suppressedCount: violations.length - finalViolations.length,
      syntaxErrors,
    };
  }
}
