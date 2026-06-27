import type { Rule } from "../engine/types.js";
import { nodeType, textOf, lineOf } from "../ast/walk.js";

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

// ─── MapGetWithoutNullCheck helpers ──────────────────────────────────────────

/**
 * Returns true if `text` contains `.get(...).<identifier>` where the closing
 * paren is found via balanced-paren matching (handles nested calls in the key).
 */
function hasInlineGetDereference(text: string): boolean {
  const lower = text.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < lower.length) {
    const getIdx = lower.indexOf('.get(', searchFrom);
    if (getIdx < 0) break;
    let depth = 1;
    let j = getIdx + 5;
    while (j < lower.length && depth > 0) {
      if (lower[j] === '(') depth++;
      else if (lower[j] === ')') depth--;
      j++;
    }
    if (depth === 0 && j < lower.length && lower[j] === '.' && j + 1 < lower.length && /[a-z]/i.test(lower[j + 1])) {
      return true;
    }
    searchFrom = getIdx + 1;
  }
  return false;
}

/** Extracts the map variable name — the last identifier before `.get(`. */
function extractMapName(text: string): string {
  const getIdx = text.toLowerCase().indexOf('.get(');
  if (getIdx < 0) return '';
  const before = text.slice(0, getIdx);
  const parts = before.split(/[^A-Za-z0-9_]/);
  return parts[parts.length - 1] ?? '';
}

/**
 * Returns true if node is inside a for-each loop whose iterable is
 * `<mapName>.keySet()` — meaning get(key) can never return null.
 */
function isInKeySetLoop(node: any, mapName: string): boolean {
  if (!mapName) return false;
  let p = node.parentCtx;
  while (p) {
    if (nodeType(p) === 'ForStatementContext') {
      const forText = textOf(p).toLowerCase();
      return forText.includes(mapName.toLowerCase() + '.keyset()');
    }
    p = p.parentCtx;
  }
  return false;
}

/**
 * Returns true if node is inside an if/while block whose condition contains
 * `<mapName>.containsKey(` — guaranteeing the get() result is non-null.
 */
function hasContainsKeyGuard(node: any, mapName: string): boolean {
  if (!mapName) return false;
  const needle = mapName.toLowerCase() + '.containskey(';
  let p = node.parentCtx;
  while (p) {
    const t = nodeType(p);
    if (t === 'IfStatementContext' || t === 'WhileStatementContext') {
      if (textOf(p).toLowerCase().includes(needle)) return true;
    }
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
    const reportedLines = new Set<number>();
    return {
      DotExpressionContext: (node) => {
        if (isInsideTestClass(node)) return;
        const text = textOf(node);
        // Exclude safe navigation (?.)
        if (text.includes("?.")) return;
        // Use balanced-paren matching instead of regex to avoid false positives
        // from nested method calls inside the .get() argument.
        if (!hasInlineGetDereference(text)) return;
        // Deduplicate: nested DotExpressionContext nodes fire for the same line.
        const line = lineOf(node);
        if (reportedLines.has(line)) return;
        const mapName = extractMapName(text);
        // keySet() iteration guarantees non-null get() results.
        if (isInKeySetLoop(node, mapName)) return;
        // containsKey() guard guarantees non-null get() results.
        if (hasContainsKeyGuard(node, mapName)) return;
        reportedLines.add(line);
        ctx.report(
          node,
          `Map.get() can return null — use ?. or assign to a variable and null-check before accessing '${text}'.`,
        );
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
