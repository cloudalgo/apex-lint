import { walk, nodeType, textOf } from "../ast/walk.js";

const ENTRY_MODIFIER = /^(public|global|webservice)$/;

/** True when the method's access modifiers make it externally reachable. */
export function isEntryPoint(methodNode: any): boolean {
  // Modifiers live on the enclosing ClassBodyDeclarationContext, two levels up:
  // MethodDeclarationContext -> MemberDeclarationContext -> ClassBodyDeclarationContext.
  const cbDecl = methodNode?.parentCtx?.parentCtx;
  for (let i = 0; i < (cbDecl?.getChildCount?.() ?? 0); i++) {
    const c = cbDecl.getChild(i);
    if (nodeType(c) === "ModifierContext" && ENTRY_MODIFIER.test(textOf(c).toLowerCase())) {
      return true;
    }
  }
  return false;
}

/** Formal parameter names of a method (original case). */
export function entryPointParamNames(methodNode: any): string[] {
  const names: string[] = [];
  const fp = methodNode?.formalParameters ? methodNode.formalParameters() : null;
  if (fp) {
    walk(fp, (p) => {
      if (nodeType(p) === "FormalParameterContext" && p.id) names.push(textOf(p.id()));
    });
  }
  return names;
}

export const TAINT_SOURCES = [
  "currentpage().getparameters().get(",
  "currentpage().getparameters()",
  "apexpages.currentpage().getparameters()",
  "system.currentpagereference().getparameters()",
  "restcontext.request.requestbody",
  "restcontext.request.params",
  "restcontext.request",
  "cookie.getvalue(",
  "url.getcurrentrequesturl(",
];

export const SOQL_SANITIZERS = ["string.escapesinglequotes(", "escapesinglequotes("];
export const XSS_SANITIZERS = ["string.escapehtml4(", "string.escapehtml3(", "encodingutil.htmlencode("];

/** Escape-aware string-literal stripper (handles Apex `\'`). */
export function stripStringLiterals(s: string): string {
  return s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** Whole-word reference test; both args already lowercased. */
export function hasWordRef(text: string, varName: string): boolean {
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(varName, pos);
    if (idx < 0) return false;
    const before = idx > 0 ? text[idx - 1] : "";
    const after = idx + varName.length < text.length ? text[idx + varName.length] : "";
    if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true;
    pos = idx + 1;
  }
  return false;
}

export interface TaintResult {
  tainted: Set<string>;
  isEntryPoint: boolean;
}

// node -> (sanitizer-key -> result). WeakMap so entries die with the parse tree.
const taintCache = new WeakMap<object, Map<string, TaintResult>>();

export function getTaint(methodNode: any, sanitizers: string[]): TaintResult {
  let perNode = taintCache.get(methodNode);
  if (!perNode) taintCache.set(methodNode, (perNode = new Map()));
  const key = sanitizers.join("|");
  let result = perNode.get(key);
  if (!result) perNode.set(key, (result = computeTaint(methodNode, sanitizers)));
  return result;
}

function computeTaint(methodNode: any, sanitizers: string[]): TaintResult {
  const tainted = new Set<string>();
  const entry = isEntryPoint(methodNode);
  if (entry) for (const p of entryPointParamNames(methodNode)) tainted.add(p.toLowerCase());

  // Collect assignment steps from the AST in document order (one walk, no text split).
  const steps: { name: string; rhs: string }[] = [];
  walk(methodNode, (n) => {
    const t = nodeType(n);
    if (t === "VariableDeclaratorContext" && n.id) {
      const name = textOf(n.id()).toLowerCase();
      const full = textOf(n).toLowerCase();
      const eq = full.indexOf("=");
      if (eq >= 0) steps.push({ name, rhs: full.slice(eq + 1) });
    } else if (t === "AssignExpressionContext") {
      const lhs = textOf(n.getChild(0)).toLowerCase();
      if (/^[a-z_][a-z0-9_]*$/.test(lhs)) {
        const full = textOf(n).toLowerCase();
        const eq = full.indexOf("=");
        if (eq >= 0) steps.push({ name: lhs, rhs: full.slice(eq + 1) });
      }
    }
  });

  const isTaintedRhs = (rhs: string): boolean => {
    if (sanitizers.some((s) => rhs.includes(s))) return false;
    if (TAINT_SOURCES.some((s) => rhs.includes(s))) return true;
    const stripped = stripStringLiterals(rhs);
    return [...tainted].some((v) => hasWordRef(stripped, v));
  };

  for (let guard = 0; guard < 10; guard++) {
    let changed = false;
    for (const s of steps) {
      if (tainted.has(s.name)) continue;
      if (isTaintedRhs(s.rhs)) {
        tainted.add(s.name);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { tainted, isEntryPoint: entry };
}
