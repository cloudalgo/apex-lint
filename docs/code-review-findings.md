# apex-lint — Code Review Findings

**Date:** 2026-06-27
**Scope:** 41 rules (`packages/apex-core/src/rules/`), engine/parser, CLI, ESLint integration, test/CI setup.
**Method:** Static review of all rule + infra files, plus a live scan of 10 public Salesforce repos in `test-data/` (2,069 Apex files) and targeted synthetic probes to cross-verify each claim.

The architecture is sound: one-walk ESLint-style dispatch, a clean metadata-provider seam, a thin parser wrapper. The problems cluster in three areas — **CI exit-code correctness**, **untested rules**, and **text-matching heuristics that fight the whitespace-stripped `textOf()` output**.

Each finding is tagged with its verification status:
- ✅ **Confirmed (empirical)** — reproduced by running the CLI/scanner.
- 🟡 **Corrected** — original claim was overstated; actual impact is narrower.
- ◽ **Confirmed (code read)** — verified by reading source; no runtime probe run.

---

## Cross-verification summary (live scan)

Scanned 4 freshly-cloned repos (`ebikes-lwc`, `fflib-apex-mocks`, `coral-cloud`, `streaming-monitor`) → **162 violations**:

| Count | Rule | Verdict |
|------:|------|---------|
| 80 | `TestWithoutAsserts` | **FP storm** — fires on mock-framework tests that assert via `mocks.verify(...)` (fflib). See C4. |
| 35 | `ApexUnitTestClassShouldHaveRunAs` | Plausible (style/best-practice noise). |
| 18 | `DebugsShouldUseLoggingLevel` | Plausible TPs. |
| 6 | `AvoidNonRestrictiveQueries` | Mostly TPs, but substring approach has a confirmed false-negative gap (C5). |
| 6 | `AvoidGlobalModifier` | Plausible. |
| … | (remainder long-tail) | — |

Synthetic probes confirmed the three CLI exit-code bugs and two rule-level defects below.

---

## Critical — fix first

> **Status (2026-06-27):** C1–C5 and H1–H2 addressed.
> - **C1–C3** fixed in `cli.ts` — value-flags bounds-checked, `--format`/`--fail-on` validated, top-level handler maps usage/tool errors to exit 2.
> - **C4** fixed in `style.ts` — `methodHasAssert` now recognizes mock-framework `.verify(...)`. Live scan FP count fell **80 → 8** (the 8 remainder are genuine: no-assert tests + a custom `fflib_System.assertEquals` wrapper).
> - **H1** fixed in `performance.ts` — `AvoidNonRestrictiveQueries` uses the parsed `whereClause()`/`limitClause()` nodes instead of substring matching.
> - **H2** fixed in `hardcoded.ts` — `AvoidHardcodedId` validates the 18-char checksum / 15-char zero-padding signature; the base64 and random-token FPs no longer fire.
> - **C5 (partial)** — added a `test` script (`pnpm test`, 73 tests) wired into CI and the publish workflow; added regression tests for C4/H1/H2 in `packages/apex-core/tests/rules/`.
> - Remaining open: H3–H6 and the Medium/architectural items.

### C1 ✅ `--fail-on` silently disables CI gating on bad input — **FIXED**
`packages/apex-lint-cli/src/cli.ts:66, 280-283`
`args.failOn` is cast unchecked; `SEV_RANK[failOn]` is `undefined` for an unknown value, so `v.severity >= undefined` is always `false` → **process exits 0**. A typo in a CI config silently turns the linter off.
**Reproduced:** `--fail-on bogus` on a file with 5 violations → `exit 0` (default → `exit 1`).
**Fix:** validate against the `Severity` set; exit 2 on unknown.

### C2 ✅ Invalid `--format` silently falls back to pretty — **FIXED**
`packages/apex-lint-cli/src/cli.ts:63`
`args.format = argv[++i] as Args["format"]` — no validation.
**Reproduced:** `--format xml` → pretty human output (a pipeline expecting SARIF/JSON gets garbage and never knows).
**Fix:** validate against `{pretty,json,sarif}`; exit 2 on unknown.

### C3 ✅ Trailing value-flag crashes with the wrong exit code — **FIXED**
`packages/apex-lint-cli/src/cli.ts:62-90`
Every value flag does `argv[++i].split(...)` with no bounds check.
**Reproduced:** `apex-lint Probe.cls --rules` → uncaught `TypeError`, Node stack trace, **exit 1** (CI reads exit 1 as "violations found", masking the real usage error which should be exit 2).
**Fix:** bounds-check after each `++i`; wrap `main()` in try/catch → stderr + `exit(2)`.

### C4 ✅ `TestWithoutAsserts` false-positive storm on mock frameworks
`packages/apex-core/src/rules/style.ts`
The rule recognizes `System.assert*` / `Assert.*` but **not** mock-framework verification. `fflib-apex-mocks` asserts behavior with `mocks.verify(mockList, mocks.times(2))…` — a valid, intentional assertion mechanism.
**Reproduced:** 80 of 162 scan violations were this rule; `fflib_AnyOrderTest.cls` (102 `verify`/assert calls) flagged on nearly every method.
**Fix:** make recognized assertion methods configurable (PMD's `additionalAssertMethodPattern` model) and include common mock verifiers (`mocks.verify`, `.verify(`, `System.assertEquals`, etc.).

### C5 ✅ No automated test gate; 36 of 41 rules untested
- No `test` script in any `package.json`; no test runner dependency.
- The existing `node:test` files import `../src/*.js` from outside each package's `rootDir: src` → **not runnable as written** and never invoked.
- CI (`.github/workflows/ci.yml`) runs build + `tsc --noEmit` + one fixture smoke-test only. `publish.yml` ships to npm with **no test gate**.
- Only `nre.ts` (5 rules) has tests. Every rule with a documented FP-fix history (`EmptyCatchBlock`, `ApexSOQLInjection`, `TestWithoutAsserts`, `MethodNamingConventions`, the three fixed in v0.1.17) has **zero regression guard**.
**Fix:** add a `test` script (`tsx`/`node --test`), wire it into CI, block `publish.yml` on it, backfill tests in fragility order (taint engine → `EmptyCatchBlock` → `TestWithoutAsserts` → `SoqlInLoop`/`DmlInLoop` → v0.1.17 fixes).

---

## High — rule correctness

### H0b ✅ `MapGetWithoutNullCheck` shared the same List-index FP — **FIXED**
`packages/apex-core/src/rules/nre.ts` (`hasInlineGetDereference`)
The sibling inline rule (moderate, **on by default**) flagged `list.get(0).Name` and `list.get(i).Name` as Map.get NRE risks. Confirmed via probe (all 3 of Map/List-literal/List-var flagged). Fixed by extracting the matched `.get()` argument and skipping when it is an integer index (reuses `isListIndexArg`). Broad scan 284 → 269; probe now flags only the genuine `Map.get(key).field`. Two contrived tests that used `m.get(i)` with `i` as an Id key were updated to a realistic key name (bare `i` is correctly treated as a List index). Regression test added.

### H0 ✅ `MapGetResultNotNullChecked` — three systematic FP classes + inherent noise — **FIXED / right-sized**
`packages/apex-core/src/rules/nre.ts`
Surfaced by a clean rebuild (the original review scan used a stale incremental `dist/`). A broad scan across all 10 test-data repos showed **724** hits (NPSP 630, EDA 83). Investigation found three fixable systematic false positives plus irreducible noise:
1. **List.get(variableIndex) misclassified as Map.get()** — the exclusion only caught literal numeric indices (`/\.get\(\d+\)/`); `list.get(i)`, `list.get(idx - 1)`, `list.get(randomIndex)` slipped through. Fixed by extracting each `.get()` argument and excluding when all are integer-index expressions. *(10 of the 11 hits on the 4 new repos.)*
2. **containsKey guard preceding the assignment** — the idiomatic `if (!m.containsKey(k)) return; T v = m.get(k);` was missed because the guard scan started at the assignment line. Fixed by scanning the enclosing method scope for a map-specific `containsKey`.
3. **keySet() iteration** — `for (k : m.keySet()) { v = m.get(k); v.f }` is guaranteed non-null; the sibling `MapGetWithoutNullCheck` already excluded it. Reused `isInKeySetLoop`.

Result: **724 → 465** (NPSP 630 → 385); the 4 new repos went **11 → 1** (the remaining one is a genuine TP). The residual ~465 are SObject.get(fieldName) mislabeled as Map.get, and genuinely-unguarded-but-safe-by-construction access — neither separable without type/dataflow analysis (this is why PMD ships no equivalent).

**Made opt-in (off by default).** Because the residual noise is irreducible, the rule no longer runs in the default rule set. A new `optIn?: boolean` flag on `Rule` (`engine/types.ts`) marks it; the CLI's `selectRules` runs opt-in rules only when the id is named explicitly via `--rules` (or `rules` in config), and `--list-rules` tags them `[opt-in]`. Severity also lowered **moderate → info** for when it is opted into an audit. The rule stays exported and registered (rule count unchanged), just dormant by default. Regression tests added in `tests/rules/nre.test.ts`.

Run it for a targeted audit with: `apex-lint <path> --rules MapGetResultNotNullChecked --fail-on info`.



### H1 ✅ `AvoidNonRestrictiveQueries` false-negative on field/object names containing `where`/`limit`
`packages/apex-core/src/rules/performance.ts:188`
`if (!q.includes("where") && !q.includes("limit"))` substring-matches the whole query text.
**Reproduced:** `SELECT Limit_Reached__c FROM Account` and `SELECT Whereabouts__c FROM Contact` (both genuinely unrestricted) → **not flagged**; control `SELECT Id FROM Account` → flagged. Any query selecting a field/object whose name contains those substrings escapes detection.
**Fix:** inspect the parse tree's structured `WHERE`/`LIMIT` clause nodes instead of substring-matching concatenated text.

### H2 ✅ `AvoidHardcodedId` false-positive on non-ID 15/18-char tokens
`packages/apex-core/src/rules/hardcoded.ts:21`
Matches any 15/18-char alphanumeric literal containing a digit.
**Reproduced:** `'a1b2c3d4e5f6g7h'` (random token) and `'YWJjZGVmZ2hpajEyMw'` (base64) → both flagged as "Hardcoded record ID". Real-world base64 tokens, hashes, and API strings will trip this.
**Fix:** validate the 3-char SF key-prefix against known object prefixes; for 18-char IDs verify the case-insensitivity checksum suffix.

### H3 ✅ CRUD guard scope is whole-method (false negatives) — **FIXED**
`packages/apex-core/src/rules/crud.ts`
Any `isCreateable`/`stripInaccessible`/`USER_MODE` anywhere in a method suppressed **every** DML on **every** object in it — a method guarding `Account` but doing unguarded DML on `Contact` passed silently (reproduced). Split guards into two kinds: object-naming guards (`isCreateable`-family, `Schema.sObjectType.X…`) must now reference the DML's specific SObject; object-agnostic guards (`stripInaccessible`, `USER_MODE`, `SECURITY_ENFORCED`, `as user`) still suppress method-wide since they can't be attributed to one object without dataflow (keeps FPs low on this high-severity rule). Also revived the dead `as user` guard (it was matched against whitespace-stripped text as `\bas user\b`, now `asuser`), removing FPs on user-mode DML. test-data steady at 17 (no new FPs); probe confirms the cross-object FN is now caught.

### H3b ✅ `UnguardedCrudOperation` never resolved local-variable DML targets — **FIXED**
`packages/apex-core/src/rules/crud.ts` (`resolveTargetType`)
Surfaced by the typed-AST migration: `resolveTargetType` called `variableDeclarator()` with no argument, which ANTLR returns `null` for — so the array of declarators was always empty and the rule could resolve the SObject type **only for formal-parameter DML**, never for local variables (`List<Account> accs = …; insert accs;`). The rule had been badly under-reporting. Fixed to use `variableDeclarator_list()`. **test-data `UnguardedCrudOperation` 17 → 152**; spot-checked new hits are genuine unguarded local-var DML (`update acc;`, `insert bookings;`). Added the rule's first 2 tests (local-var flagged; object-specific guard suppresses). Full-scan baseline shifted 17,164 → 17,299.

### H7 ✅ `ApexSOQLInjection` missed the canonical escaped-quote pattern — **FIXED; taint superseded by shared engine**
`packages/apex-core/src/rules/security.ts` (`stripStringLiterals`)
The Medium "escaped quotes" item, shown to have real security impact. `stripStringLiterals` used `/'[^']*'/g`, which treats Apex's escaped quote `\'` as a terminator — so on `Database.query('… = \'' + userInput + '\'')` (the most common injection form) it stripped the tainted variable away and the critical rule **missed it**. Fixed with an escape-aware regex `/'(?:[^'\\]|\\.)*'/g`. Verified on a sample (`fixtures/security-samples/SoqlInjectionSample.cls`): both the VF-param and the escaped-quote REST-param paths now flag critical; bind-variable and `escapeSingleQuotes` cases stay clean. (test-data stays at 0 — those mature repos genuinely have no VF/REST→query injection path.) Tests added in `tests/rules/security.test.ts` (the rule previously had none).
**Taint portion superseded:** the per-rule taint source lists (`TAINT_SOURCES`, `SOQL_SANITIZERS`, `buildTaintedVars`) have been deleted and replaced by `engine/taint.ts` (`getTaint`), which also covers public/global method params as sources. The `stripStringLiterals` and `hasWordRef` sink helpers remain in `security.ts`.

### H8 ✅ `DatabaseQueryWithVariable` missed inline concatenation — **FIXED** (security)
`packages/apex-core/src/rules/security.ts`
`if (argText.startsWith("'")) return` treated `Database.query('SELECT … ' + userInput)` as a safe static string because the concatenation expression's text starts with a quote — so the canonical dynamic-query pattern was a false negative (only bare-variable args fired). Now safe only when no concatenation remains after stripping literal bodies. test-data 330 → 350 (the +20 are genuine inline-concat dynamic queries previously missed). Regression test added.

**Taint source gap closed:** the coverage gap noted here (missing `@AuraEnabled`/`webservice`/`public`/`global` method parameters as taint sources) has been addressed by the shared `engine/taint.ts`. `isEntryPoint` seeds all formal parameters of any `public`, `global`, or `webservice` method. Regression: `ApexSOQLInjection` 0 → 39, `ApexSSRF` 0 → 3, `ApexXSSFromURLParam` 1 → 5 in the 12-repo test-data suite.

### H4 ✅ Taint engine re-walks every method 10+ times per file — **SUPERSEDED by shared engine**
`packages/apex-core/src/rules/security.ts`
~~The 4 taint rules each fire on every `MethodDeclarationContext`; `buildTaintedVars` ran 5 fixed-point passes, each doing `walk(method)` and `textOf(method)`.~~
`buildTaintedVars` has been deleted. All 4 rules now call `getTaint(methodNode, sanitizers)` from `engine/taint.ts`, which is cached in a module-level `WeakMap` keyed on the parse-node. Taint is computed once per method regardless of how many sink rules inspect the same method.

### H5 ✅ Duplicated test-detection helpers have drifted — **FIXED**
`classHasIsTest` / `classNodeIsTest` / `classIsTest` / `isInsideTestClass` / `isInsideTestContext` / `hasAnnotationOn` / `methodIsTest` were copy-pasted across `crud`, `hardcoded`, `performance`, `style`, `security`, `async`, `nre`, with the variants beginning to diverge (style's `classIsTest` added an explicit `TypeDeclarationContext` guard the others lacked). Extracted one `ast/apex-helpers.ts` with the documented-correct semantics — `hasAnnotation`, `isTestClass`, `isInsideTestClass`, `isTestMethod` — and replaced all copies with imports. The variants were behavior-equivalent in practice (inner-class `@IsTest` is undetectable by any of them per the grammar), and unifying changed **nothing**: a full 12-repo scan held at **17,139 violations with zero per-rule change**. 5 unit tests added for the canonical module.

### H6 🟡 Overlapping rules double-report — **NOT REPRODUCED (mostly by-design)**
The originally-claimed pairs do not overlap in practice: across all 10 test-data repos (16,890 violations), **0** locations are flagged by both `DatabaseQueryWithVariable` and `ApexSOQLInjection`, and the `ApexXSSFromEscapeFalse`/`ApexXSSFromURLParam` pair likewise never co-fires — they are complementary, not duplicative. The real co-location (604 lines flagged by ≥2 rules) is dominated by *intentionally distinct* checks: the three complexity metrics (`CyclomaticComplexity`/`CognitiveComplexity`/`AvoidDeeplyNestedIfStmts`, ~257 lines — PMD ships these as separate rules too) and `ApexUnitTestMethodShouldHaveIsTestAnnotation` + `TestWithoutAsserts` (225 lines — different test-quality concerns). No action: this is expected multi-dimensional reporting, not a bug.

---

## Medium — all addressed

- ✅ **`stripStringLiterals` ignores escaped quotes** — fixed as **H7** (escape-aware regex); had real SOQL-injection FN impact.
- ✅ **`UnusedPrivateMethod` chained-call FP** (`design.ts`) — now extracts every `name(` in a call expression, so a method used only as the tail of a chain (`this.helper().process()`) is not reported unused. test-data 74 → 72. Regression test added.
- ✅ **`FutureMethodChaining`** (`async.ts`) — the claimed FP did **not** reproduce (`helper.doFuture()` is a `DotExpressionContext` the handler never processed; the bare-call path resolves correctly). The real gap was a **false negative**: a same-class qualified call (`this.m()` / `ThisClass.m()`) was missed. Added a `DotExpressionContext` handler scoped to `this`/the enclosing class name (FP-safe). +3 tests.
- ✅ **SARIF reporter** — threads the real `CURRENT_VERSION` (was hardcoded `0.1.0`); omits `ruleIndex` when the rule isn't in the run (was defaulting to `0` → wrong rule). `endColumn` is N/A — the `Violation` type carries no end column.
- ✅ **`semverGt` prereleases + update-checker hardening** — strips prerelease/build metadata (was `[1,2,NaN]`); update check now skips in `CI`/`NO_UPDATE_NOTIFIER` and bounds the fetch with a 3 s timeout. +1 test.
- ✅ **`FilesystemMetadataProvider.findObjectsDirs`** — skips symlinks (`lstatSync`) and tracks visited real paths, so a looping project tree no longer recurses unbounded. +1 test.
- ✅ **Config auto-discovery scope** — restricted to cwd + ancestors; no longer loads a config inside a scanned target dir.
- ✅ **Config field-type validation** — `loadConfig` validates field shapes and the `failOn` value, exiting 2 with a clear message instead of an uncaught crash. +5 tests.

---

## Low / corrected

### L1 ✅ `\bas user\b` guard alternative was dead code — **FIXED (via H3)**
`packages/apex-core/src/rules/crud.ts`
The H3 CRUD-guard rework replaced `GUARD_RE` with `AGNOSTIC_GUARD_RE`, which matches the whitespace-stripped `asuser` form — so `insert as user records;` is now correctly recognized as a guard (the user-mode DML FP is gone).

- ✅ **`isTriggerSource` re-slices the whole source** (`parser.ts`) — now probes a fixed 8-char window instead of slicing the entire remaining source. Trigger detection verified unchanged.
- 🟡 **Category/severity vocabulary** — reviewed, **no change**. The 47 rules group sensibly (`ApexXSSFromEscapeFalse` in `security`, NRE rules in `error-prone`, the three complexity metrics in `design`, etc.). Categories are user-facing (drive `--categories` filtering and output grouping); re-shuffling them for subjective tidiness would break those for no correctness gain.
- ◽ **CLI parses files synchronously and serially** (`cli.ts`) — **deferred.** Parsing is the dominant cost (~60%) and worker-thread parallelism would scale on multi-core CI, but the shared `FilesystemMetadataProvider` (a class with Maps, used by `UnguardedCrudOperation`) would need serialization or per-worker rebuild — meaningful complexity/risk for a no-correctness perf gain on a tool that's already acceptably fast. Recommend scoping as its own effort.

---

## Architectural scope (bigger bets)

1. **Eliminate `tree: any`.** Every rule operates on `any`; the compiler catches zero node-shape mistakes, and dispatch keys on `node.constructor.name` — **any future minification silently breaks all rules** with no guard. A partial generated typed wrapper over the ~20 context types rules actually touch is the single highest-leverage improvement.
2. **Replace `textOf().includes()/startsWith()` sink detection with structured argument inspection** (`ExpressionListContext`, `LiteralContext`), as `DatabaseQueryWithVariable` already does. This is the root cause of H1, H2, H6 and the `stripStringLiterals` defect — string-matching a tree you already parsed.
3. **Wire the test gate (C5)** so the FP fixes that have been shipping actually stay fixed.

## Suggested order
C1–C3 (CI exit-code semantics — the linter's actual contract) → C5 (test gate so fixes stick) → C4/H1/H2 (user-visible FP/FN) → H3–H6 → architectural bets.
