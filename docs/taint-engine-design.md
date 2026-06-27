# Taint Engine — Design Spec

**Date:** 2026-06-27
**Status:** Approved for planning
**Scope:** `packages/apex-core` — taint analysis used by the 4 security sink rules.

## 1. Goal & non-goals

**Goal.** Replace the per-rule, text-heuristic taint logic in `security.ts` with a single shared, AST-based **taint-tracking** engine that is computed once per method and consumed by all sink rules. Priority is **effectiveness (precision + recall) over raw speed**, with a **recall-favoring** bias: when uncertain, flag.

**Why.** The current `buildTaintedVars` is:
- recomputed 4× per method (once per sink rule);
- propagated partly by `textOf(method).split(";")` + regex — fragile (the escaped-quote and inline-concat FNs we fixed were symptoms of this text-first approach, and `;` inside `for(;;)` breaks statement boundaries);
- missing the modern attack surface: `@AuraEnabled`/`webservice`/REST method **parameters** are not sources.

**Non-goals.**
- **No inter-procedural / whole-program analysis.** Industry default (Semgrep, CodeQL local) is intra-procedural — *"easier, faster, and more precise."* The graph-database path-based approach (Salesforce Graph Engine) is heavyweight and has been retired; we explicitly avoid it.
- No change to the rule IDs, severities, categories, or report messages' intent.
- No new public API outside `apex-core`.

## 2. Model (source / propagator / sanitizer / sink)

Standard taint-tracking model. Critically, this is **taint tracking, not value-only data flow**: non-value-preserving steps — above all **string concatenation** — propagate taint, because SOQL injection *is* concatenation (`'… = ' + userInput`).

| Element | Definition |
|---|---|
| **Source** | An expression or parameter whose value is user-controlled. |
| **Propagator** | A step that carries taint from input to output: assignment, `+`/concatenation, `String.format`/`String.join`, collection `get/add`. |
| **Sanitizer** | A construct that provably neutralizes taint for SOQL. |
| **Sink** | A call where tainted data is dangerous (per rule). |

### Sources
- **Expression sources** (kept from today): `ApexPages.currentPage().getParameters()` / `.get(...)`, `System.currentPageReference().getParameters()`, `RestContext.request` (`.params`, `.requestBody`, broadly), `Cookie.getValue(...)`, `URL.getCurrentRequestUrl(...)`.
- **Entry-point parameters** (new, recall-first): every formal parameter of any method whose modifiers include **`public`, `global`, or `webservice`**. This deliberately covers the whole externally-reachable surface — controllers, services, and the remote forms (`@AuraEnabled`/`webservice`/REST/`@InvocableMethod` methods are public or global, so they are included as a subset). **All parameter types** seed (not just `String`): `Id`, `Object`, `List<…>`, `Map<…>`, sObject — any can carry injectable content. Methods with no access modifier (effectively private) and `private`/`protected` methods do **not** seed. Per the "recall all public and global methods" directive; will surface safe-by-construction findings — accepted.
- **Recall bias (Semgrep `exact:false` semantics):** a source taints not just the exact match but the **subexpression** it appears in.

### Propagators
Taint flows LHS←RHS when the RHS *references* a tainted name in any detectable form. Explicit propagators beyond bare assignment: `+`/concatenation, `String.format(fmt, args)`, `String.join(coll, sep)`, and collection element access (`list.get`, `map.get`) / population (`add`, `put`). When in doubt about whether a call propagates, **assume it does** (recall).

### Sanitizers (the ONLY auto-suppressions)
- `String.escapeSingleQuotes(...)` wrapping the tainted value.
- SOQL **bind variables** — a tainted value referenced as `:var` inside a query string literal is parameterized and safe (preserved via escape-aware literal stripping).
- **Any other / unrecognized wrapping call does NOT clear taint** (recall). We only suppress what we can prove safe.

### Sinks (one per rule)
| Rule | Sink | Severity |
|---|---|---|
| `ApexSOQLInjection` | `Database.query(` / `Database.queryWithBinds(` | critical |
| `ApexOpenRedirect` | `new PageReference(` / `.setRedirect(` | high |
| `ApexSSRF` | `HttpRequest.setEndpoint(` | high |
| `ApexXSSFromURLParam` | `new ApexPages.Message(` / `addError(…, false)` | high |

A sink fires when a tainted name appears **anywhere inside** the sink's argument expression (recall), after escape-aware literal stripping so field names / `:binds` inside the query string don't match.

## 3. Architecture

```
engine/taint.ts                     (new — owns taint)
  computeTaint(methodOrCtorNode) -> TaintResult   // pure, AST-based
  getTaint(node) -> TaintResult                   // cached, WeakMap-backed
  isEntryPoint(methodNode) -> bool
  SOURCES / PROPAGATORS / SANITIZERS              // shared constants

rules/security.ts                   (thinner)
  apexSOQLInjection / apexOpenRedirect / apexSSRF / apexXSSFromURLParam
    -> each: on sink node, look up getTaint(enclosingMethod), check arg
```

- **`TaintResult = { tainted: Set<string>, isEntryPoint: boolean }`** — variable names are lowercased.
- **Caching.** The engine does NOT live on the rule context: in `engine.ts` each rule gets its **own** `RuleContext`, so a per-`ctx` cache would not be shared. Instead the engine module holds a **module-level `WeakMap<methodNode, TaintResult>` keyed by parse-node identity**. `getTaint(node)` returns the cached result or computes and stores it. Because all 4 rules call `getTaint` with the *same* method node from the one shared tree walk, the first rule computes and the other three hit the cache. Nodes are unique per parse and garbage-collected with the tree, so the map needs no manual clearing and a re-`lint()` of the same source (new nodes) never reads stale entries. `computeTaint` is pure over the node (uses `walk`/`textOf` only) — it needs no `ctx`.
- **The 4 rules become thin**: declare sink predicate + report message; call `getTaint(enclosingMethod(sinkNode))`.

## 4. Propagation algorithm (intra-procedural, AST-ordered)

1. **Seed** `tainted` from entry-point params + any source expressions visible at method entry.
2. **Forward pass** over statements in source order (walk `StatementContext`/declaration nodes; do not split text):
   - For each declaration (`VariableDeclaratorContext`) or assignment, resolve the LHS variable name from `.id()` (structural — no type-prefix confusion).
   - Evaluate the RHS: if it contains a source expression, or references a currently-tainted name (scan identifier nodes in the RHS subtree via `hasWordRef` on the RHS text with literals stripped), and is **not** wrapped by a sanitizer → mark LHS tainted.
3. **Second bounded pass** (≤1 extra) to catch a value used before its tainting assignment in source order (rare; covers simple back-edges/loops). Stop at fixed point. This replaces today's 5 full-walk+`textOf` passes.
4. Return `{ tainted, isEntryPoint }`.

Literal handling uses the escape-aware stripper (`/'(?:[^'\\]|\\.)*'/g`) so `\'` does not truncate a literal and drop the following tainted variable.

## 5. Performance

Effectiveness is the priority, but the shared cache yields a free speed win: taint is computed **1× per method instead of 4×**, and the per-method `textOf` is computed inside the engine once, not re-derived in 5 passes. Measured budget: the 4 taint rules add ~1.9 s on NPSP (1,070 files) today; target ≤ ~0.6 s. Parsing (~10.5 s) remains the dominant cost and is out of scope.

## 6. Testing

- **Unit — `tests/engine/taint.test.ts`:** each source kind seeds; each propagator carries taint (assignment, concat, `String.format`, `String.join`, collection get); `escapeSingleQuotes` and `:bind` clear taint; an **unrecognized wrapper does NOT** clear taint; params of `public`/`global`/`webservice` methods seed (incl. `@AuraEnabled`); **`private`/no-modifier method params do NOT** seed.
- **Per-rule sink — extend `tests/rules/security.test.ts`:** the existing 9 cases must still pass; add public/global-method-param → query cases (incl. an `@AuraEnabled` controller); add open-redirect / SSRF / XSS sink cases mirroring the SOQL ones.
- **Fixtures:** keep `fixtures/security-samples/SoqlInjectionSample.cls`; add a public-controller-param injection sample (`@AuraEnabled`).
- **Regression gate (12 test-data repos):** existing finding counts for the 4 rules must not *decrease* (no new FNs) and any *increase* must be sampled and confirmed to be genuine entry-point findings, not noise. `pnpm test` stays green.

## 7. Rollout

1. Add `engine/taint.ts` (engine + constants), with `getTaint` cache.
2. Port `apexSOQLInjection` to consume it; verify sample + tests + repo counts.
3. Port `apexOpenRedirect`, `apexSSRF`, `apexXSSFromURLParam` one at a time, each gated by tests + repo-count check.
4. Delete the old `buildTaintedVars` once all four are migrated.
5. Update `docs/code-review-findings.md` (H4/H7/H8 → resolved by the engine) and rule docs.

## 8. Risks & mitigations

- **More findings (recall mode + entry points)** → by design; mitigated by the auto-suppression of bind vars/`escapeSingleQuotes` and the per-increase sampling gate. Document that these 4 rules are higher-recall security signals.
- **AST node-shape assumptions** (`VariableDeclaratorContext.id()`, `FormalParameterContext`, annotation/modifier access, sink `ExpressionListContext`) → probe shapes against `@apexdevtools/apex-parser` first (as done for `whereClause()`), before porting.
- **Cache sharing across rules** must use a module-level node-keyed `WeakMap` (not per-rule closure state, and not the per-rule `ctx`), or the 4 rules won't share → covered in §3, verified by a test asserting `computeTaint` runs once per method when all 4 rules are active (e.g. via a call counter).
- **Regression in existing suppressions** (bind var safety) → the existing 9 security tests are the guard; they must stay green throughout.
