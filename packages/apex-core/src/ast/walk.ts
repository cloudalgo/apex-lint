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
 * True if `node` sits inside the *body* of a for/while/do loop.
 *
 * For `for(Type x : [SOQL]) { body }` the SOQL is the iterable (runs once).
 * We must not count it as "in a loop" — it is the recommended Salesforce
 * bulkification pattern and has no governor-limit impact.
 * Detection: when walking up to ForStatementContext, check whether we arrived
 * via ForControlContext (iterable position → false) or any other child (body → true).
 */
export function isInsideLoop(node: any): boolean {
  let p = node?.parentCtx;
  let prev: any = node;
  while (p) {
    const t = nodeType(p);
    if (t === "ForStatementContext") {
      // came through ForControlContext = we're in the for-each header, not the body
      if (nodeType(prev) === "ForControlContext") return false;
      return true;
    }
    if (t === "WhileStatementContext" || t === "DoWhileStatementContext") return true;
    prev = p;
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
