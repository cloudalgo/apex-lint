import type { Rule } from "../engine/types.js";
import { enclosingMethod, nodeType, textOf, walk } from "../ast/walk.js";
import { isTestClass } from "../ast/apex-helpers.js";

/**
 * UnguardedCrudOperation — the worked example of a *type-aware* rule.
 *
 * This is a PHASE-1 HEURISTIC, not full dataflow. It resolves the SObject a DML
 * statement operates on, asks the MetadataProvider whether that object actually
 * exists, and only then checks the enclosing method for any CRUD/FLS guard. The
 * provider is what makes this usable: with no metadata it stays silent (so a
 * variable named like a class can't produce a false positive); with metadata it
 * only fires on real, DML-able SObjects.
 *
 * The real version (phase 2) replaces the "is there a guard token anywhere in
 * the method" check with proper def-use / reaching-definitions analysis so a
 * guard on an unrelated object, or after the DML, no longer counts. That work
 * plugs in here without touching the rule's shape or the provider seam.
 */

const DML_CONTEXTS = new Set([
  "InsertStatementContext",
  "UpdateStatementContext",
  "DeleteStatementContext",
  "UpsertStatementContext",
  "UndeleteStatementContext",
]);

// Object-agnostic guards: cannot be attributed to a single SObject without
// dataflow, so any occurrence suppresses the whole method (conservative — keeps
// false positives low on this high-severity rule). Matched against whitespace-
// stripped text, so `WITH USER_MODE`→`user_mode`, `insert as user`→`asuser`.
const AGNOSTIC_GUARD_RE = /stripinaccessible|security_enforced|user_mode|asuser/;

/**
 * Object-naming guard for a specific SObject, e.g. `Schema.sObjectType.Contact.isUpdateable()`
 * or FLS `…Contact.fields.Name.isCreateable()`. Built per-object so a guard on
 * Account does not silence DML on Contact. Matched on whitespace-stripped, lowercased text.
 */
function objectGuardRe(sobject: string): RegExp {
  const obj = sobject.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${obj}[a-z0-9_.()\\[\\],]{0,80}is(createable|updateable|deletable|accessible|upsertable)`);
}

/** Strip List<...>, Set<...>, X[] down to the inner SObject name. */
function innerType(typeText: string): string {
  const generic = typeText.match(/^(?:List|Set|Iterable)\s*<\s*([A-Za-z_][\w.]*)\s*>$/i);
  if (generic) return generic[1];
  return typeText.replace(/\[\]$/, "");
}

/** Find the DML target's declared type from locals or formal params in the method. */
function resolveTargetType(dmlNode: any, varName: string): string | undefined {
  const method = enclosingMethod(dmlNode);
  if (!method) return undefined;
  let found: string | undefined;
  walk(method, (n) => {
    if (found) return;
    const t = nodeType(n);
    if (t === "LocalVariableDeclarationContext") {
      const typeText = n.typeRef ? textOf(n.typeRef()) : "";
      const decls = n.variableDeclarators ? n.variableDeclarators() : null;
      const list = decls?.variableDeclarator ? decls.variableDeclarator() : [];
      const arr = Array.isArray(list) ? list : list ? [list] : [];
      for (const d of arr) {
        const name = d.id ? textOf(d.id()) : "";
        if (name === varName) found = typeText;
      }
    } else if (t === "FormalParameterContext") {
      const name = n.id ? textOf(n.id()) : "";
      if (name === varName) found = n.typeRef ? textOf(n.typeRef()) : "";
    }
  });
  return found ? innerType(found) : undefined;
}

/** Pull the SObject name a DML statement acts on, or undefined. */
function dmlSObject(dmlNode: any): string | undefined {
  // operand is child index 1 (after the verb keyword). Note: getText() returns
  // tokens concatenated with NO whitespace, e.g. "newAccount()" or "accs".
  const operand = dmlNode.getChildCount() > 1 ? dmlNode.getChild(1) : null;
  const text = operand ? textOf(operand) : "";

  // Creator: `new <Type>(` / `new List<Inner>{` / `new Inner[]{`. Require a
  // bracket so a variable merely named "newRecords" isn't misread as a creator.
  const creator = text.match(/^new([A-Za-z_][\w.]*?)[([<{]/);
  if (creator) {
    const t = creator[1];
    if (/^(List|Set|Iterable)$/i.test(t)) {
      const inner = text.match(/<\s*([A-Za-z_][\w.]*)/);
      return inner ? inner[1] : undefined;
    }
    return innerType(t);
  }

  // Otherwise it's a variable/parameter reference — resolve its declared type.
  const ident = text.match(/^([A-Za-z_]\w*)/);
  if (!ident) return undefined;
  return resolveTargetType(dmlNode, ident[1]);
}

export const unguardedCrudOperation: Rule = {
  id: "UnguardedCrudOperation",
  category: "security",
  severity: "high",
  needsMetadata: true,
  description: "DML on an SObject without a CRUD/FLS access check (heuristic).",
  create(ctx) {
    let inTestClass = false;
    const check = (node: any) => {
      if (inTestClass) return;
      const sobject = dmlSObject(node);
      if (!sobject) return;
      // The seam: only proceed if metadata confirms this is a real SObject.
      if (!ctx.metadata.hasObject(sobject)) return;
      const method = enclosingMethod(node);
      const scope = (method ? textOf(method) : ctx.source).toLowerCase();
      // Object-agnostic guard anywhere in the method → suppress (conservative).
      if (AGNOSTIC_GUARD_RE.test(scope)) return;
      // Otherwise require a CRUD/FLS guard that names THIS SObject.
      if (objectGuardRe(sobject).test(scope)) return;
      ctx.report(
        node,
        `DML on ${sobject} without a CRUD/FLS check (e.g. Schema.sObjectType.${sobject}.isCreateable() or WITH USER_MODE).`,
      );
    };
    const listener: Record<string, (n: any) => void> = {
      ClassDeclarationContext: (node) => {
        if (nodeType(node.parentCtx) === "TypeDeclarationContext") {
          inTestClass = isTestClass(node);
        }
      },
    };
    for (const t of DML_CONTEXTS) listener[t] = check;
    return listener;
  },
};
