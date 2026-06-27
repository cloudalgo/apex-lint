import type { Rule } from "../engine/types.js";
import { nodeType, textOf, walk, ancestorOfType } from "../ast/walk.js";

/** Catch block with no statements — swallows exceptions silently. */
export const emptyCatchBlock: Rule = {
  id: "EmptyCatchBlock",
  category: "error-prone",
  severity: "moderate",
  description: "Catch blocks should not be empty; at minimum log the exception.",
  create(ctx) {
    return {
      CatchClauseContext: (node) => {
        const block = node.block ? node.block() : null;
        if (!block) return;
        // child count ≤ 2 means only the '{' and '}' terminals — truly empty.
        // block.statement() is wrong: ANTLR wraps children as BlockStatement nodes,
        // not Statement nodes, so it returns empty even for non-empty blocks.
        if ((block.getChildCount?.() ?? 0) <= 2) {
          ctx.report(node, "Empty catch block — handle or log the exception.");
        }
      },
    };
  },
};

const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;

/** Method names should be camelCase. Skips test methods which often use method_scenario_expected convention. */
export const methodNamingConventions: Rule = {
  id: "MethodNamingConventions",
  category: "code-style",
  severity: "low",
  description: "Method names should be in camelCase.",
  create(ctx) {
    return {
      MethodDeclarationContext: (node) => {
        // Test methods and helpers in test classes commonly use underscores
        if (methodIsTest(node) || isInsideTestClass(node)) return;
        const idNode = node.id ? node.id() : null;
        const name = idNode ? textOf(idNode) : "";
        if (name && !CAMEL_CASE.test(name)) {
          ctx.report(idNode ?? node, `Method "${name}" should be camelCase.`);
        }
      },
    };
  },
};

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

function methodIsTest(methodNode: any): boolean {
  // @IsTest on the ClassBodyDeclarationContext (method level)
  const cbDecl = methodNode.parentCtx?.parentCtx;
  if (cbDecl && nodeType(cbDecl) === "ClassBodyDeclarationContext" && hasAnnotationOn(cbDecl, "istest")) return true;
  // testMethod modifier keyword (legacy) — appears in textOf of a ModifierContext as 'testMethod'
  if (cbDecl) {
    for (let i = 0; i < (cbDecl.getChildCount?.() ?? 0); i++) {
      const c = cbDecl.getChild(i);
      if (nodeType(c) === "ModifierContext" && textOf(c).toLowerCase() === "testmethod") return true;
    }
  }
  return false;
}

function classIsTest(classNode: any): boolean {
  // For outer classes: ClassDeclarationContext.parentCtx = TypeDeclarationContext
  // For inner classes: ClassDeclarationContext.parentCtx = MemberDeclarationContext (no TypeDeclarationContext)
  // Using direct parent avoids falsely treating inner classes of @IsTest outer classes as test classes.
  const parent = classNode.parentCtx;
  if (!parent || nodeType(parent) !== "TypeDeclarationContext") return false;
  return hasAnnotationOn(parent, "istest");
}

function isInsideTestClass(node: any): boolean {
  let p = node?.parentCtx;
  while (p) {
    if (nodeType(p) === "ClassDeclarationContext" && classIsTest(p)) return true;
    p = p.parentCtx;
  }
  return false;
}

function methodHasAssert(methodNode: any): boolean {
  let found = false;
  walk(methodNode, (child) => {
    if (found) return;
    const nt = nodeType(child);
    if (nt === "DotExpressionContext") {
      const t = textOf(child).toLowerCase();
      if (t.startsWith("system.assert(") || t.startsWith("system.assertequals(") ||
          t.startsWith("system.assertnotequals(") || t.startsWith("system.assert.") ||
          t.startsWith("assert.")) {
        found = true;
      }
    } else if (nt === "MethodCallExpressionContext") {
      // Delegate assertion: test calls a private helper like assertCompareBoolean()
      // whose name starts with "assert" — treat as containing an assertion.
      const name = textOf(child).toLowerCase().split("(")[0];
      if (name.startsWith("assert")) found = true;
    }
  });
  return found;
}

/**
 * Explicitly annotated @IsTest method (or testMethod) with no assertion calls.
 * Only flags methods with the annotation on the method itself — not all methods in
 * @IsTest classes — to avoid FPs from helper/factory methods in test classes.
 */
export const testWithoutAsserts: Rule = {
  id: "TestWithoutAsserts",
  category: "best-practices",
  severity: "moderate",
  description: "Test methods should contain at least one assertion.",
  create(ctx) {
    return {
      MethodDeclarationContext: (node) => {
        if (!methodIsTest(node)) return;
        if (!methodHasAssert(node)) {
          ctx.report(node, "Test method has no assertions — add System.assertEquals() or Assert.* calls.");
        }
      },
    };
  },
};

/** @isTest(SeeAllData=true) — accesses live org data, making tests order-dependent and brittle. */
export const seeAllDataTrue: Rule = {
  id: "SeeAllDataTrue",
  category: "best-practices",
  severity: "moderate",
  description: "@IsTest(SeeAllData=true) makes tests depend on live org data — use test factories instead.",
  create(ctx) {
    return {
      AnnotationContext: (node) => {
        if (textOf(node).toLowerCase().includes("seealldata=true")) {
          ctx.report(node, "@IsTest(SeeAllData=true) accesses live org data — tests become order-dependent and fail in scratch orgs.");
        }
      },
    };
  },
};

/**
 * @AuraEnabled annotation on a member without public/global access.
 * Private @AuraEnabled members are inaccessible from LWC.
 * PMD: InaccessibleAuraEnabledGetter
 */
export const inaccessibleAuraEnabledGetter: Rule = {
  id: "InaccessibleAuraEnabledGetter",
  category: "error-prone",
  severity: "high",
  description: "@AuraEnabled members without public or global access are inaccessible from LWC.",
  create(ctx) {
    return {
      ClassBodyDeclarationContext: (node) => {
        // Check for @AuraEnabled annotation
        let hasAuraEnabled = false;
        for (let i = 0; i < (node.getChildCount?.() ?? 0); i++) {
          const modifier = node.getChild(i);
          if (nodeType(modifier) !== "ModifierContext") continue;
          for (let j = 0; j < (modifier.getChildCount?.() ?? 0); j++) {
            const ann = modifier.getChild(j);
            if (nodeType(ann) !== "AnnotationContext") continue;
            if (textOf(ann).replace(/^@/, "").split("(")[0].toLowerCase() === "auraenabled") {
              hasAuraEnabled = true;
            }
          }
        }
        if (!hasAuraEnabled) return;
        // Require public or global access modifier
        for (let i = 0; i < (node.getChildCount?.() ?? 0); i++) {
          const child = node.getChild(i);
          if (nodeType(child) === "ModifierContext") {
            const t = textOf(child).toLowerCase();
            if (t === "public" || t === "global") return;
          }
        }
        ctx.report(node, "@AuraEnabled member is not public or global — it cannot be accessed from LWC or Aura.");
      },
    };
  },
};

/**
 * addError() with escapeXml=false disables XML escaping on the error message,
 * opening a reflected XSS vector if the message contains user input.
 * PMD: ApexXSSFromEscapeFalse
 */
export const apexXSSFromEscapeFalse: Rule = {
  id: "ApexXSSFromEscapeFalse",
  category: "security",
  severity: "high",
  description: "addError() with escapeXml=false disables XML escaping and may allow XSS.",
  create(ctx) {
    return {
      DotExpressionContext: (node) => {
        const t = textOf(node).toLowerCase();
        if (!t.includes(".adderror(") || !t.endsWith(",false)")) return;
        // Extract the message argument (between .addError( and ,false))
        const argStart = t.indexOf(".adderror(") + ".adderror(".length;
        const msgArg = t.substring(argStart, t.length - ",false)".length);
        // Hardcoded string literals cannot contain user input — no XSS risk
        if (msgArg.startsWith("'")) return;
        ctx.report(node, "addError() with escapeXml=false disables HTML escaping — non-literal messages may render user-controlled content as raw HTML (XSS). Remove the false argument or sanitize with String.escapeHtml4().");
      },
    };
  },
};

/**
 * Deprecated testMethod keyword — use @IsTest annotation instead.
 * PMD: ApexUnitTestMethodShouldHaveIsTestAnnotation
 */
export const apexUnitTestMethodShouldHaveIsTestAnnotation: Rule = {
  id: "ApexUnitTestMethodShouldHaveIsTestAnnotation",
  category: "best-practices",
  severity: "low",
  description: "Deprecated 'testMethod' keyword should be replaced with @IsTest annotation.",
  create(ctx) {
    return {
      ModifierContext: (node) => {
        if (textOf(node).toLowerCase() === "testmethod") {
          ctx.report(node, "Deprecated 'testMethod' keyword — use @IsTest annotation on the method instead.");
        }
      },
    };
  },
};

/**
 * Test class with no System.runAs() call anywhere — tests run as the running user
 * and may silently pass for sharing/permission issues that would fail in production.
 * PMD: ApexUnitTestClassShouldHaveRunAs
 */
export const apexUnitTestClassShouldHaveRunAs: Rule = {
  id: "ApexUnitTestClassShouldHaveRunAs",
  category: "best-practices",
  severity: "low",
  description: "Test classes should have at least one System.runAs() call to verify user-context behavior.",
  create(ctx) {
    return {
      ClassDeclarationContext: (node) => {
        if (!classIsTest(node)) return;
        let hasRunAs = false;
        walk(node, (n) => {
          if (hasRunAs) return;
          if (nodeType(n) === "DotExpressionContext" && textOf(n).toLowerCase().startsWith("system.runas(")) {
            hasRunAs = true;
          }
        });
        if (!hasRunAs) {
          ctx.report(node, "Test class has no System.runAs() call — add runAs() to at least one test to verify sharing/permission behavior.");
        }
      },
    };
  },
};

/**
 * @IsTest or testMethod method inside a non-@IsTest class will not be
 * executed by the test runner — a silent dead test.
 * PMD: TestMethodsMustBeInTestClasses
 */
export const testMethodsMustBeInTestClasses: Rule = {
  id: "TestMethodsMustBeInTestClasses",
  category: "error-prone",
  severity: "high",
  description: "@IsTest methods in non-@IsTest classes are never executed by the test runner.",
  create(ctx) {
    return {
      MethodDeclarationContext: (node) => {
        if (!methodIsTest(node)) return;
        // Walk up to find the innermost enclosing class
        let p = node?.parentCtx;
        while (p) {
          if (nodeType(p) === "ClassDeclarationContext") {
            if (!classIsTest(p)) {
              const name = node.id ? textOf(node.id()) : "unknown";
              ctx.report(node, `Test method "${name}" is in a non-@IsTest class — the test runner will never execute it. Add @IsTest to the class.`);
            }
            return;
          }
          p = p.parentCtx;
        }
      },
    };
  },
};

/**
 * Overriding equals() without hashCode() (or vice versa) breaks collections:
 * equal objects would be placed in different Map buckets / Set slots.
 * PMD: OverrideBothEqualsAndHashcode
 */
export const overrideBothEqualsAndHashcode: Rule = {
  id: "OverrideBothEqualsAndHashcode",
  category: "error-prone",
  severity: "moderate",
  description: "Overriding equals() without hashCode() (or vice versa) breaks Map and Set behavior.",
  create(ctx) {
    return {
      ClassDeclarationContext: (node) => {
        let hasEquals = false;
        let hasHashCode = false;
        // Only check direct class body members, not inner classes
        for (let i = 0; i < (node.getChildCount?.() ?? 0); i++) {
          const body = node.getChild(i);
          if (nodeType(body) !== "ClassBodyContext") continue;
          for (let j = 0; j < (body.getChildCount?.() ?? 0); j++) {
            const decl = body.getChild(j);
            if (nodeType(decl) !== "ClassBodyDeclarationContext") continue;
            for (let k = 0; k < (decl.getChildCount?.() ?? 0); k++) {
              const member = decl.getChild(k);
              if (nodeType(member) !== "MemberDeclarationContext") continue;
              for (let m = 0; m < (member.getChildCount?.() ?? 0); m++) {
                const mDecl = member.getChild(m);
                if (nodeType(mDecl) !== "MethodDeclarationContext" || !mDecl.id) continue;
                const name = textOf(mDecl.id()).toLowerCase();
                if (name === "equals") hasEquals = true;
                if (name === "hashcode") hasHashCode = true;
              }
            }
          }
        }
        if (hasEquals === hasHashCode) return; // both or neither — ok
        const className = node.id ? textOf(node.id()) : "class";
        const msg = hasEquals
          ? `Class "${className}" overrides equals() but not hashCode() — breaks Map and Set behavior.`
          : `Class "${className}" overrides hashCode() but not equals() — inconsistent equality semantics.`;
        ctx.report(node, msg);
      },
    };
  },
};

/** Hardcoded HTTP/HTTPS URL in a string literal — use Named Credentials or Custom Metadata instead. */
export const hardcodedUrl: Rule = {
  id: "HardcodedUrl",
  category: "best-practices",
  severity: "moderate",
  description: "Hardcoded HTTP/HTTPS URLs should use Named Credentials or Custom Metadata.",
  create(ctx) {
    return {
      LiteralContext: (node) => {
        if (isInsideTestClass(node)) return;
        const t = textOf(node).toLowerCase();
        if (t.startsWith("'http://") || t.startsWith("'https://")) {
          ctx.report(node, "Hardcoded URL — use a Named Credential, Custom Metadata, or Custom Setting instead.");
        }
      },
    };
  },
};

/**
 * Global access modifier on a class or member. Global members cannot be deleted
 * once included in a managed package — prefer public.
 * PMD: AvoidGlobalModifier
 */
export const avoidGlobalModifier: Rule = {
  id: "AvoidGlobalModifier",
  category: "best-practices",
  severity: "low",
  description: "Global classes should be avoided — they cannot be deleted once packaged.",
  create(ctx) {
    return {
      ModifierContext: (node) => {
        if (textOf(node).toLowerCase() === "global") {
          ctx.report(node, "Avoid 'global' access modifier — use 'public' instead. Global members cannot be removed in managed packages.");
        }
      },
    };
  },
};

/**
 * System.debug() without a LoggingLevel argument defaults to DEBUG level, consuming
 * CPU in production and polluting logs. Prefer System.debug(LoggingLevel.X, msg).
 * PMD: DebugsShouldUseLoggingLevel
 */
export const debugsShouldUseLoggingLevel: Rule = {
  id: "DebugsShouldUseLoggingLevel",
  category: "best-practices",
  severity: "low",
  description: "System.debug() without a LoggingLevel argument uses the default level and wastes CPU in production.",
  create(ctx) {
    return {
      DotExpressionContext: (node) => {
        const t = textOf(node).toLowerCase();
        // PMD: count(*)=2 — fires only when there is exactly 1 argument (no LoggingLevel).
        // Do NOT match on text of the arg: system.debug(level, msg) has 2 args and is correct
        // even when the level is a variable, not the literal LoggingLevel.WARN enum form.
        if (t.startsWith("system.debug(") && countTopLevelArgs(t) === 1) {
          ctx.report(node, "System.debug() without a LoggingLevel — use System.debug(LoggingLevel.WARN, 'msg') to control log verbosity.");
        }
      },
    };
  },
};

/** Count top-level (non-nested) argument commas inside a call expression text. */
function countTopLevelArgs(text: string): number {
  const start = text.indexOf("(");
  if (start === -1) return 0;
  let depth = 0, commas = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") { depth--; if (depth === 0) break; }
    else if (ch === "," && depth === 1) commas++;
  }
  return commas + 1;
}

/**
 * System.assert/assertEquals/assertNotEquals without a message argument.
 * A failure message is essential for understanding why a test failed.
 * PMD: ApexAssertionsShouldIncludeMessage
 */
export const apexAssertionsShouldIncludeMessage: Rule = {
  id: "ApexAssertionsShouldIncludeMessage",
  category: "best-practices",
  severity: "low",
  description: "Test assertions should include a failure message as the last argument.",
  create(ctx) {
    return {
      DotExpressionContext: (node) => {
        const t = textOf(node).toLowerCase();
        // assertEquals(a, b, msg) and assertNotEquals(a, b, msg) need 3 args
        // assert(cond, msg) needs 2 args
        let required = 0;
        if (t.startsWith("system.assertequals(") || t.startsWith("system.assertnotequals(")) required = 3;
        else if (t.startsWith("system.assert(")) required = 2;
        if (required > 0 && countTopLevelArgs(t) < required) {
          ctx.report(node, "Test assertion missing failure message — add a descriptive message as the last argument.");
        }
      },
    };
  },
};

/**
 * Queueable implementation without System.attachFinalizer() — the job has no
 * error-handling hook, so failures in async chains are silently discarded.
 * PMD: QueueableWithoutFinalizer
 */
export const queueableWithoutFinalizer: Rule = {
  id: "QueueableWithoutFinalizer",
  category: "best-practices",
  severity: "low",
  description: "Queueable implementations should attach a Finalizer for robust error handling.",
  create(ctx) {
    return {
      ClassDeclarationContext: (node) => {
        let implementsText = "";
        for (let i = 0; i < (node.getChildCount?.() ?? 0); i++) {
          const child = node.getChild(i);
          if (nodeType(child) === "TypeListContext") {
            implementsText = textOf(child).toLowerCase();
            break;
          }
        }
        if (!implementsText.includes("queueable")) return;
        let hasFinalizer = false;
        walk(node, (n) => {
          if (hasFinalizer) return;
          if (nodeType(n) === "DotExpressionContext" && textOf(n).toLowerCase().startsWith("system.attachfinalizer(")) {
            hasFinalizer = true;
          }
        });
        if (!hasFinalizer) {
          ctx.report(node, "Queueable class without System.attachFinalizer() — attach a Finalizer to handle failures in long-running async chains.");
        }
      },
    };
  },
};
