# Typed AST — Design Spec

**Date:** 2026-06-29
**Status:** Approved for planning
**Scope:** `packages/apex-core` — eliminate `tree: any` in the rule-authoring surface.

## 1. Goal & non-goals

**Goal.** Replace the untyped `any` parse-tree nodes that rule handlers receive with the parser's generated context types, so the TypeScript compiler catches node-shape mistakes (wrong accessor, typo on a base method) at build time — the class of bug we have been fixing one at a time (`whereClause()` vs substring, `.id()` on the wrong context, etc.).

**Why now.** `@apexdevtools/apex-parser@5.0.0` ships full `.d.ts` types: **191 generated `*Context` classes**, each with typed accessors (`QueryContext.whereClause(): WhereClauseContext`, `MethodDeclarationContext.formalParameters()`, …), all exported from the package root. So this is *not* a hand-written wrapper job — the types already exist; we wire them in.

**Non-goals.**
- No change to dispatch mechanism — stays `node.constructor.name` string-keyed (the minification fragility is documented, not fixed here; the CLI is not minified).
- No `instanceof` dispatch, no change to `ParsedUnit.tree`'s shape beyond typing it `AstNode`, no CLI changes.
- No behavior change of any kind — this is purely a typing refactor.

## 2. The seam: `ast/contexts.ts`

A new module is the **single** place in apex-core that imports the parser package's generated types, preserving the README principle "Parser is wrapped, never imported by rules."

It exports:
- The **13 dispatched context classes** (the listener keys): `AnnotationContext`, `CatchClauseContext`, `ClassBodyDeclarationContext`, `ClassDeclarationContext`, `ConstructorDeclarationContext`, `DotExpressionContext`, `LiteralContext`, `MethodCallExpressionContext`, `MethodDeclarationContext`, `ModifierContext`, `NewExpressionContext`, `QueryContext`, `VariableDeclaratorContext` — plus the few used only in casts (e.g. `WhereClauseContext`, `LimitClauseContext`, `IdContext`, `TypeRefContext`, `ExpressionContext`, `FormalParameterContext`).
- **`AstNode`** = `ParserRuleContext` — the typed base, carrying `parentCtx`, `start`, `stop`, `children`, `getChild`, `getChildCount`, and `getText()` (via its `RuleContext` base). If `@apexdevtools/apex-parser` does not re-export `ParserRuleContext` from its root, contexts.ts imports it from the parser's bundled `antlr4` dependency — isolated here so no other file references parser internals. (Verify the import path at implementation start.)
- **`ContextMap`** — a closed interface mapping each of the 13 listener-key names to its class type:
  ```ts
  export interface ContextMap {
    QueryContext: QueryContext;
    MethodDeclarationContext: MethodDeclarationContext;
    // …all 13…
  }
  ```
- **`RuleListener`** — the typed mapped type:
  ```ts
  export type RuleListener = { [K in keyof ContextMap]?: (node: ContextMap[K]) => void };
  ```

A rule using a context **not** in `ContextMap` is a compile error → add the entry (one line). The 13 are the complete current set (verified by grepping every listener key), so no current rule is affected by the closed map beyond getting typed nodes.

## 3. Typed surfaces

- **`ast/walk.ts`** — every helper takes/returns `AstNode` instead of `any`: `nodeType(n: AstNode)`, `textOf(n: AstNode)`, `lineOf`/`columnOf`/`endLineOf(n: AstNode)`, `walk(n: AstNode, visit: (n: AstNode) => void)`, `isInsideLoop`/`ancestorOfType`/`enclosingMethod(n: AstNode): AstNode | undefined`. Callers passing `any` (from `.id()` etc.) remain assignable; return types narrow from `any` to typed, which is safe.
- **`engine/types.ts`** — `RuleListener` becomes the `ContextMap` mapped type (imported from `ast/contexts.ts`); `RuleContext.report(node: AstNode, message, overrides?)`.
- **`engine/engine.ts`** — dispatch unchanged in behavior; the per-node invocation casts once: `(handler as (n: AstNode) => void)(node)`. This single controlled cast is sound because `node.constructor.name === K` guarantees `node` is a `ContextMap[K]` at runtime. It is the only `as`-cast the engine needs.
- **Rule files** — handlers receive typed nodes; the ~**30 specific-accessor sites** (`.id()` ×19, `.typeRef()` ×2, `.expression()` ×2, `.whereClause()`, `.limitClause()`, `.variableDeclarators()`, `.block()`) now type-check against the actual context. Rule-local helper params typed `any` become `AstNode` (or a specific context where the call site demands it).
- **`walk()` visitor callbacks** stay `(n: AstNode) => void` — `walk` visits every node type, so a rule that needs a specific accessor inside a walk narrows with a cast (`const q = n as QueryContext`) or an `instanceof`/`nodeType` check. This is expected and explicit.

## 4. The ANTLR null-fidelity caveat

The generated accessors are typed **non-null** (`whereClause(): WhereClauseContext`) but ANTLR returns `null`/`undefined` at runtime when the clause/child is absent. Typed code must therefore keep truthy-checking — `if (node.whereClause())` — and must never chain off a clause accessor as if guaranteed (`node.whereClause().foo` is unsafe). Existing rules already truthy-check; the migration preserves that. This caveat is documented at the top of `contexts.ts`.

## 5. Migration & gating

One coordinated migration — flipping `RuleListener` is global and cannot be half-typed. Order:
1. Add `ast/contexts.ts` (verify the `ParserRuleContext` import path first).
2. Type `ast/walk.ts` helpers and `RuleContext.report` to `AstNode`.
3. Flip `RuleListener` in `engine/types.ts` to the `ContextMap` mapped type; add the engine's single dispatch cast.
4. Fix the resulting `tsc` errors **one rule file at a time**. Most accessor sites already call the correct accessor — the compiler confirms it. A genuine mismatch surfaced by `tsc` is a latent bug, fixed carefully — **never** by re-widening to `any`.

**Triple gate per file (all required):**
- `npx tsc --noEmit -p packages/apex-core/tsconfig.json` — clean. This *is* the proof the typing holds; no `any` escape hatches.
- `pnpm test` — all green (122 at start).
- **12-repo scan-diff** — total stays **17,137** with **zero per-rule change** (captured baseline). Proves no behavior changed while satisfying the compiler.

## 6. Execution

Subagent-driven, **one rule file per task** (`loops`, `hardcoded`, `crud`, `async`, `performance`, `nre`, `design`, `style`, `security`), preceded by the infrastructure task (contexts.ts + walk + types + engine). Each task ends with the triple gate; a behavior regression is caught at the file that caused it. Order simplest→most-complex so the pattern is established on small files before `security.ts`/`nre.ts`.

## 7. Risks

- **A `tsc`-fix changes behavior** → the scan-diff gate catches it (must stay 17,137 / zero per-rule delta).
- **`ParserRuleContext` import path** (root vs bundled antlr4) → resolved in contexts.ts at step 1; isolated to the seam.
- **Non-null accessor returns** (§4) → keep truthy checks; do not chain off accessors.
- **A context type missing from `ContextMap`** → `tsc` error, add the one-line entry.
- **Scope creep into `any`-typed rule internals beyond the dispatch surface** → out of scope; type handler params, the ~30 accessor sites, walk/engine/report, and rule-local helper params only.

## 8. Success criteria

- No `any`-typed parse-tree node in rule handler signatures or the walk/engine helpers.
- `tsc --noEmit` clean across both packages.
- 122 tests green; 12-repo scan steady at 17,137, zero per-rule change.
- Adding a future rule that calls a non-existent accessor on a context is a compile error.
