import type { Rule } from "../engine/types.js";
import { nodeType, textOf, walk } from "../ast/walk.js";

function getClassName(classNode: any): string {
  const id = classNode.id ? classNode.id() : null;
  return id ? textOf(id) : "Unknown";
}

/**
 * Methods with more than 5 parameters are hard to call and test.
 * PMD: ExcessiveParameterList
 */
export const excessiveParameterList: Rule = {
  id: "ExcessiveParameterList",
  category: "design",
  severity: "low",
  description: "Methods with more than 5 parameters are hard to call and test.",
  create(ctx) {
    return {
      MethodDeclarationContext: (node) => {
        try {
          const fp = node.formalParameters?.();
          if (!fp) return;
          let count = 0;
          walk(fp, (n) => {
            if (nodeType(n) === "FormalParameterContext") count++;
          });
          if (count > 5) {
            const name = node.id ? textOf(node.id()) : "method";
            ctx.report(node, `Method "${name}" has ${count} parameters (threshold: 5) — use a parameter object or split into smaller methods.`);
          }
        } catch {
          // ignore parse edge cases
        }
      },
    };
  },
};

/**
 * Classes with more than 15 fields are a design smell.
 * PMD: TooManyFields
 */
export const tooManyFields: Rule = {
  id: "TooManyFields",
  category: "design",
  severity: "low",
  description: "Classes with more than 15 fields are a design smell — consider splitting.",
  create(ctx) {
    return {
      ClassDeclarationContext: (node) => {
        let fields = 0;
        for (let i = 0; i < (node.getChildCount?.() ?? 0); i++) {
          const classBody = node.getChild(i);
          if (nodeType(classBody) !== "ClassBodyContext") continue;
          for (let j = 0; j < (classBody.getChildCount?.() ?? 0); j++) {
            const decl = classBody.getChild(j);
            if (nodeType(decl) !== "ClassBodyDeclarationContext") continue;
            for (let k = 0; k < (decl.getChildCount?.() ?? 0); k++) {
              const member = decl.getChild(k);
              if (nodeType(member) !== "MemberDeclarationContext") continue;
              for (let m = 0; m < (member.getChildCount?.() ?? 0); m++) {
                const t = nodeType(member.getChild(m));
                if (t === "FieldDeclarationContext" || t === "PropertyDeclarationContext") fields++;
              }
            }
          }
        }
        if (fields > 15) {
          ctx.report(node, `Class "${getClassName(node)}" has ${fields} fields (threshold: 15) — consider splitting into smaller, focused classes.`);
        }
      },
    };
  },
};

/**
 * Classes with more than 45 public/global members expose a large API surface —
 * hard to understand, test, and maintain. Split into focused classes.
 * PMD: ExcessivePublicCount
 */
export const excessivePublicCount: Rule = {
  id: "ExcessivePublicCount",
  category: "design",
  severity: "low",
  description: "Classes with more than 45 public members are hard to understand and maintain.",
  create(ctx) {
    return {
      ClassDeclarationContext: (node) => {
        let publicCount = 0;
        for (let i = 0; i < (node.getChildCount?.() ?? 0); i++) {
          const body = node.getChild(i);
          if (nodeType(body) !== "ClassBodyContext") continue;
          for (let j = 0; j < (body.getChildCount?.() ?? 0); j++) {
            const decl = body.getChild(j);
            if (nodeType(decl) !== "ClassBodyDeclarationContext") continue;
            for (let k = 0; k < (decl.getChildCount?.() ?? 0); k++) {
              const child = decl.getChild(k);
              if (nodeType(child) === "ModifierContext") {
                const t = textOf(child).toLowerCase();
                if (t === "public" || t === "global") { publicCount++; break; }
              }
            }
          }
        }
        if (publicCount > 45) {
          ctx.report(node, `Class "${getClassName(node)}" has ${publicCount} public members (threshold: 45) — split into focused classes.`);
        }
      },
    };
  },
};

const COGNITIVE_NODES = new Set([
  "IfStatementContext",
  "ForStatementContext",
  "WhileStatementContext",
  "DoWhileStatementContext",
  "CatchClauseContext",
  "SwitchStatementContext",
  "WhenControlContext",
]);

/**
 * Structural-aware DFS that accumulates score += (1 + nestingDepth) per structural node.
 * Does not descend into nested class declarations.
 */
function calcCognitiveComplexity(node: any): number {
  let score = 0;
  function dfs(n: any, depth: number): void {
    const t = nodeType(n);
    let nextDepth = depth;
    if (COGNITIVE_NODES.has(t)) {
      score += 1 + depth;
      nextDepth = depth + 1;
    }
    const count = n.getChildCount?.() ?? 0;
    for (let i = 0; i < count; i++) {
      const child = n.getChild(i);
      if (!child?.constructor?.name?.endsWith("Context")) continue;
      if (nodeType(child) === "ClassDeclarationContext") continue;
      dfs(child, nextDepth);
    }
  }
  dfs(node, 0);
  return score;
}

/**
 * Cognitive complexity weights nesting depth on top of branch count — a deeply
 * nested method is exponentially harder to follow than a flat one of equal branches.
 * Score = Σ (1 + nestingDepth) per structural node (if/for/while/do/catch/switch/when).
 * Threshold: 15 (PMD default).
 */
export const cognitiveComplexity: Rule = {
  id: "CognitiveComplexity",
  category: "design",
  severity: "moderate",
  description: "Methods with high cognitive complexity are exponentially harder to understand as nesting increases.",
  create(ctx) {
    return {
      MethodDeclarationContext: (node) => {
        const score = calcCognitiveComplexity(node);
        if (score > 15) {
          const name = node.id ? textOf(node.id()) : "method";
          ctx.report(node, `Method "${name}" has cognitive complexity of ${score} (threshold: 15) — reduce nesting depth or extract helper methods.`);
        }
      },
    };
  },
};

const SKIP_ANNOTATIONS = new Set([
  "auraenabled", "remoteaction", "invocablemethod", "future",
  "istest", "testsetup", "httpget", "httppost", "httpput",
  "httppatch", "httpdelete", "testvisible",
  "testmethod", // legacy testMethod keyword modifier treated as annotation-equivalent
]);

const FRAMEWORK_METHOD_NAMES = new Set([
  "execute", "start", "finish", "handlemessage",
  "invoke", "evaluate", "compareto", "tostring", "equals", "hashcode",
]);

/**
 * Private method in an outer class that is never called anywhere within the same
 * class body (including inner classes). Private methods cannot be called from outside
 * the class, so a method with zero internal call sites is dead code.
 * Skips framework method names and annotation-driven entry points.
 */
export const unusedPrivateMethod: Rule = {
  id: "UnusedPrivateMethod",
  category: "design",
  severity: "low",
  description: "Private methods unreferenced within the class are dead code.",
  create(ctx) {
    return {
      ClassDeclarationContext: (node) => {
        // Only outer classes — inner class private methods may be called from the outer class
        if (nodeType(node.parentCtx) !== "TypeDeclarationContext") return;

        // Step 1: collect private, non-framework method declarations
        const privateMethods = new Map<string, any>(); // lowercase name → MethodDeclarationContext
        for (let i = 0; i < (node.getChildCount?.() ?? 0); i++) {
          const classBody = node.getChild(i);
          if (nodeType(classBody) !== "ClassBodyContext") continue;
          for (let j = 0; j < (classBody.getChildCount?.() ?? 0); j++) {
            const decl = classBody.getChild(j);
            if (nodeType(decl) !== "ClassBodyDeclarationContext") continue;
            let isPrivate = false;
            let skip = false;
            for (let k = 0; k < (decl.getChildCount?.() ?? 0); k++) {
              const mod = decl.getChild(k);
              if (nodeType(mod) !== "ModifierContext") continue;
              const mt = textOf(mod).toLowerCase();
              if (mt === "private") isPrivate = true;
              if (SKIP_ANNOTATIONS.has(mt.replace(/^@/, "").split("(")[0])) skip = true;
            }
            if (!isPrivate || skip) continue;
            for (let k = 0; k < (decl.getChildCount?.() ?? 0); k++) {
              const member = decl.getChild(k);
              if (nodeType(member) !== "MemberDeclarationContext") continue;
              for (let m = 0; m < (member.getChildCount?.() ?? 0); m++) {
                const mDecl = member.getChild(m);
                if (nodeType(mDecl) !== "MethodDeclarationContext" || !mDecl.id) continue;
                const name = textOf(mDecl.id()).toLowerCase();
                if (!FRAMEWORK_METHOD_NAMES.has(name) && !privateMethods.has(name)) {
                  privateMethods.set(name, mDecl);
                }
              }
            }
          }
        }

        if (privateMethods.size === 0) return;

        // Step 2: collect all method call references within the entire class (including inner classes)
        const calledNames = new Set<string>();
        walk(node, (n) => {
          const t = nodeType(n);
          if (t === "MethodCallExpressionContext") {
            const name = textOf(n).toLowerCase().split("(")[0];
            if (name) calledNames.add(name);
          } else if (t === "DotExpressionContext") {
            const beforeParen = textOf(n).toLowerCase().split("(")[0];
            const name = beforeParen.split(".").pop() ?? "";
            if (name) calledNames.add(name);
          }
        });

        // Step 3: flag methods with no call sites
        for (const [name, mDecl] of privateMethods) {
          if (!calledNames.has(name)) {
            ctx.report(mDecl, `Private method "${name}" is never called — remove it or add @TestVisible if accessed from tests.`);
          }
        }
      },
    };
  },
};

/** DFS walk that does not descend into nested class declarations. */
function walkNoNestedClass(node: any, visit: (n: any) => void): void {
  visit(node);
  const count = node.getChildCount?.() ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.getChild(i);
    if (!child?.constructor?.name?.endsWith("Context")) continue;
    if (nodeType(child) !== "ClassDeclarationContext") walkNoNestedClass(child, visit);
  }
}

const COMPLEXITY_NODES = new Set([
  "IfStatementContext",
  "ForStatementContext",
  "WhileStatementContext",
  "DoWhileStatementContext",
  "CatchClauseContext",
  "TernaryExpressionContext",
  "WhenControlContext",
]);

/**
 * Cyclomatic complexity = 1 + number of independent decision branches in a method.
 * Methods over 10 are hard to unit-test exhaustively.
 * PMD: CyclomaticComplexity
 */
export const cyclomaticComplexity: Rule = {
  id: "CyclomaticComplexity",
  category: "design",
  severity: "moderate",
  description: "Methods with high cyclomatic complexity are hard to test and maintain.",
  create(ctx) {
    return {
      MethodDeclarationContext: (node) => {
        let complexity = 1;
        walkNoNestedClass(node, (n) => {
          if (COMPLEXITY_NODES.has(nodeType(n))) complexity++;
        });
        if (complexity > 10) {
          const name = node.id ? textOf(node.id()) : "method";
          ctx.report(
            node,
            `Method "${name}" has cyclomatic complexity of ${complexity} (threshold: 10) — split into smaller methods.`,
          );
        }
      },
    };
  },
};

const NESTING_NODES = new Set([
  "IfStatementContext",
  "ForStatementContext",
  "WhileStatementContext",
  "DoWhileStatementContext",
]);

function calcMaxDepth(node: any): number {
  let max = 0;
  function dfs(n: any, depth: number): void {
    const d = NESTING_NODES.has(nodeType(n)) ? depth + 1 : depth;
    if (d > max) max = d;
    const count = n.getChildCount?.() ?? 0;
    for (let i = 0; i < count; i++) {
      const child = n.getChild(i);
      if (!child?.constructor?.name?.endsWith("Context")) continue;
      if (nodeType(child) !== "ClassDeclarationContext") dfs(child, d);
    }
  }
  dfs(node, 0);
  return max;
}

/**
 * Methods with nesting depth > 4 are hard to follow. Use early returns or
 * extract nested blocks into helper methods.
 * PMD: AvoidDeeplyNestedIfStmts
 */
export const avoidDeeplyNestedIfStmts: Rule = {
  id: "AvoidDeeplyNestedIfStmts",
  category: "design",
  severity: "moderate",
  description: "Deeply nested conditionals reduce readability; use early returns or extracted methods.",
  create(ctx) {
    return {
      MethodDeclarationContext: (node) => {
        const depth = calcMaxDepth(node);
        if (depth > 4) {
          const name = node.id ? textOf(node.id()) : "method";
          ctx.report(
            node,
            `Method "${name}" has nesting depth of ${depth} (threshold: 4) — use early returns or extract nested blocks into methods.`,
          );
        }
      },
    };
  },
};
