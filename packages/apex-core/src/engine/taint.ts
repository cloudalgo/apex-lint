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
