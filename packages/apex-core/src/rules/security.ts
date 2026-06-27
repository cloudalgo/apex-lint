import type { Rule } from "../engine/types.js";
import { nodeType, textOf, walk } from "../ast/walk.js";
import { getTaint, stripStringLiterals, hasWordRef, SOQL_SANITIZERS as ENGINE_SOQL_SANITIZERS, XSS_SANITIZERS as ENGINE_XSS_SANITIZERS } from "../engine/taint.js";

// `hasWordRef` and `stripStringLiterals` are shared with the taint engine —
// imported from engine/taint.ts so the two never drift.

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

/**
 * Remove `escapeSingleQuotes(...)` calls (and their arguments) from sink text so
 * a value escaped AT THE SINK — the recommended `Database.query(escapeSingleQuotes(q) + ':bind')`
 * pattern — is not reported. Balanced-paren matching handles nested calls.
 */
function stripSoqlSanitizers(s: string): string {
  let out = s;
  for (const fn of ["string.escapesinglequotes(", "escapesinglequotes("]) {
    let idx: number;
    while ((idx = out.indexOf(fn)) >= 0) {
      let depth = 1;
      let j = idx + fn.length;
      while (j < out.length && depth > 0) {
        if (out[j] === "(") depth++;
        else if (out[j] === ")") depth--;
        j++;
      }
      out = out.slice(0, idx) + out.slice(j);
    }
  }
  return out;
}

export const apexSOQLInjection: Rule = {
  id: "ApexSOQLInjection",
  category: "security",
  severity: "critical",
  description: "User-controlled data flows into Database.query() — SOQL injection risk.",
  create(ctx) {
    function check(methodNode: any): void {
      const { tainted } = getTaint(methodNode, ENGINE_SOQL_SANITIZERS);
      if (tainted.size === 0) return;

      walk(methodNode, (n) => {
        if (nodeType(n) !== "DotExpressionContext") return;
        const t = textOf(n).toLowerCase();
        if (!t.startsWith("database.query(") && !t.startsWith("database.querywithbinds(")) return;
        const parenIdx = t.indexOf("(");
        const args = stripStringLiterals(stripSoqlSanitizers(t.substring(parenIdx + 1)));
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

      const tainted = getTaint(methodNode, []).tainted;

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
      const tainted = getTaint(methodNode, []).tainted;
      if (tainted.size === 0) return;

      walk(methodNode, (n) => {
        if (nodeType(n) !== "DotExpressionContext") return;
        const t = textOf(n).toLowerCase();
        if (!t.includes(".setendpoint(")) return;
        const startIdx = t.indexOf(".setendpoint(") + ".setendpoint(".length;
        const arg = stripStringLiterals(t.substring(startIdx));
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
      const tainted = getTaint(methodNode, ENGINE_XSS_SANITIZERS).tainted;
      if (tainted.size === 0) return;

      walk(methodNode, (n) => {
        const t = textOf(n).toLowerCase();

        // new ApexPages.Message(severity, taintedMsg)
        if (nodeType(n) === "NewExpressionContext" && t.startsWith("newapexpages.message(")) {
          const args = stripStringLiterals(t.substring("newapexpages.message(".length));
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
          const args = stripStringLiterals(t.substring("apexpages.addmessage(".length));
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
          const msgArg = stripStringLiterals(t.substring(argStart, t.length - ",false)".length));
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
            // Safe only if the whole argument is one static string literal. A
            // concatenation like 'SELECT … = ' + userInput also starts with a
            // quote, so a bare startsWith("'") check would miss the canonical
            // injection pattern — require that no concatenation remains once the
            // literal bodies are stripped.
            if (argText.startsWith("'") && !stripStringLiterals(argText).includes("+")) return;
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
