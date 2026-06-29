import type { Rule } from "../engine/types.js";
import { nodeType, textOf, walk } from "../ast/walk.js";
import { hasAnnotation } from "../ast/apex-helpers.js";
import type { AstNode, AnnotationContext, ClassDeclarationContext, MethodDeclarationContext, MethodCallExpressionContext, DotExpressionContext } from "../ast/contexts.js";

/** Collect names of all @future methods in a class body. */
function collectFutureMethods(classNode: AstNode): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < (classNode.getChildCount?.() ?? 0); i++) {
    const classBody = classNode.getChild(i) as AstNode;
    if (nodeType(classBody) !== "ClassBodyContext") continue;
    for (let j = 0; j < (classBody.getChildCount?.() ?? 0); j++) {
      const decl = classBody.getChild(j) as AstNode;
      if (nodeType(decl) !== "ClassBodyDeclarationContext") continue;
      if (!hasAnnotation(decl, "future")) continue;
      walk(decl, (n: AstNode) => {
        if (nodeType(n) === "MethodDeclarationContext") {
          const m = n as MethodDeclarationContext;
          const name = textOf(m.id());
          if (name) result.add(name);
        }
      });
    }
  }
  return result;
}

/**
 * @future is a limited async primitive: no error handling, no chaining, no monitoring.
 * Prefer Queueable which supports finalizers, chaining, and System.enqueueJob tracking.
 * PMD: AvoidFutureAnnotation
 */
export const avoidFutureAnnotation: Rule = {
  id: "AvoidFutureAnnotation",
  category: "best-practices",
  severity: "low",
  description: "@future methods are limited — prefer Queueable for new async code.",
  create(ctx) {
    return {
      AnnotationContext: (node: AnnotationContext) => {
        const name = textOf(node).replace(/^@/, "").split("(")[0].toLowerCase();
        if (name === "future") {
          ctx.report(node, "@future has no error handling or chaining — implement Queueable with System.attachFinalizer() instead.");
        }
      },
    };
  },
};

/**
 * @future method calling another @future method — Apex throws a runtime exception.
 * Uses a pre-collect sub-walk per class so all @future names are known before
 * checking method bodies.
 */
export const futureMethodChaining: Rule = {
  id: "FutureMethodChaining",
  category: "error-prone",
  severity: "high",
  description: "Calling a @future method from another @future method throws a runtime exception in Apex.",
  create(ctx) {
    let futureMethods = new Set<string>();
    let currentIsFuture = false;
    let currentClassName = "";

    return {
      ClassDeclarationContext: (node: ClassDeclarationContext) => {
        // Only re-collect on the outermost class; inner classes cannot declare @future
        // methods in Apex, and overwriting futureMethods would lose the outer set.
        if (nodeType(node.parentCtx) === "TypeDeclarationContext") {
          futureMethods = collectFutureMethods(node);
          currentClassName = node.id ? textOf(node.id()) : "";
        }
        currentIsFuture = false;
      },
      MethodDeclarationContext: (node: MethodDeclarationContext) => {
        currentIsFuture = false;
        const cbDecl = node.parentCtx?.parentCtx; // MemberDeclaration → ClassBodyDeclaration
        if (cbDecl && nodeType(cbDecl) === "ClassBodyDeclarationContext") {
          currentIsFuture = hasAnnotation(cbDecl, "future");
        }
      },
      // Bare method calls like futureB() parse as MethodCallExpressionContext
      MethodCallExpressionContext: (node: MethodCallExpressionContext) => {
        if (!currentIsFuture) return;
        let calleeName = "";
        walk(node, (child: AstNode) => {
          if (!calleeName && nodeType(child) === "IdContext") calleeName = textOf(child);
        });
        if (calleeName && futureMethods.has(calleeName)) {
          ctx.report(
            node,
            `Calling @future method "${calleeName}" from another @future method — Apex throws a runtime exception for chained @future calls.`,
          );
        }
      },
      // Same-class qualified static calls: `this.futureB()` or `ThisClass.futureB()`.
      // Restricted to `this`/the enclosing class name so an unrelated
      // `OtherClass.foo()` with a coincidentally-matching name is not flagged.
      DotExpressionContext: (node: DotExpressionContext) => {
        if (!currentIsFuture) return;
        const text = textOf(node);
        const dot = text.indexOf(".");
        const paren = text.indexOf("(");
        if (dot < 1 || paren < dot) return;
        const qualifier = text.slice(0, dot);
        if (qualifier !== "this" && qualifier !== currentClassName) return;
        const method = text.slice(dot + 1, paren);
        if (!/^[A-Za-z_]\w*$/.test(method)) return; // bare method name only
        if (futureMethods.has(method)) {
          ctx.report(
            node,
            `Calling @future method "${method}" from another @future method — Apex throws a runtime exception for chained @future calls.`,
          );
        }
      },
    };
  },
};

const DML_CONTEXTS_TRIGGER = [
  "InsertStatementContext",
  "UpdateStatementContext",
  "DeleteStatementContext",
  "UpsertStatementContext",
  "UndeleteStatementContext",
];

/**
 * SOQL or DML directly in a trigger body — should delegate to a handler class.
 * Only fires on .trigger files.
 */
export const triggerInlineLogic: Rule = {
  id: "TriggerInlineLogic",
  category: "design",
  severity: "moderate",
  description: "Triggers with inline SOQL/DML are hard to test; delegate to a handler class.",
  create(ctx) {
    if (!ctx.filePath.endsWith(".trigger")) return {};

    const listener: Record<string, (n: AstNode) => void> = {
      QueryContext: (node) => {
        ctx.report(node, "Move SOQL/DML into a handler class — triggers with inline logic are hard to test and impossible to reuse.");
      },
    };
    for (const t of DML_CONTEXTS_TRIGGER) {
      listener[t] = (node) => {
        ctx.report(node, "Move SOQL/DML into a handler class — triggers with inline logic are hard to test and impossible to reuse.");
      };
    }
    return listener;
  },
};
