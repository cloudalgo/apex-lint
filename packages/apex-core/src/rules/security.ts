import type { Rule } from "../engine/types.js";
import { nodeType, textOf, walk } from "../ast/walk.js";

// ─── Intra-method taint analysis (PMD approach) ──────────────────────────────

/**
 * Known user-controlled taint sources in Apex.
 * All patterns are lowercased for matching against textOf() output.
 */
const TAINT_SOURCES = [
  "currentpage().getparameters().get(",     // VF page parameters
  "currentpage().getparameters()",           // all VF parameters
  "apexpages.currentpage().getparameters()", // explicit namespace
  "system.currentpagereference().getparameters()",
  "restcontext.request.requestbody",         // REST API body
  "restcontext.request.params",              // REST API query params
  "restcontext.request",                     // REST context broadly
  "cookie.getvalue(",                        // cookie values
  "url.getcurrentrequesturl(",               // current URL
];

/** Sanitizers that remove SOQL taint. */
const SOQL_SANITIZERS = [
  "string.escapesinglequotes(",
  "escapesinglequotes(",
];

/**
 * True if `varName` appears as a whole word (not as a substring of a longer
 * identifier) in `text`. Both are expected to be already lowercased.
 */
function hasWordRef(text: string, varName: string): boolean {
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

/**
 * Remove single-quoted string literal contents so that field names or
 * column references inside a SOQL string don't shadow tainted variable names,
 * and so that :bind occurrences inside the literal aren't matched either.
 * e.g. `query + ' WHERE Id = :id'` → `query + ''`
 */
function stripStringLiterals(s: string): string {
  return s.replace(/'[^']*'/g, "''");
}

/**
 * Intra-method taint analysis — PMD-style forward propagation.
 *
 * Two-phase per iteration:
 *   1. AST walk for VariableDeclaratorContext nodes (handles `Type x = expr`)
 *      — extracts variable name from `.id()` so no type-prefix confusion
 *   2. Text scan (textOf split by `;`) for re-assignments (`x = expr`)
 *      — handles reassignment to already-declared variables
 *
 * Iterates to fixed point (≤5 passes) to handle chained assignments
 * (a = source; b = a; c = b → all three become tainted).
 */
function buildTaintedVars(
  methodNode: any,
  sources: string[],
  sanitizers: string[],
): Set<string> {
  const tainted = new Set<string>();

  function isTaintedRhs(rhs: string): boolean {
    if (sanitizers.some(s => rhs.includes(s))) return false; // sanitizer applied
    if (sources.some(s => rhs.includes(s))) return true;
    return [...tainted].some(v => hasWordRef(rhs, v));
  }

  for (let pass = 0; pass < 5; pass++) {
    const sizeBefore = tainted.size;

    // Phase 1 — AST: local variable declarations (`Type varName = expr`)
    // VariableDeclaratorContext.id() gives the exact variable name without the type prefix
    walk(methodNode, (n) => {
      if (nodeType(n) !== "VariableDeclaratorContext" || !(n as any).id) return;
      const name = textOf((n as any).id()).toLowerCase();
      if (tainted.has(name)) return;
      const full = textOf(n).toLowerCase();
      const eqIdx = full.indexOf("=");
      if (eqIdx < 0) return;
      const init = full.substring(eqIdx + 1);
      if (isTaintedRhs(init)) tainted.add(name);
    });

    // Phase 2 — Text: re-assignments to existing vars (`varName = newExpr`)
    // Split the full method text by ';' for rough statement boundaries.
    // We only accept LHS that is a PURE identifier (no dots/brackets) to avoid
    // incorrectly treating `obj.field = x` as tainting a local var named `field`.
    const methodText = textOf(methodNode).toLowerCase();
    for (const stmt of methodText.split(";")) {
      const eqIdx = stmt.indexOf("=");
      if (eqIdx <= 0) continue;
      const pre = stmt[eqIdx - 1];
      const post = eqIdx + 1 < stmt.length ? stmt[eqIdx + 1] : "";
      // Skip ==, !=, <=, >=, +=, -=, *=, /=, &=, |=, ^=
      if (post === "=" || "!<>+-*/%&|^".includes(pre)) continue;
      const lhs = stmt.substring(0, eqIdx);
      if (lhs.includes(".") || lhs.includes("[")) continue; // field/index access
      const varMatch = lhs.match(/^([a-z_][a-z0-9_]*)$/);
      if (!varMatch) continue; // not a bare identifier
      const varName = varMatch[1];
      if (tainted.has(varName)) continue;
      const rhs = stmt.substring(eqIdx + 1);
      if (isTaintedRhs(rhs)) tainted.add(varName);
    }

    if (tainted.size === sizeBefore) break; // fixed point
  }

  return tainted;
}

// ─── ApexSharingViolations helpers ───────────────────────────────────────────

const DML_CONTEXT_TYPES = new Set([
  "QueryContext",
  "InsertStatementContext",
  "UpdateStatementContext",
  "DeleteStatementContext",
  "UpsertStatementContext",
  "UndeleteStatementContext",
]);

function getClassName(classNode: any): string {
  const id = classNode.id ? classNode.id() : null;
  return id ? textOf(id) : "Unknown";
}

/** TypeDeclarationContext parent of a ClassDeclarationContext holds its modifiers. */
function typeHasSharing(classNode: any): boolean {
  const typeDecl = classNode.parentCtx;
  if (!typeDecl) return false;
  for (let i = 0; i < (typeDecl.getChildCount?.() ?? 0); i++) {
    const child = typeDecl.getChild(i);
    if (nodeType(child) !== "ModifierContext") continue;
    if (textOf(child).toLowerCase().includes("sharing")) return true;
    // Also skip @IsTest classes — they run in system context and don't need sharing
    for (let j = 0; j < (child.getChildCount?.() ?? 0); j++) {
      const ann = child.getChild(j);
      if (nodeType(ann) === "AnnotationContext" &&
          textOf(ann).replace(/^@/, "").split("(")[0].toLowerCase() === "istest") return true;
    }
  }
  return false;
}

/** Walk the class body for DML/SOQL, skipping nested inner class bodies. */
function classHasDmlOrSoql(classNode: any): boolean {
  let found = false;
  function dfs(n: any): void {
    if (found) return;
    if (DML_CONTEXT_TYPES.has(nodeType(n))) { found = true; return; }
    const count = n.getChildCount?.() ?? 0;
    for (let i = 0; i < count; i++) {
      const child = n.getChild(i);
      if (!child?.constructor?.name?.endsWith("Context")) continue;
      // Skip nested inner classes — their sharing is their own responsibility
      if (n !== classNode && nodeType(child) === "ClassDeclarationContext") continue;
      dfs(child);
    }
  }
  dfs(classNode);
  return found;
}

/**
 * Database.query() with a non-literal argument — SOQL injection risk.
 * A static string literal is safe; a variable or expression is flagged.
 *
 * System.debug() and Database.query() both parse as DotExpressionContext
 * in apex-parser v5. We check textOf on the outer expression.
 */
/**
 * Class performs SOQL/DML but has no sharing declaration.
 * Classes without explicit "with sharing"/"without sharing"/"inherited sharing"
 * run in system context and ignore record-level visibility rules.
 * PMD: ApexSharingViolations
 */
/**
 * Crypto.* call using a weak/broken algorithm (MD5, SHA-1, DES) or a hardcoded
 * string as a key/IV. Use SHA-256, AES-256-CBC with a random IV, or HMAC-SHA256.
 * PMD: ApexBadCrypto
 */
export const apexBadCrypto: Rule = {
  id: "ApexBadCrypto",
  category: "security",
  severity: "high",
  description: "Weak or insecure cryptographic algorithm detected in Crypto.* call.",
  create(ctx) {
    const WEAK = ["'md5'", "'sha1'", "'sha-1'", "'md2'", "'des'", "'3des'", "'rc4'",
                  "'hmacmd5'", "'hmacsha1'"];
    return {
      DotExpressionContext: (node) => {
        const t = textOf(node).toLowerCase();
        if (!t.startsWith("crypto.") && !t.startsWith("system.crypto.")) return;
        for (const algo of WEAK) {
          if (t.includes(algo)) {
            ctx.report(node, `Insecure algorithm ${algo.toUpperCase()} in Crypto.* call — use SHA-256, AES-256, or HMAC-SHA256 instead.`);
            return;
          }
        }
      },
    };
  },
};

/**
 * DML in a constructor can cause CSRF-like side effects in Visualforce — the
 * constructor runs on every GET page load including navigation, not just form POST.
 * PMD: ApexCSRF
 */
export const apexCsrf: Rule = {
  id: "ApexCSRF",
  category: "security",
  severity: "moderate",
  description: "DML in a constructor may execute on GET requests and cause unintended side effects.",
  create(ctx) {
    return {
      ConstructorDeclarationContext: (node) => {
        let hasDml = false;
        // Use a walk that stops at nested class declarations
        function dfs(n: any): void {
          if (hasDml) return;
          const t = nodeType(n);
          if (
            t === "InsertStatementContext" || t === "UpdateStatementContext" ||
            t === "DeleteStatementContext" || t === "UpsertStatementContext" ||
            t === "UndeleteStatementContext"
          ) {
            hasDml = true;
            return;
          }
          const count = n.getChildCount?.() ?? 0;
          for (let i = 0; i < count; i++) {
            const child = n.getChild(i);
            if (child?.constructor?.name?.endsWith("Context") && nodeType(child) !== "ClassDeclarationContext") {
              dfs(child);
            }
          }
        }
        dfs(node);
        if (hasDml) {
          ctx.report(node, "DML in constructor executes on GET requests — move DML to an action method called explicitly by the user.");
        }
      },
    };
  },
};

export const apexSharingViolations: Rule = {
  id: "ApexSharingViolations",
  category: "security",
  severity: "high",
  description: "Classes that perform SOQL/DML should declare sharing rules explicitly.",
  create(ctx) {
    return {
      ClassDeclarationContext: (node) => {
        if (typeHasSharing(node)) return;
        if (!classHasDmlOrSoql(node)) return;
        ctx.report(
          node,
          `Class "${getClassName(node)}" performs SOQL/DML but has no sharing declaration — add "with sharing", "without sharing", or "inherited sharing".`,
        );
      },
    };
  },
};

/**
 * User-controlled data flows into Database.query() — SOQL injection.
 *
 * Uses PMD-style intra-method taint analysis:
 *   1. Seeds tainted variables from known sources (VF params, REST request body, cookies).
 *   2. Propagates taint through variable assignments until fixed point.
 *   3. Flags Database.query() / Database.queryWithBinds() whose argument references
 *      a tainted variable.
 *
 * Sanitizer: String.escapeSingleQuotes() removes taint on the result.
 * PMD: ApexSOQLInjection
 */
export const apexSOQLInjection: Rule = {
  id: "ApexSOQLInjection",
  category: "security",
  severity: "critical",
  description: "User-controlled data flows into Database.query() — SOQL injection risk.",
  create(ctx) {
    function check(methodNode: any): void {
      const tainted = buildTaintedVars(methodNode, TAINT_SOURCES, SOQL_SANITIZERS);
      if (tainted.size === 0) return;

      walk(methodNode, (n) => {
        if (nodeType(n) !== "DotExpressionContext") return;
        const t = textOf(n).toLowerCase();
        if (!t.startsWith("database.query(") && !t.startsWith("database.querywithbinds(")) return;
        const parenIdx = t.indexOf("(");
        // Strip string literal contents: field names inside 'WHERE Id = :id'
        // must not shadow tainted variable names or bind variable occurrences.
        const args = stripStringLiterals(t.substring(parenIdx + 1));
        for (const v of tainted) {
          if (hasWordRef(args, v)) {
            ctx.report(n, `Tainted variable "${v}" from user-controlled input reaches Database.query() — use bind variables (:var) or String.escapeSingleQuotes() to prevent injection.`);
            return;
          }
        }
      });
    }

    return {
      MethodDeclarationContext: check,
      ConstructorDeclarationContext: check,
    };
  },
};

/** Walk parent chain to check if any enclosing class has @IsTest. */
function isInsideTestContext(node: any): boolean {
  let p = node?.parentCtx;
  while (p) {
    if (nodeType(p) === "ClassDeclarationContext") {
      const typeDecl = p.parentCtx;
      if (typeDecl) {
        for (let i = 0; i < (typeDecl.getChildCount?.() ?? 0); i++) {
          const mod = typeDecl.getChild(i);
          if (nodeType(mod) !== "ModifierContext") continue;
          for (let j = 0; j < (mod.getChildCount?.() ?? 0); j++) {
            const ann = mod.getChild(j);
            if (nodeType(ann) === "AnnotationContext" &&
                textOf(ann).replace(/^@/, "").split("(")[0].toLowerCase() === "istest") return true;
          }
        }
      }
    }
    p = p.parentCtx;
  }
  return false;
}

/** URL sanitizers — encoding a URL does not prevent redirect, but these are common safe patterns. */
const REDIRECT_SANITIZERS: string[] = [];

/**
 * Tainted URL value flows into new PageReference() — open redirect.
 *
 * Uses the same PMD-style intra-method taint analysis as ApexSOQLInjection.
 * Flags PageReference constructed from a variable that was seeded by user-controlled
 * input (VF params, REST params). Skips @IsTest classes and literal string args.
 * PMD: ApexOpenRedirect
 */
export const apexOpenRedirect: Rule = {
  id: "ApexOpenRedirect",
  category: "security",
  severity: "high",
  description: "User-controlled URL flows into PageReference — open redirect risk.",
  create(ctx) {
    function check(methodNode: any): void {
      // Skip @IsTest contexts — test code constructs PageReferences for test harness setup
      if (isInsideTestContext(methodNode)) return;

      const tainted = buildTaintedVars(methodNode, TAINT_SOURCES, REDIRECT_SANITIZERS);

      walk(methodNode, (n) => {
        if (nodeType(n) !== "NewExpressionContext") return;
        const t = textOf(n).toLowerCase();
        if (!t.startsWith("newpagereference(")) return;
        const argText = t.substring("newpagereference(".length);
        // Literal string arg is safe
        if (argText.startsWith("'")) return;
        for (const v of tainted) {
          if (hasWordRef(argText, v)) {
            ctx.report(n, `Tainted variable "${v}" from user-controlled input flows into PageReference — validate or whitelist the URL to prevent open redirect.`);
            return;
          }
        }
      });
    }

    return {
      MethodDeclarationContext: check,
      ConstructorDeclarationContext: check,
    };
  },
};

/**
 * User-controlled URL flows into HttpRequest.setEndpoint() — Server-Side Request Forgery.
 * An attacker can redirect internal callouts to arbitrary hosts, bypassing network controls,
 * accessing internal services, or exfiltrating data.
 * PMD: ApexSSRF
 */
export const apexSSRF: Rule = {
  id: "ApexSSRF",
  category: "security",
  severity: "high",
  description: "User-controlled URL flows into an HTTP callout endpoint — SSRF risk.",
  create(ctx) {
    function check(methodNode: any): void {
      const tainted = buildTaintedVars(methodNode, TAINT_SOURCES, []);
      if (tainted.size === 0) return;

      walk(methodNode, (n) => {
        if (nodeType(n) !== "DotExpressionContext") return;
        const t = textOf(n).toLowerCase();
        if (!t.includes(".setendpoint(")) return;
        const startIdx = t.indexOf(".setendpoint(") + ".setendpoint(".length;
        const arg = t.substring(startIdx);
        for (const v of tainted) {
          if (hasWordRef(arg, v)) {
            ctx.report(n, `Tainted variable "${v}" controls an HTTP callout endpoint — SSRF risk. Validate against an allowlist of permitted hosts before use.`);
            return;
          }
        }
      });
    }
    return { MethodDeclarationContext: check, ConstructorDeclarationContext: check };
  },
};

/** XSS sanitizers for page output context. */
const XSS_SANITIZERS = [
  "string.escapehtml4(",
  "string.escapehtml3(",
  "encodingutil.htmlencode(",
];

/**
 * User-controlled data flows into a Visualforce page message — XSS via reflected parameter.
 *
 * Covers three sinks:
 *   • new ApexPages.Message(severity, taintedMsg)  — message displayed on page
 *   • ApexPages.addMessage(new ApexPages.Message(…, tainted))
 *   • obj.addError(tainted, false)  — unescaped addError (complements ApexXSSFromEscapeFalse)
 *
 * Sanitizers: String.escapeHtml4(), String.escapeHtml3(), EncodingUtil.htmlEncode().
 */
export const apexXSSFromURLParam: Rule = {
  id: "ApexXSSFromURLParam",
  category: "security",
  severity: "high",
  description: "User-controlled data flows into a page message or unescaped error — XSS risk.",
  create(ctx) {
    function check(methodNode: any): void {
      const tainted = buildTaintedVars(methodNode, TAINT_SOURCES, XSS_SANITIZERS);
      if (tainted.size === 0) return;

      walk(methodNode, (n) => {
        const t = textOf(n).toLowerCase();

        // new ApexPages.Message(severity, taintedMsg)
        if (nodeType(n) === "NewExpressionContext" && t.startsWith("newapexpages.message(")) {
          const args = t.substring("newapexpages.message(".length);
          for (const v of tainted) {
            if (hasWordRef(args, v)) {
              ctx.report(n, `Tainted variable "${v}" flows into ApexPages.Message() — may render user content unescaped. Sanitize with String.escapeHtml4() before use.`);
              return;
            }
          }
        }

        if (nodeType(n) !== "DotExpressionContext") return;

        // ApexPages.addMessage(taintedVar) — pre-built Message variable (not inline constructor)
        // Skip if arg contains inline `new ApexPages.Message(...)` — already caught by NewExpressionContext above
        if (t.startsWith("apexpages.addmessage(")) {
          const args = t.substring("apexpages.addmessage(".length);
          if (!args.includes("newapexpages.message(")) {
            for (const v of tainted) {
              if (hasWordRef(args, v)) {
                ctx.report(n, `Tainted variable "${v}" flows into ApexPages.addMessage() — may expose unescaped user input. Sanitize first.`);
                return;
              }
            }
          }
        }

        // obj.addError(taintedMsg, false) — confirmed tainted + unescaped
        if (t.includes(".adderror(") && t.endsWith(",false)")) {
          const argStart = t.indexOf(".adderror(") + ".adderror(".length;
          const msgArg = t.substring(argStart, t.length - ",false)".length);
          for (const v of tainted) {
            if (hasWordRef(msgArg, v)) {
              ctx.report(n, `Tainted variable "${v}" flows into addError() with escapeXml=false — renders as raw HTML (XSS). Remove the false argument or sanitize.`);
              return;
            }
          }
        }
      });
    }
    return { MethodDeclarationContext: check, ConstructorDeclarationContext: check };
  },
};

export const databaseQueryWithVariable: Rule = {
  id: "DatabaseQueryWithVariable",
  category: "security",
  severity: "high",
  description: "Database.query() with a dynamic argument risks SOQL injection; use bind variables instead.",
  create(ctx) {
    return {
      // Database.query(x) parses as DotExpressionContext wrapping DotMethodCallContext
      DotExpressionContext: (node) => {
        const full = textOf(node).toLowerCase();
        if (!full.startsWith("database.query(") && !full.startsWith("database.querywithbinds(")) return;

        // Find the DotMethodCallContext child and check its first argument
        for (let i = 0; i < (node.getChildCount?.() ?? 0); i++) {
          const child = node.getChild(i);
          if (nodeType(child) !== "DotMethodCallContext") continue;
          for (let j = 0; j < (child.getChildCount?.() ?? 0); j++) {
            const grand = child.getChild(j);
            if (nodeType(grand) !== "ExpressionListContext") continue;
            const firstArg = grand.getChild(0);
            if (!firstArg) continue;
            const argText = textOf(firstArg);
            // String literals start with single quote in Apex
            if (argText.startsWith("'")) return; // safe — static string
            ctx.report(
              node,
              "Database.query() with a non-literal argument — use bind variables or parameterized queries to prevent SOQL injection.",
            );
          }
        }
      },
    };
  },
};
