import type { Rule } from "../engine/types.js";
import { nodeType, textOf, walk } from "../ast/walk.js";

/** Check if a ClassBodyDeclarationContext has an annotation with the given name. */
function hasAnnotationOn(node: any, annotName: string): boolean {
  const lower = annotName.toLowerCase();
  for (let i = 0; i < (node.getChildCount?.() ?? 0); i++) {
    const modifier = node.getChild(i);
    if (nodeType(modifier) !== "ModifierContext") continue;
    for (let j = 0; j < (modifier.getChildCount?.() ?? 0); j++) {
      const ann = modifier.getChild(j);
      if (nodeType(ann) !== "AnnotationContext") continue;
      const name = textOf(ann).replace(/^@/, "").split("(")[0].toLowerCase();
      if (name === lower) return true;
    }
  }
  return false;
}

/** Collect names of all @future methods in a class body. */
function collectFutureMethods(classNode: any): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < (classNode.getChildCount?.() ?? 0); i++) {
    const classBody = classNode.getChild(i);
    if (nodeType(classBody) !== "ClassBodyContext") continue;
    for (let j = 0; j < (classBody.getChildCount?.() ?? 0); j++) {
      const decl = classBody.getChild(j);
      if (nodeType(decl) !== "ClassBodyDeclarationContext") continue;
      if (!hasAnnotationOn(decl, "future")) continue;
      walk(decl, (n) => {
        if (nodeType(n) === "MethodDeclarationContext" && n.id) {
          const name = textOf(n.id());
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
      AnnotationContext: (node) => {
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

    return {
      ClassDeclarationContext: (node) => {
        // Only re-collect on the outermost class; inner classes cannot declare @future
        // methods in Apex, and overwriting futureMethods would lose the outer set.
        if (nodeType(node.parentCtx) === "TypeDeclarationContext") {
          futureMethods = collectFutureMethods(node);
        }
        currentIsFuture = false;
      },
      MethodDeclarationContext: (node) => {
        currentIsFuture = false;
        const cbDecl = node.parentCtx?.parentCtx; // MemberDeclaration → ClassBodyDeclaration
        if (cbDecl && nodeType(cbDecl) === "ClassBodyDeclarationContext") {
          currentIsFuture = hasAnnotationOn(cbDecl, "future");
        }
      },
      // Bare method calls like futureB() parse as MethodCallExpressionContext
      MethodCallExpressionContext: (node) => {
        if (!currentIsFuture) return;
        let calleeName = "";
        walk(node, (child) => {
          if (!calleeName && nodeType(child) === "IdContext") calleeName = textOf(child);
        });
        if (calleeName && futureMethods.has(calleeName)) {
          ctx.report(
            node,
            `Calling @future method "${calleeName}" from another @future method — Apex throws a runtime exception for chained @future calls.`,
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

    const listener: Record<string, (n: any) => void> = {
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
