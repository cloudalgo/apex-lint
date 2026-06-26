import type { Rule } from "../engine/types.js";
import { nodeType, textOf, isInsideLoop, walk } from "../ast/walk.js";

/**
 * Collect collection variable names populated from scope in a batch execute() method.
 * Handles the common pattern: for(T x : scope) { map.put(x.field, ...); }
 * Then a SOQL using :map.keySet() is still considered scope-bound.
 */
function collectScopeDerivedVars(methodNode: any, scopeParam: string): Set<string> {
  const derived = new Set<string>();
  const scopeLower = scopeParam.toLowerCase();
  walk(methodNode, (n) => {
    if (nodeType(n) !== "ForStatementContext") return;
    // Check only the ForControlContext child (the for-each header)
    for (let i = 0; i < (n.getChildCount?.() ?? 0); i++) {
      const child = n.getChild(i);
      if (nodeType(child) !== "ForControlContext") continue;
      if (!textOf(child).toLowerCase().includes(":" + scopeLower)) return;
      // This loop iterates over scope — collect collections assigned inside it
      walk(n, (inner) => {
        if (nodeType(inner) !== "DotExpressionContext") return;
        const m = textOf(inner).match(/^([A-Za-z][A-Za-z0-9_]*)\.(?:put|add|addAll)\(/);
        if (m) derived.add(m[1].toLowerCase());
      });
      break;
    }
  });
  return derived;
}

function getImplementsText(classNode: any): string {
  for (let i = 0; i < (classNode.getChildCount?.() ?? 0); i++) {
    const child = classNode.getChild(i);
    if (nodeType(child) === "TypeListContext") return textOf(child);
  }
  return "";
}

function getParamNames(methodNode: any): string[] {
  const names: string[] = [];
  try {
    const fp = methodNode.formalParameters?.();
    if (!fp) return names;
    // FormalParametersContext → ( FormalParameterListContext )
    for (let i = 0; i < (fp.getChildCount?.() ?? 0); i++) {
      const list = fp.getChild(i);
      if (nodeType(list) !== "FormalParameterListContext") continue;
      for (let j = 0; j < (list.getChildCount?.() ?? 0); j++) {
        const param = list.getChild(j);
        if (nodeType(param) !== "FormalParameterContext") continue;
        // FormalParameterContext: TypeRefContext ... IdContext(param name)
        // The LAST direct IdContext child is the param name (type ids are nested inside TypeRefContext)
        let paramName = "";
        for (let k = 0; k < (param.getChildCount?.() ?? 0); k++) {
          const child = param.getChild(k);
          if (nodeType(child) === "IdContext") paramName = textOf(child);
        }
        if (paramName) names.push(paramName);
      }
    }
  } catch {
    // ignore parse errors
  }
  return names;
}

/**
 * SOQL in batch execute() that is not bound to the scope parameter — this
 * re-queries data instead of processing the already-fetched scope list.
 * Fixes the batch-scope false positives from the regex-based scanner.
 */
export const soqlInBatchExecute: Rule = {
  id: "SoqlInBatchExecute",
  category: "performance",
  severity: "moderate",
  description: "SOQL in batch execute() should bind to the scope parameter, not query independent data.",
  create(ctx) {
    let inBatchableClass = false;
    let inBatchExecute = false;
    let scopeParamName = "";
    let scopeDerivedVars = new Set<string>();

    return {
      ClassDeclarationContext: (node) => {
        const implementsText = getImplementsText(node);
        inBatchableClass = implementsText.toLowerCase().includes("database.batchable");
        inBatchExecute = false;
        scopeParamName = "";
        scopeDerivedVars = new Set();
      },
      MethodDeclarationContext: (node) => {
        if (!inBatchableClass) return;
        inBatchExecute = false;
        scopeParamName = "";
        scopeDerivedVars = new Set();
        const name = node.id ? textOf(node.id()) : "";
        if (name !== "execute") return;
        const names = getParamNames(node);
        // execute(Database.BatchableContext bc, List<T> scope) — scope is param[1]
        scopeParamName = names[1] ?? "";
        inBatchExecute = scopeParamName.length > 0;
        if (inBatchExecute) {
          scopeDerivedVars = collectScopeDerivedVars(node, scopeParamName);
        }
      },
      QueryContext: (node) => {
        if (!inBatchExecute || !scopeParamName) return;
        const soqlText = textOf(node).toLowerCase();
        // Apex allows spaces around the bind colon: `IN : var` and `IN :var` are both valid.
        // Use a regex so both forms match.
        function bindMatches(varName: string): boolean {
          return new RegExp(":\\s*" + varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(soqlText);
        }
        // Direct bind: SOQL contains :scope
        if (bindMatches(scopeParamName.toLowerCase())) return;
        // Indirect bind: SOQL binds to a collection populated from scope
        for (const derived of scopeDerivedVars) {
          if (bindMatches(derived)) return;
        }
        ctx.report(
          node,
          `SOQL in batch execute() does not bind to scope parameter "${scopeParamName}" — this queries unrelated data instead of processing the passed scope list.`,
        );
      },
    };
  },
};

/** HTTP callout (new Http() or new HttpRequest()) inside a loop. */
export const httpCalloutInLoop: Rule = {
  id: "HttpCalloutInLoop",
  category: "performance",
  severity: "high",
  description: "HTTP callouts inside loops can exhaust governor limits; batch requests instead.",
  create(ctx) {
    return {
      NewExpressionContext: (node) => {
        const t = textOf(node).toLowerCase();
        if ((t.startsWith("newhttp(") || t.startsWith("newhttprequest(")) && isInsideLoop(node)) {
          ctx.report(node, "HTTP callout inside a loop — collect inputs and batch the request outside the loop.");
        }
      },
    };
  },
};

/** True when a class's TypeDeclarationContext parent has @IsTest. */
function classNodeIsTest(classNode: any): boolean {
  const typeDecl = classNode.parentCtx;
  if (!typeDecl) return false;
  for (let i = 0; i < (typeDecl.getChildCount?.() ?? 0); i++) {
    const mod = typeDecl.getChild(i);
    if (nodeType(mod) !== "ModifierContext") continue;
    for (let j = 0; j < (mod.getChildCount?.() ?? 0); j++) {
      const ann = mod.getChild(j);
      if (nodeType(ann) === "AnnotationContext" &&
          textOf(ann).replace(/^@/, "").split("(")[0].toLowerCase() === "istest") return true;
    }
  }
  return false;
}

/** Walk the parent chain to check if any enclosing class has @IsTest. */
function isInsideTestClass(node: any): boolean {
  let p = node?.parentCtx;
  while (p) {
    if (nodeType(p) === "ClassDeclarationContext" && classNodeIsTest(p)) return true;
    p = p.parentCtx;
  }
  return false;
}

/**
 * SOQL query with no WHERE clause — can scan all records and hit governor limits.
 * Skips @IsTest contexts: test data is controlled so unrestricted queries are safe.
 * PMD: AvoidNonRestrictiveQueries
 */
export const avoidNonRestrictiveQueries: Rule = {
  id: "AvoidNonRestrictiveQueries",
  category: "performance",
  severity: "low",
  description: "SOQL queries without a WHERE clause can scan all records and hit governor limits.",
  create(ctx) {
    return {
      QueryContext: (node) => {
        if (isInsideTestClass(node)) return;
        if (!textOf(node).toLowerCase().includes("where")) {
          ctx.report(node, "SOQL query has no WHERE clause — add filters or a LIMIT to avoid scanning all records.");
        }
      },
    };
  },
};

/** System.debug() inside a loop — clutters debug logs and wastes governor limits. */
export const systemDebugInLoop: Rule = {
  id: "SystemDebugInLoop",
  category: "performance",
  severity: "low",
  description: "System.debug() inside loops floods debug logs and consumes statement governor limits.",
  create(ctx) {
    return {
      // System.debug('x') parses as DotExpressionContext, not MethodCallExpressionContext
      DotExpressionContext: (node) => {
        if (textOf(node).toLowerCase().startsWith("system.debug(") && isInsideLoop(node)) {
          ctx.report(node, "System.debug() inside a loop — move it outside or use a conditional.");
        }
      },
    };
  },
};
