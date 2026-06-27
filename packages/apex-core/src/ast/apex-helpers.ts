/**
 * Shared structural predicates over the Apex parse tree. Rules previously each
 * carried copy-pasted variants of these (classHasIsTest / classNodeIsTest /
 * classIsTest / isInsideTestContext / hasAnnotationOn / methodIsTest); they had
 * begun to drift. This is the single source of truth.
 */
import { nodeType, textOf } from "./walk.js";

/** True if `node`'s direct ModifierContext children include `@<annotName>`. */
export function hasAnnotation(node: any, annotName: string): boolean {
  const lower = annotName.toLowerCase();
  for (let i = 0; i < (node?.getChildCount?.() ?? 0); i++) {
    const modifier = node.getChild(i);
    if (nodeType(modifier) !== "ModifierContext") continue;
    for (let j = 0; j < (modifier.getChildCount?.() ?? 0); j++) {
      const ann = modifier.getChild(j);
      if (nodeType(ann) !== "AnnotationContext") continue;
      if (textOf(ann).replace(/^@/, "").split("(")[0].toLowerCase() === lower) return true;
    }
  }
  return false;
}

/**
 * True if `classNode` is a top-level `@IsTest` class. Only outer classes count:
 * a ClassDeclarationContext whose parent is a TypeDeclarationContext carrying
 * `@IsTest`. Inner classes (parent = MemberDeclarationContext) are intentionally
 * excluded, so a helper class nested in an `@IsTest` outer class is not itself
 * treated as test code.
 */
export function isTestClass(classNode: any): boolean {
  const parent = classNode?.parentCtx;
  if (!parent || nodeType(parent) !== "TypeDeclarationContext") return false;
  return hasAnnotation(parent, "istest");
}

/** True if any enclosing class of `node` is an `@IsTest` class. */
export function isInsideTestClass(node: any): boolean {
  let p = node?.parentCtx;
  while (p) {
    if (nodeType(p) === "ClassDeclarationContext" && isTestClass(p)) return true;
    p = p.parentCtx;
  }
  return false;
}

/**
 * True if `methodNode` is a test method — `@IsTest` on its enclosing
 * ClassBodyDeclarationContext, or the legacy `testMethod` modifier keyword.
 */
export function isTestMethod(methodNode: any): boolean {
  const cbDecl = methodNode?.parentCtx?.parentCtx;
  if (!cbDecl) return false;
  if (nodeType(cbDecl) === "ClassBodyDeclarationContext" && hasAnnotation(cbDecl, "istest")) return true;
  for (let i = 0; i < (cbDecl.getChildCount?.() ?? 0); i++) {
    const c = cbDecl.getChild(i);
    if (nodeType(c) === "ModifierContext" && textOf(c).toLowerCase() === "testmethod") return true;
  }
  return false;
}
