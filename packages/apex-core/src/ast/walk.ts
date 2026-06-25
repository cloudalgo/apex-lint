/**
 * Tree-walking utilities. Rules never re-implement traversal; they declare
 * which node types they care about and the engine dispatches. These helpers
 * cover the handful of structural questions rules actually ask.
 */

/** Constructor name of a parse-tree node, e.g. "QueryContext". */
export function nodeType(node: any): string {
  return node?.constructor?.name ?? "";
}

/** 1-based source line of a node's first token. */
export function lineOf(node: any): number {
  return node?.start?.line ?? 0;
}

/** 0-based column of a node's first token. */
export function columnOf(node: any): number {
  return node?.start?.column ?? 0;
}

/** Last line covered by the node (falls back to start line). */
export function endLineOf(node: any): number {
  return node?.stop?.line ?? lineOf(node);
}

/** Raw concatenated text of a node (no whitespace — ANTLR strips it). */
export function textOf(node: any): string {
  return node?.getText ? node.getText() : "";
}

/** Depth-first pre-order walk. `visit` is called once per node. */
export function walk(node: any, visit: (n: any) => void): void {
  if (!node) return;
  visit(node);
  const count = node.getChildCount ? node.getChildCount() : 0;
  for (let i = 0; i < count; i++) {
    walk(node.getChild(i), visit);
  }
}

const LOOP_TYPES = new Set([
  "ForStatementContext",
  "WhileStatementContext",
  "DoWhileStatementContext",
]);

/**
 * True if `node` sits inside a for/while/do loop. Walks up via parentCtx,
 * which the grammar populates on every context node.
 */
export function isInsideLoop(node: any): boolean {
  let p = node?.parentCtx;
  while (p) {
    if (LOOP_TYPES.has(nodeType(p))) return true;
    p = p.parentCtx;
  }
  return false;
}

/** Nearest ancestor of the given context type name, or undefined. */
export function ancestorOfType(node: any, typeName: string): any | undefined {
  let p = node?.parentCtx;
  while (p) {
    if (nodeType(p) === typeName) return p;
    p = p.parentCtx;
  }
  return undefined;
}

/** Enclosing MethodDeclarationContext for a node, if any. */
export function enclosingMethod(node: any): any | undefined {
  return ancestorOfType(node, "MethodDeclarationContext");
}
