# Typed AST Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `any`-typed parse-tree nodes in rule handlers and the AST helpers with the parser's generated context types, so the compiler catches node-shape mistakes.

**Architecture:** A new `ast/contexts.ts` re-exports the parser's generated context classes (the single seam to `@apexdevtools/apex-parser`). Rules opt into typing by annotating handler/walk-callback/helper params with those types — annotations are assignable to the still-loose shared `RuleListener`/`walk`/`report` signatures, so each file migrates independently and stays green. The shared signatures are tightened to the typed forms in the final task, once every consumer is already typed-compatible.

**Tech Stack:** TypeScript strict, `@apexdevtools/apex-parser@5.0.0` (ships full `.d.ts`), `node:test` via `tsx`, pnpm.

## Global Constraints

- TypeScript strict. The goal is to REMOVE `any` from parse-tree node positions — never satisfy `tsc` by re-widening to `any`.
- Context types are imported ONLY from `../ast/contexts.js` (never from `@apexdevtools/apex-parser` directly — that boundary is the whole point). The sole exception is `ast/contexts.ts` itself.
- ESM `.js` import extensions. `import type { … }` for type-only imports.
- `nodeType(node)` (constructor name) drives dispatch and narrowing; `textOf(node)` is whitespace-stripped. Both from `ast/walk.js`.
- ANTLR **null-fidelity caveat:** generated accessors are typed non-null (`whereClause(): WhereClauseContext`) but return `null` at runtime when absent. Always truthy-check (`if (n.whereClause())`); never chain off an accessor as if guaranteed.
- Tests: `npx tsx --test <file>`; whole suite `pnpm test` (122 at start). Type-check: `npx tsc --noEmit -p packages/apex-core/tsconfig.json`.
- **Behavior baseline (the scan-diff gate):** a full scan of `test-data/` yields **17,137 violations**. Capture per-rule counts before Task 2 and after every rule-migration task; the total and every per-rule count MUST stay identical (`node packages/apex-lint-cli/dist/cli.js test-data --format json`). Build the CLI first (`pnpm build`) since the scan runs the built dist.
- Commit after each task.

### THE MIGRATION RECIPE (apply to the rule file named in each Task 2–9)
1. Add `import type { … } from "../ast/contexts.js"` for every context type this file's handlers and casts use.
2. For each listener handler `XxxContext: (node) => {…}`, annotate the param to the same-named type: `XxxContext: (node: XxxContext) => {…}`.
3. For each `walk(x, (n) => {…})`, annotate the callback `(n: AstNode) => {…}`. Inside, before using a context-specific accessor, narrow: `if (nodeType(n) === "FooContext") { const f = n as FooContext; … }` (or cast directly where surrounding logic already guarantees the type).
4. Type every rule-local helper param `(x: any)` → `(x: AstNode)` (or a specific context if all call sites pass one).
5. Run `tsc --noEmit`. Fix EVERY error in this file with the correct accessor or a narrowing cast — never `any`. A real accessor mismatch is a latent bug: fix the logic; the scan-diff confirms no behavior change.
6. **Gate:** `tsc` clean (project-wide — annotations are assignable to the loose shared types, so other files are unaffected), `pnpm test` green, scan-diff unchanged for this file's rules.

---

### Task 1: The typing seam — `ast/contexts.ts`

**Files:**
- Create: `packages/apex-core/src/ast/contexts.ts`

**Interfaces:**
- Produces: `AstNode` (= `ParserRuleContext`); the 13 dispatched context types + cast-only context types; `interface ContextMap`; `type RuleListener` (typed mapped — exported but not wired into `types.ts` until Task 10).

- [ ] **Step 1: Verify the `ParserRuleContext` export path**

Run: `node -e "import('@apexdevtools/apex-parser').then(m => console.log('ParserRuleContext' in m, 'QueryContext' in m))"`
Expected: prints `true true`. If the first is `false`, `ParserRuleContext` is not root-exported — in Step 2 import it from `antlr4` instead (`import type { ParserRuleContext } from "antlr4";`); everything else stays.

- [ ] **Step 2: Write `ast/contexts.ts`**

```ts
// The ONLY module in apex-core that imports the parser's generated types.
// Rules import context types from HERE, never from @apexdevtools/apex-parser —
// preserving the "parser is wrapped, never imported by rules" boundary.
//
// NULL-FIDELITY CAVEAT: ANTLR accessors are typed non-null (e.g.
// `QueryContext.whereClause(): WhereClauseContext`) but return null at runtime
// when the clause is absent. Always truthy-check (`if (n.whereClause())`);
// never chain off an accessor as if it were guaranteed non-null.
import type {
  ParserRuleContext,
  AnnotationContext,
  CatchClauseContext,
  ClassBodyDeclarationContext,
  ClassDeclarationContext,
  ConstructorDeclarationContext,
  DotExpressionContext,
  LiteralContext,
  MethodCallExpressionContext,
  MethodDeclarationContext,
  ModifierContext,
  NewExpressionContext,
  QueryContext,
  VariableDeclaratorContext,
  InsertStatementContext,
  UpdateStatementContext,
  DeleteStatementContext,
  UpsertStatementContext,
  UndeleteStatementContext,
} from "@apexdevtools/apex-parser";

/** The typed parse-tree base. Carries parentCtx, start, stop, getChild, getChildCount, getText. */
export type AstNode = ParserRuleContext;

// Re-export every context type rules reference (dispatched + cast-only). Add to
// this list when a rule needs a context not yet here (tsc will tell you).
export type {
  AnnotationContext,
  CatchClauseContext,
  ClassBodyDeclarationContext,
  ClassDeclarationContext,
  ConstructorDeclarationContext,
  DotExpressionContext,
  LiteralContext,
  MethodCallExpressionContext,
  MethodDeclarationContext,
  ModifierContext,
  NewExpressionContext,
  QueryContext,
  VariableDeclaratorContext,
  // DML statement contexts — dispatched on directly (loops.ts / crud.ts / async.ts):
  InsertStatementContext,
  UpdateStatementContext,
  DeleteStatementContext,
  UpsertStatementContext,
  UndeleteStatementContext,
  // cast-only (used inside walk callbacks / accessor chains):
  WhereClauseContext,
  LimitClauseContext,
  IdContext,
  TypeRefContext,
  BlockContext,
  LocalVariableDeclarationContext,
  VariableDeclaratorsContext,
  FormalParameterContext,
} from "@apexdevtools/apex-parser";

/** Closed map: listener key name → its context type. The keys are the exhaustive
 *  set of context types rules dispatch on. */
export interface ContextMap {
  AnnotationContext: AnnotationContext;
  CatchClauseContext: CatchClauseContext;
  ClassBodyDeclarationContext: ClassBodyDeclarationContext;
  ClassDeclarationContext: ClassDeclarationContext;
  ConstructorDeclarationContext: ConstructorDeclarationContext;
  DotExpressionContext: DotExpressionContext;
  LiteralContext: LiteralContext;
  MethodCallExpressionContext: MethodCallExpressionContext;
  MethodDeclarationContext: MethodDeclarationContext;
  ModifierContext: ModifierContext;
  NewExpressionContext: NewExpressionContext;
  QueryContext: QueryContext;
  VariableDeclaratorContext: VariableDeclaratorContext;
  InsertStatementContext: InsertStatementContext;
  UpdateStatementContext: UpdateStatementContext;
  DeleteStatementContext: DeleteStatementContext;
  UpsertStatementContext: UpsertStatementContext;
  UndeleteStatementContext: UndeleteStatementContext;
}

/** Typed rule listener — each handler receives its context type. Wired into
 *  engine/types.ts in the final task. */
export type RuleListener = { [K in keyof ContextMap]?: (node: ContextMap[K]) => void };
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit -p packages/apex-core/tsconfig.json`
Expected: clean. If a re-exported name (e.g. `BlockContext`) doesn't exist, tsc errors `Module has no exported member` — remove/rename it (verify the real name in `node_modules/.pnpm/@apexdevtools+apex-parser@5.0.0/node_modules/@apexdevtools/apex-parser/dist/src/antlr/ApexParser.d.ts`).

- [ ] **Step 4: Commit**

```bash
git add packages/apex-core/src/ast/contexts.ts
git commit -m "feat(ast): contexts.ts — typed parse-tree seam (AstNode, ContextMap, RuleListener)"
```

---

### Task 2: Type `ast/walk.ts` helpers (non-breaking)

**Files:**
- Modify: `packages/apex-core/src/ast/walk.ts`

**Interfaces:**
- Consumes: `AstNode` from `ast/contexts.js`.
- Produces: helpers typed `AstNode` for scalar helpers; `walk` keeps `visit: (n: AstNode) => void` but its `node` param becomes `AstNode`.

These changes are non-breaking: `any` arguments stay assignable to `AstNode`, and `(n) => …` callbacks are inferred `AstNode` (rules already treat walk nodes generically + cast). If any current caller breaks, that caller's fix belongs to its own Task 3–9 — so do this task FIRST and let tsc reveal which files need follow-up (expected: none, because rule walk-callbacks are migrated in their own tasks; if a callback uses a specific accessor un-narrowed, temporarily leave walk's `visit` as `(n: any)` and tighten it in Task 10 instead).

- [ ] **Step 1: Edit signatures**

In `ast/walk.ts` add `import type { AstNode } from "./contexts.js";` and change every `any` node position to `AstNode`:
`nodeType(node: AstNode)`, `lineOf/columnOf/endLineOf(node: AstNode)`, `textOf(node: AstNode)`, `walk(node: AstNode, visit: (n: AstNode) => void)`, `isInsideLoop(node: AstNode)`, `ancestorOfType(node: AstNode, typeName: string): AstNode | undefined`, `enclosingMethod(node: AstNode): AstNode | undefined`. Keep all bodies identical.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p packages/apex-core/tsconfig.json`
Expected: errors ONLY inside rule files that use a specific accessor in a walk callback (those are fixed in their own tasks). If the error count is large or in non-rule files, revert `walk`'s `visit` to `(n: any) => void` (keep the rest typed) and note that Task 10 tightens it.

- [ ] **Step 3: Tests + commit**

Run: `pnpm test` → 122 pass.
```bash
git add packages/apex-core/src/ast/walk.ts
git commit -m "refactor(ast): type walk.ts helpers to AstNode"
```

*(If Step 2 showed rule-file errors that block `pnpm test`/build, do this task's commit together with Task 3 — i.e. keep `walk`'s `visit` as `(n: any)` here and tighten in Task 10. Prefer the non-breaking path.)*

---

### Task 3: Migrate `loops.ts` + `hardcoded.ts`

**Files:**
- Modify: `packages/apex-core/src/rules/loops.ts` (handlers: SoqlInLoop/DmlInLoop on their loop/DML contexts), `packages/apex-core/src/rules/hardcoded.ts` (handlers: `ClassDeclarationContext`, `LiteralContext`).

Apply THE MIGRATION RECIPE to both files. Handler keys to annotate: in `hardcoded.ts`, `ClassDeclarationContext` and `LiteralContext`; in `loops.ts`, its single handler key. Known hotspot: none beyond base-method use. `loops.ts` has one `: any` helper param → `AstNode`.

- [ ] **Step 1:** Apply recipe steps 1–4 to both files.
- [ ] **Step 2:** `npx tsc --noEmit -p packages/apex-core/tsconfig.json` → clean.
- [ ] **Step 3:** `pnpm test` → 122 pass.
- [ ] **Step 4:** Build + scan-diff:
```bash
pnpm build
node packages/apex-lint-cli/dist/cli.js test-data --rules SoqlInLoop,DmlInLoop,AvoidHardcodedId --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).violationCount))'
```
Expected: equals the pre-task count for those rules (compare to baseline-counts).
- [ ] **Step 5:** Commit `git commit -am "refactor(rules): type loops + hardcoded handlers"`.

---

### Task 4: Migrate `async.ts`

**Files:** Modify `packages/apex-core/src/rules/async.ts`.

Apply THE MIGRATION RECIPE. 6 handler keys, 2 `walk` callbacks, 2 `: any` helper params. Hotspots: `hasAnnotation`/`isTestMethod` already imported from `ast/apex-helpers.js` (leave); the `DotExpressionContext`/`MethodCallExpressionContext` handlers use `textOf` (base) — straightforward; `collectFutureMethods` walk callback needs `(n: AstNode)` + cast where it reads method names.

- [ ] **Step 1:** Recipe steps 1–4. **Step 2:** tsc clean. **Step 3:** `pnpm test` 122. **Step 4:** scan-diff `--rules AvoidFutureAnnotation,FutureMethodChaining,TriggerInlineLogic` unchanged. **Step 5:** commit `"refactor(rules): type async handlers"`.

---

### Task 5: Migrate `crud.ts`

**Files:** Modify `packages/apex-core/src/rules/crud.ts`.

Apply THE MIGRATION RECIPE. 1 handler (`ClassDeclarationContext`) + the DML-context handlers registered in a loop (`InsertStatementContext` etc. — these keys are NOT in `ContextMap`; see note). 1 `walk`, 4 `: any` params. Hotspots: `resolveTargetType` walks and reads `n.typeRef()`, `n.id()`, `n.variableDeclarators()` after `nodeType` checks for `LocalVariableDeclarationContext`/`FormalParameterContext` — narrow with casts to those types (import them from contexts.js); `dmlSObject(dmlNode: AstNode)`.

**Note on loop-registered handlers:** crud registers DML handlers via `listener[t] = check` where `t` ranges over `InsertStatementContext`/…/`UndeleteStatementContext`. Those keys are already in `ContextMap` (added in Task 1). Type `check(node: AstNode)` to the base — the DML statement contexts only need base methods + `getChild`. The loop assignment `listener[t] = check` assigns an `(node: AstNode) => void` to typed-map keys whose value type is `(node: InsertStatementContext) => void` etc.; if the mapped `RuleListener` (after Task 10) rejects this, narrow the index: `(listener as Record<string, (n: AstNode) => void>)[t] = check` at the assignment site only (the loop builds the listener dynamically — this single cast is the documented exception, not a re-widening of a handler body).

- [ ] **Step 1:** Recipe steps 1–4 on crud.ts (DML contexts already in the map). **Step 2:** tsc clean. **Step 3:** `pnpm test` 122. **Step 4:** scan-diff `--rules UnguardedCrudOperation` unchanged (needs `--metadata-root`; use the same invocation as baseline). **Step 5:** commit `"refactor(rules): type crud handlers"`.

---

### Task 6: Migrate `performance.ts`

**Files:** Modify `packages/apex-core/src/rules/performance.ts`.

Apply THE MIGRATION RECIPE. 6 handlers, 2 walks, 3 `: any`. The in-loop rules dispatch on `QueryContext`/`DotExpressionContext`/DML contexts and detect loops via `isInsideLoop(node)` (which walks parents) — they do NOT dispatch on `ForStatementContext`/`WhileStatementContext` directly, so no new ContextMap entries are expected. If `tsc` flags a handler key not in `ContextMap`, add that one entry to contexts.ts (re-export + `ContextMap`). Hotspot: `AvoidNonRestrictiveQueries`'s `QueryContext` handler uses `node.whereClause()`/`node.limitClause()` — now typed; keep the truthy checks (null-fidelity caveat).

- [ ] **Step 1:** Recipe 1–4. **Step 2:** tsc clean (add a ContextMap entry only if tsc demands it). **Step 3:** `pnpm test` 122. **Step 4:** scan-diff `--rules SoqlInLoop,DmlInLoop,SoqlInBatchExecute,HttpCalloutInLoop,SystemDebugInLoop,AvoidNonRestrictiveQueries` unchanged. **Step 5:** commit `"refactor(rules): type performance handlers"`.

---

### Task 7: Migrate `design.ts`

**Files:** Modify `packages/apex-core/src/rules/design.ts`.

Apply THE MIGRATION RECIPE. 7 handlers, 2 walks, 6 `: any` params (the most helper-typing). Hotspots: complexity rules walk method bodies counting nodes — callbacks `(n: AstNode)`, base-method/`nodeType` only; `unusedPrivateMethod` walks for call expressions (uses `textOf` + `matchAll`, base) and reads `mDecl` method `.id()` (cast to `MethodDeclarationContext`).

- [ ] **Step 1:** Recipe 1–4. **Step 2:** tsc clean. **Step 3:** `pnpm test` 122. **Step 4:** scan-diff `--rules TriggerInlineLogic,CyclomaticComplexity,CognitiveComplexity,AvoidDeeplyNestedIfStmts,ExcessiveParameterList,ExcessivePublicCount,TooManyFields,UnusedPrivateMethod` unchanged. **Step 5:** commit `"refactor(rules): type design handlers"`.

---

### Task 8: Migrate `nre.ts`

**Files:** Modify `packages/apex-core/src/rules/nre.ts`.

Apply THE MIGRATION RECIPE. 12 handlers (mostly `DotExpressionContext`/`QueryContext`/`VariableDeclaratorContext`/`MethodDeclarationContext`), 1 walk, 3 `: any`. Hotspots: `VariableDeclaratorContext` handlers read `.id()`, `.expression()`, `.parentCtx?.parentCtx?.typeRef()` — `.id()`/`.expression()` are on `VariableDeclaratorContext` (typed); for the `parentCtx.parentCtx` chain cast to `LocalVariableDeclarationContext` before `.typeRef()`. `TriggerContextNullAccess` uses `ctx.filePath`/`ctx.source` (no node typing). Keep truthy checks.

- [ ] **Step 1:** Recipe 1–4. **Step 2:** tsc clean. **Step 3:** `pnpm test` 122 (the nre suite is the biggest guard). **Step 4:** scan-diff `--rules MapGetWithoutNullCheck,SoqlResultIndexWithoutCheck,TriggerContextNullAccess,ChainedRelationshipAccess,SoqlResultNotNullChecked` unchanged (note `MapGetResultNotNullChecked` is opt-in — also check it via `--rules MapGetResultNotNullChecked`). **Step 5:** commit `"refactor(rules): type nre handlers"`.

---

### Task 9: Migrate `style.ts` and `security.ts`

**Files:** Modify `packages/apex-core/src/rules/style.ts` (15 handlers, 3 walks) and `packages/apex-core/src/rules/security.ts` (4 handlers, 4 walks, 9 `: any` — the most).

Apply THE MIGRATION RECIPE to each. style hotspots: `EmptyCatchBlock` `node.block()` → cast result usage is base (`getChildCount`); `methodNamingConventions` reads `.id()` on `MethodDeclarationContext` (typed). security hotspots: the taint sink handlers walk method bodies (`(n: AstNode)`, base + `textOf`); `apexSharingViolations` `classHasDmlOrSoql` dfs over `getChild` (base); `typeHasSharing` reads class `parentCtx` modifiers (base + nodeType). Note `security.ts` imports `stripStringLiterals`/`hasWordRef` from `engine/taint.js` and `isInsideTestClass` from `ast/apex-helpers.js` — leave those.

- [ ] **Step 1:** Recipe 1–4 on `style.ts`; tsc; `pnpm test`; scan-diff style rules unchanged; commit `"refactor(rules): type style handlers"`.
- [ ] **Step 2:** Recipe 1–4 on `security.ts`; tsc; `pnpm test`; scan-diff security rules unchanged; commit `"refactor(rules): type security handlers"`.

---

### Task 10: Tighten the shared signatures

**Files:**
- Modify: `packages/apex-core/src/engine/types.ts`, `packages/apex-core/src/engine/engine.ts`, `packages/apex-core/src/ast/walk.ts` (if `visit` was left `any` in Task 2).

**Interfaces:**
- Consumes: `RuleListener`, `AstNode` from `ast/contexts.js`. All rules already annotate handlers with `ContextMap` types.

- [ ] **Step 1: Flip `RuleListener` and `report`**

In `engine/types.ts`: `import type { RuleListener } from "../ast/contexts.js";` and re-export it (`export type { RuleListener };`), removing the local `export type RuleListener = Record<string, ((node: any) => void) | undefined>;`. Change `report(node: any, …)` → `report(node: AstNode, …)` (`import type { AstNode } from "../ast/contexts.js";`).

- [ ] **Step 2: Add the engine dispatch cast**

In `engine/engine.ts`, the walk dispatch invokes a handler with a node typed `AstNode`; the handler expects its specific context. Cast once at the call site:
```ts
const handler = listener[t as keyof typeof listener] as ((n: AstNode) => void) | undefined;
if (handler) handler(node);
```
(This is the one controlled cast; sound because `t === node.constructor.name`.)

- [ ] **Step 3: Tighten `walk`'s visit** (if left `any` in Task 2): set `visit: (n: AstNode) => void`.

- [ ] **Step 4: Type-check — must be fully clean with zero `any` node positions**

Run: `npx tsc --noEmit -p packages/apex-core/tsconfig.json` → clean. If it flags an "excess property" / "no overload matches" on a rule's listener for a handler key not in `ContextMap`, that key is a dispatched context the map is missing — add the one-line entry to `ContextMap` and the re-export in `contexts.ts`, re-run. This gate is the backstop that guarantees `ContextMap` is exhaustive.
Run: `grep -rnE "node: any|\(n: any\)|tree: any" packages/apex-core/src/rules packages/apex-core/src/ast packages/apex-core/src/engine` → no matches in handler/helper node positions (parser.ts `tree: any` on `ParsedUnit` may remain — out of scope; confirm only that.)

- [ ] **Step 5: Full gate**

Run: `pnpm test` → 122 pass. `pnpm build` → Done.
Run the full scan-diff: `node packages/apex-lint-cli/dist/cli.js test-data --format json` → total **17,137**, and a per-rule diff vs the captured baseline shows **zero change**.

- [ ] **Step 6: Commit**

```bash
git add packages/apex-core/src/engine/types.ts packages/apex-core/src/engine/engine.ts packages/apex-core/src/ast/walk.ts
git commit -m "refactor(engine): tighten RuleListener/report/walk to typed AstNode — eliminate node: any"
```

---

## Self-review notes
- **Spec coverage:** contexts.ts seam + AstNode + ContextMap + RuleListener (T1); typed walk/report/engine (T2, T10); per-rule typed handlers + ~30 accessor sites (T3–T9); null-fidelity caveat documented in contexts.ts (T1) and Global Constraints; closed-map "add an entry" handled (T5/T6 add dispatched statement/loop contexts the grep missed); triple gate on every task; subagent-driven one-file-per-task ordering simple→complex (T3 loops/hardcoded → T9 style/security). All §1–§8 spec points map to a task.
- **Sequencing correctness:** shared signatures stay loose through T1–T9 (annotations are assignable), tightened only in T10 — so every task is green. T2 carries an explicit fallback (leave `walk.visit` as `any`, tighten in T10) if early tightening breaks unmigrated files.
- **Scan-diff baseline:** 17,137; captured before T3, checked per task, full diff in T10.
- **Type consistency:** every handler key annotated to the same-named `ContextMap` type; cast-only contexts (`WhereClauseContext`, `LocalVariableDeclarationContext`, etc.) imported from contexts.ts; `AstNode` = `ParserRuleContext` used uniformly for base/walk/report.
