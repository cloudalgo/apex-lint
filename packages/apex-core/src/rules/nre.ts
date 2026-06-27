import type { Rule } from "../engine/types.js";
import { nodeType, textOf, lineOf, walk } from "../ast/walk.js";

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

// ─── ChainedRelationshipAccess ────────────────────────────────────────────────

/**
 * Known Salesforce sObject relationship field names that commonly appear
 * as intermediate hops in cross-object traversals. Used to distinguish
 * sObject chains from arbitrary method chains.
 */
const SOBJECT_RELATIONSHIP_FIELDS = new Set([
  "owner", "account", "contact", "lead", "opportunity", "case", "campaign",
  "asset", "createdby", "lastmodifiedby", "manager", "reportsto", "parent",
  "userrole", "profile", "recordtype", "masterrecord", "user",
]);

/** System namespaces whose multi-level chains are NOT sObject traversals. */
const SYSTEM_NAMESPACES = new Set([
  "system", "schema", "database", "test", "math", "json", "limits",
  "userinfo", "url", "crypto", "datetime", "date", "integer", "string",
  "boolean", "decimal", "long", "double",
]);

/**
 * Detects multi-level sObject property chains that traverse relationships
 * without null guards. Each hop may be null if the relationship field was
 * not included in the SOQL SELECT clause.
 *
 * Fires only on pure property chains (no method calls, no array access) that
 * contain a known Salesforce relationship field as an intermediate segment.
 * Severity: info — not every chain is an NRE risk (query may always return data).
 */
export const chainedRelationshipAccess: Rule = {
  id: "ChainedRelationshipAccess",
  category: "error-prone",
  severity: "info",
  description: "Multi-level sObject relationship chain — each hop may be null if the relationship was not queried. Use ?. or add null guards.",
  create(ctx) {
    const reportedLines = new Set<number>();
    return {
      DotExpressionContext: (node) => {
        if (isInsideTestClass(node)) return;
        const text = textOf(node);

        // Exclude if contains method calls or array access (not a pure property chain)
        if (text.includes("(") || text.includes("[")) return;
        // Exclude if uses safe navigation
        if (text.includes("?.")) return;

        const parts = text.split(".");
        // Need at least 3 parts (a.b.c) for a multi-level chain
        if (parts.length < 3) return;

        // Exclude known system namespaces (Schema.X.Y, System.X.Y, etc.)
        if (SYSTEM_NAMESPACES.has(parts[0].toLowerCase())) return;

        // Only flag if an intermediate segment (not last) is a known sObject relationship
        const intermediate = parts.slice(0, -1); // all but last
        const hasRelationship = intermediate.some(p =>
          SOBJECT_RELATIONSHIP_FIELDS.has(p.toLowerCase())
        );
        if (!hasRelationship) return;

        // Deduplicate: nested DotExpressionContext nodes fire for the same line
        const line = lineOf(node);
        if (reportedLines.has(line)) return;
        reportedLines.add(line);

        ctx.report(
          node,
          `Multi-level sObject chain '${text}' — use ?. for each relationship hop or verify the field was queried.`,
        );
      },
    };
  },
};

// ─── SoqlResultNotNullChecked ─────────────────────────────────────────────────

/**
 * Detects sObject variable assigned from a LIMIT 1 SOQL query and subsequently
 * accessed without an intervening null check. LIMIT 1 returns null (not empty list)
 * when assigned to an sObject type — so field access without a null check is a NRE.
 *
 * Detection is intra-method using source line analysis. Suppressed when:
 * - The access uses safe navigation (?.)
 * - A null check for that variable precedes the access in source
 */
export const soqlResultNotNullChecked: Rule = {
  id: "SoqlResultNotNullChecked",
  category: "error-prone",
  severity: "moderate",
  description: "Variable assigned from LIMIT 1 SOQL may be null — access without null check is an NRE risk.",
  create(ctx) {
    // Map: variable name (lowercase) → 1-based line number of the assignment
    const soqlVars = new Map<string, number>();
    const sourceLines = ctx.source.split("\n");
    // Tracks (varName:line) pairs already reported to avoid duplicate violations
    // from nested DotExpressionContext nodes.
    const reportedVarLines = new Set<string>();

    return {
      MethodDeclarationContext: (_node) => {
        // Clear per-method to avoid inter-method false positives.
        soqlVars.clear();
        reportedVarLines.clear();
      },

      VariableDeclaratorContext: (node) => {
        if (isInsideTestClass(node)) return;
        // Check whether the initializer contains a QueryContext with LIMIT 1.
        const expr = node.expression ? node.expression() : null;
        if (!expr) return;
        let hasLimitOneQuery = false;
        walk(expr, (child) => {
          if (nodeType(child) === "QueryContext") {
            // textOf strips whitespace: "LIMIT1" is what we look for.
            if (textOf(child).toLowerCase().includes("limit1")) hasLimitOneQuery = true;
          }
        });
        if (!hasLimitOneQuery) return;

        // Skip if the variable is a List type — SOQL always returns a non-null list.
        const localDecl = node.parentCtx?.parentCtx;
        if (localDecl && nodeType(localDecl) === "LocalVariableDeclarationContext") {
          if (textOf(localDecl).toLowerCase().startsWith("list<")) return;
        }

        // Extract the declared variable name via node.id().
        const idNode = node.id ? node.id() : null;
        const varName = idNode ? textOf(idNode) : "";
        if (!varName) return;

        const line = node.start?.line ?? 0;
        soqlVars.set(varName.toLowerCase(), line);
      },

      DotExpressionContext: (node) => {
        if (isInsideTestClass(node)) return;
        if (soqlVars.size === 0) return;
        const text = textOf(node);
        const textLower = text.toLowerCase();

        for (const [varName, assignLine] of soqlVars) {
          // Must start with varName. (field access or method call)
          if (!textLower.startsWith(varName + ".")) continue;
          // Safe navigation (?.) means developer already guards — no flag.
          if (text.includes("?.")) continue;

          const accessLine = node.start?.line ?? 0;
          // Look for a null check for this variable in the source lines
          // between the assignment and the current access (exclusive of both).
          const between = sourceLines.slice(assignLine, accessLine).join("\n").toLowerCase();
          const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const guardPattern = new RegExp(
            `(?:${escaped}\\s*!=\\s*null|null\\s*!=\\s*${escaped}|${escaped}\\s*==\\s*null|null\\s*==\\s*${escaped})`,
          );
          if (guardPattern.test(between)) continue;

          // Deduplicate: nested DotExpressionContext nodes can fire for the same variable+line.
          const key = `${varName}:${accessLine}`;
          if (reportedVarLines.has(key)) continue;
          reportedVarLines.add(key);

          ctx.report(
            node,
            `'${varName}' was assigned from a LIMIT 1 SOQL query and may be null — add a null check or use ?.`,
          );
          // Only report once per variable per access site.
          break;
        }
      },
    };
  },
};

// ─── MapGetResultNotNullChecked ───────────────────────────────────────────────

/**
 * Detects sObject variable assigned from Map.get() and subsequently accessed
 * without a null check. Map.get() returns null for missing keys, making any
 * field access on the result an NRE risk.
 *
 * Identifies the pattern by checking if the variable initializer text contains
 * `.get(` (after whitespace stripping). Suppressed when: safe navigation used,
 * null check or containsKey guard precedes the access.
 */
export const mapGetResultNotNullChecked: Rule = {
  id: "MapGetResultNotNullChecked",
  category: "error-prone",
  severity: "moderate",
  description: "Variable assigned from Map.get() may be null — access without null check is an NRE risk.",
  create(ctx) {
    // Map: variable name (lowercase) → 1-based line number of the assignment
    const mapGetVars = new Map<string, number>();
    const sourceLines = ctx.source.split("\n");
    // Tracks (varName:line) pairs already reported to avoid duplicate violations.
    const reportedVarLines = new Set<string>();

    return {
      MethodDeclarationContext: (_node) => {
        // Clear per-method to avoid inter-method false positives.
        mapGetVars.clear();
        reportedVarLines.clear();
      },

      VariableDeclaratorContext: (node) => {
        if (isInsideTestClass(node)) return;
        const expr = node.expression ? node.expression() : null;
        if (!expr) return;

        const exprText = textOf(expr).toLowerCase();
        // Must contain .get( to be a candidate
        if (!exprText.includes(".get(")) return;
        // Exclude `this.get()` / `super.get()` — instance methods named get, not Map.get()
        if (exprText.includes("this.get(") || exprText.includes("super.get(")) return;
        // Exclude common non-Map .get() patterns (Schema describe methods, etc.)
        if (
          exprText.includes(".getdescribe(") ||
          exprText.includes(".getsobjecttype(") ||
          exprText.includes(".getglobaldescribe(") ||
          exprText.includes(".getchildrelationships(") ||
          exprText.includes(".getpicklistvalues(") ||
          exprText.includes(".getmap(")
        ) return;

        const idNode = node.id ? node.id() : null;
        const varName = idNode ? textOf(idNode) : "";
        if (!varName) return;

        const line = node.start?.line ?? 0;
        mapGetVars.set(varName.toLowerCase(), line);
      },

      DotExpressionContext: (node) => {
        if (isInsideTestClass(node)) return;
        if (mapGetVars.size === 0) return;
        const text = textOf(node);
        const textLower = text.toLowerCase();

        for (const [varName, assignLine] of mapGetVars) {
          // Must start with varName. (field access or method call)
          if (!textLower.startsWith(varName + ".")) continue;
          // Safe navigation (?.) means developer already guards — no flag.
          if (text.includes("?.")) continue;

          const accessLine = node.start?.line ?? 0;
          // Look for a null check or containsKey guard between assignment and access.
          const between = sourceLines.slice(assignLine, accessLine).join("\n").toLowerCase();
          const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const guardPattern = new RegExp(
            `(?:${escaped}\\s*!=\\s*null|null\\s*!=\\s*${escaped}|${escaped}\\s*==\\s*null|null\\s*==\\s*${escaped})`,
          );
          if (guardPattern.test(between)) continue;
          // containsKey() guard means the developer verified the key exists.
          if (between.includes(".containskey(")) continue;

          // Deduplicate: nested DotExpressionContext nodes can fire for the same variable+line.
          const key = `${varName}:${accessLine}`;
          if (reportedVarLines.has(key)) continue;
          reportedVarLines.add(key);

          ctx.report(
            node,
            `'${varName}' was assigned from Map.get() and may be null — add a null check or use ?.`,
          );
          break;
        }
      },
    };
  },
};

// ─── TriggerContextNullAccess ─────────────────────────────────────────────────

/**
 * Detects Trigger.old/Trigger.new access when guaranteed to be null.
 * Trigger.old is null on INSERT events. Trigger.new is null on DELETE events.
 * Only flags when the trigger header declares exclusively insert or exclusively
 * delete events — zero false positives.
 */
export const triggerContextNullAccess: Rule = {
  id: "TriggerContextNullAccess",
  category: "error-prone",
  severity: "moderate",
  description: "Trigger.old is null on INSERT triggers; Trigger.new is null on DELETE triggers.",
  create(ctx) {
    if (!ctx.filePath.endsWith(".trigger")) return {};

    // Parse event list from trigger header: "trigger X on Y (before insert, after update)"
    const headerMatch = ctx.source.toLowerCase().match(
      /trigger\s+\w+\s+on\s+\w+\s*\(([^)]+)\)/,
    );
    if (!headerMatch) return {};
    const events = headerMatch[1];

    const hasInsert = /\binsert\b/.test(events);
    const hasUpdate = /\bupdate\b/.test(events);
    const hasDelete = /\bdelete\b/.test(events);
    const hasUndelete = /\bundelete\b/.test(events);

    // Insert-only: Trigger.old is ALWAYS null
    const insertOnly = hasInsert && !hasUpdate && !hasDelete && !hasUndelete;
    // Delete-only: Trigger.new is ALWAYS null (undelete restores records → Trigger.new has values)
    const deleteOnly = hasDelete && !hasInsert && !hasUpdate && !hasUndelete;

    if (!insertOnly && !deleteOnly) return {};

    return {
      DotExpressionContext: (node) => {
        const text = textOf(node).toLowerCase();
        if (insertOnly && text.startsWith("trigger.old")) {
          ctx.report(
            node,
            "Trigger.old is null on INSERT events — this trigger is INSERT-only, so Trigger.old will always be null here.",
          );
        }
        if (deleteOnly && text.startsWith("trigger.new")) {
          ctx.report(
            node,
            "Trigger.new is null on DELETE events — this trigger is DELETE-only, so Trigger.new will always be null here.",
          );
        }
      },
    };
  },
};
