import { walk, nodeType, textOf } from "../ast/walk.js";
import type {
  FormalParameterContext,
  VariableDeclaratorContext,
  LocalVariableDeclarationContext,
} from "../ast/contexts.js";

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
      if (nodeType(p) !== "FormalParameterContext") return;
      const fp2 = p as unknown as FormalParameterContext;
      if (fp2.id) names.push(textOf(fp2.id()));
    });
  }
  return names;
}

// A type carries injectable content only if it is (or contains a type argument
// of) String/Object. Matches `String`, `Object`, `List<String>`, `Set<Object>`,
// `Map<String,Account>`, etc.; rejects `Id`, numeric/temporal primitives, sObjects,
// and sObject collections — none of which can carry SOQL/HTML/URL syntax.
const INJECTABLE_TYPE = /(?:^|[<,])(?:string|object)(?:$|[>,])/;

/**
 * True if a value of this declared type can carry attacker-controlled string
 * content concatenable into a sink. Used to skip seeding non-injectable params
 * (e.g. `Id`, `Integer`, `List<Account>`) and non-injectable local declarations
 * (e.g. `Boolean b = (term == 'x')`), trimming safe-by-construction findings.
 */
export function isInjectableType(typeText: string): boolean {
  return INJECTABLE_TYPE.test(typeText.toLowerCase().replace(/\s+/g, ""));
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
  // Seed only entry-point params whose type can carry injectable content.
  if (entry) {
    const fp = methodNode?.formalParameters ? methodNode.formalParameters() : null;
    if (fp) {
      walk(fp, (p) => {
        if (nodeType(p) !== "FormalParameterContext") return;
        const fp2 = p as unknown as FormalParameterContext;
        if (!fp2.id || !fp2.typeRef) return;
        if (isInjectableType(textOf(fp2.typeRef()))) tainted.add(textOf(fp2.id()).toLowerCase());
      });
    }
  }

  // Collect assignment steps from the AST in document order (one walk, no text split).
  const steps: { name: string; rhs: string }[] = [];
  walk(methodNode, (n) => {
    const t = nodeType(n);
    if (t === "VariableDeclaratorContext") {
      const vd = n as unknown as VariableDeclaratorContext;
      if (!vd.id) return;
      // Skip declarations whose declared type cannot carry injectable content
      // (e.g. `Boolean b = (term == 'x')`, `Integer n = term.length()`).
      const ldecl = n.parentCtx?.parentCtx as unknown as LocalVariableDeclarationContext | undefined;
      const declType = ldecl?.typeRef ? textOf(ldecl.typeRef()) : "";
      if (declType && !isInjectableType(declType)) return;
      const name = textOf(vd.id()).toLowerCase();
      const full = textOf(n).toLowerCase();
      const eq = full.indexOf("=");
      if (eq >= 0) steps.push({ name, rhs: full.slice(eq + 1) });
    } else if (t === "AssignExpressionContext") {
      const lhs = textOf(n.getChild(0) as typeof n).toLowerCase();
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
