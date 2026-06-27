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
