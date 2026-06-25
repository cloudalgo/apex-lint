import type { Rule, RuleContext, Severity } from "@cloudalgo/apex-core";
import type { MetadataProvider } from "@cloudalgo/apex-core";

const SEV_TO_ESLINT: Record<Severity, "error" | "warn"> = {
  critical: "error",
  high: "error",
  moderate: "warn",
  low: "warn",
  info: "warn",
};

/**
 * Wrap one apex-core Rule into an ESLint Rule.
 *
 * Key design: ESLint traverses the converted ESTree (ApexNode with `body`
 * children), but our handlers need the original ANTLR context. The ESTree
 * nodes carry `_antlr`; we unwrap it before dispatching to rule handlers.
 * This lets all 15 rules run unchanged — they never know they're inside ESLint.
 */
export function toEslintRule(
  apexRule: Rule,
  getMetadata: () => MetadataProvider,
): any /* ESLint.Rule.RuleModule */ {
  return {
    meta: {
      type: "suggestion",
      docs: {
        description: apexRule.description,
        category: apexRule.category,
        recommended: true,
        url: `https://github.com/cloudalgo/apex-lint#${apexRule.id.toLowerCase()}`,
      },
      schema: [],
      messages: {
        apex: "{{ message }}",
      },
    },

    create(context: any) {
      const filename: string =
        context.getFilename?.() ?? context.filename ?? "";

      const ruleCtx: RuleContext = {
        filePath: filename,
        source: context.getSourceCode?.()?.getText?.() ?? "",
        metadata: getMetadata(),
        report(antlrNode: any, message: string) {
          const line: number = antlrNode?.start?.line ?? 1;
          const col: number = antlrNode?.start?.column ?? 0;
          context.report({
            // ESLint needs at least a loc or node; we use loc directly so
            // position comes from the ANTLR token, not the ESTree wrapper.
            loc: {
              start: { line, column: col },
              end: {
                line: antlrNode?.stop?.line ?? line,
                column:
                  (antlrNode?.stop?.column ?? col) +
                  (antlrNode?.stop?.text?.length ?? 1),
              },
            },
            messageId: "apex",
            data: { message },
          });
        },
      };

      // Our rule returns listeners keyed by ANTLR context type name.
      // ESLint dispatches by the node's `type` property — which we set to the
      // ANTLR constructor name in the parser. So the keys match directly.
      const apexListeners = apexRule.create(ruleCtx);
      const eslintListeners: Record<string, (esNode: any) => void> = {};

      for (const [nodeType, handler] of Object.entries(apexListeners)) {
        if (!handler) continue;
        eslintListeners[nodeType] = (esNode: any) => {
          // Unwrap the ANTLR context stored during parse
          const antlrNode = esNode._antlr ?? esNode;
          handler(antlrNode);
        };
      }

      return eslintListeners;
    },
  };
}
