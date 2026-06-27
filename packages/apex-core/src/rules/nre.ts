import type { Rule } from "../engine/types.js";
import { nodeType, textOf } from "../ast/walk.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function classHasIsTest(classNode: any): boolean {
  const typeDecl = classNode.parentCtx;
  if (!typeDecl) return false;
  for (let i = 0; i < (typeDecl.getChildCount?.() ?? 0); i++) {
    const child = typeDecl.getChild(i);
    if (nodeType(child) !== "ModifierContext") continue;
    for (let j = 0; j < (child.getChildCount?.() ?? 0); j++) {
      const ann = child.getChild(j);
      if (
        nodeType(ann) === "AnnotationContext" &&
        textOf(ann).replace(/^@/, "").split("(")[0].toLowerCase() === "istest"
      )
        return true;
    }
  }
  return false;
}

function isInsideTestClass(node: any): boolean {
  let p = node?.parentCtx;
  while (p) {
    if (nodeType(p) === "ClassDeclarationContext" && classHasIsTest(p)) return true;
    p = p.parentCtx;
  }
  return false;
}

// ─── MapGetWithoutNullCheck ───────────────────────────────────────────────────

/**
 * Detects inline Map.get() result dereference without null guard.
 * Pattern: expr.get(key).field  or  expr.get(key).method()
 * Safe: expr.get(key)?.field  or  Account a = expr.get(key); if (a != null) { a.field }
 */
export const mapGetWithoutNullCheck: Rule = {
  id: "MapGetWithoutNullCheck",
  category: "error-prone",
  severity: "moderate",
  description: "Map.get() returns null for missing keys — null-check the result or use ?. before accessing the property.",
  create(ctx) {
    return {
      DotExpressionContext: (node) => {
        if (isInsideTestClass(node)) return;
        const text = textOf(node);
        // Match: <anything>.get(<args>).<identifier>
        // Exclude: safe navigation (?.) which would appear as "?.field" in text
        if (/\.get\([^)]*\)\.[A-Za-z]/i.test(text) && !text.includes("?.")) {
          ctx.report(
            node,
            `Map.get() can return null — use ?. or assign to a variable and null-check before accessing '${text}'.`,
          );
        }
      },
    };
  },
};

// ─── SoqlResultIndexWithoutCheck ─────────────────────────────────────────────

/**
 * Detects inline SOQL result accessed by index without an isEmpty() guard.
 * Pattern: [SELECT ...][0]  or  [SELECT ...].get(0)
 * Safe:    List<Account> a = [SELECT ...]; if (!a.isEmpty()) { a[0]; }
 */
export const soqlResultIndexWithoutCheck: Rule = {
  id: "SoqlResultIndexWithoutCheck",
  category: "error-prone",
  severity: "moderate",
  description: "Inline SOQL result accessed by index — returns empty list if no records found, causing ListException or NRE.",
  create(ctx) {
    return {
      QueryContext: (node) => {
        if (isInsideTestClass(node)) return;

        // Walk up to find SoqlLiteralContext, then check if it's accessed by index
        let current = node.parentCtx;
        let soqlLiteral: any = null;

        // Find the SoqlLiteralContext (the [SELECT...] wrapper)
        while (current) {
          const type = nodeType(current);
          if (type === "SoqlLiteralContext") {
            soqlLiteral = current;
            break;
          }
          // Stop if we hit something that's not part of the chain
          if (type !== "SoqlPrimaryContext" && type !== "PrimaryExpressionContext") {
            return;
          }
          current = current.parentCtx;
        }

        if (!soqlLiteral) return;

        const soqlText = textOf(soqlLiteral);

        // Walk up from SoqlLiteralContext to find ArrayExpressionContext or DotExpressionContext
        current = soqlLiteral.parentCtx;
        while (current) {
          const type = nodeType(current);
          const currentText = textOf(current);
          const remainder = currentText.slice(soqlText.length);

          // ArrayExpressionContext: [SELECT...][index]
          if (type === "ArrayExpressionContext" && /^\[\d+\]/.test(remainder)) {
            ctx.report(
              node,
              "Inline SOQL result accessed by index — assign to a List first and check isEmpty() before accessing elements.",
            );
            return;
          }

          // DotExpressionContext: [SELECT...].get(index)
          if (type === "DotExpressionContext" && /^\.get\(\d+\)/.test(remainder)) {
            ctx.report(
              node,
              "Inline SOQL result accessed by index — assign to a List first and check isEmpty() before accessing elements.",
            );
            return;
          }

          // Stop if we've moved past the expression access chain
          if (type !== "SoqlPrimaryContext" && type !== "PrimaryExpressionContext" &&
              type !== "ArrayExpressionContext" && type !== "DotExpressionContext") {
            return;
          }

          current = current.parentCtx;
        }
      },
    };
  },
};
