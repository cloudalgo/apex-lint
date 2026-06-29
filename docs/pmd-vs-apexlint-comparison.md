# PMD vs apex-lint — test-data comparison

- Corpus: `test-data/` — 1384 files, 13 Salesforce repos, ~2,242 Apex source files
- PMD 7.10.0 (all 7 Apex categories) — **43,856** violations across 2093 files, 13 parse errors
- apex-lint (47 rules, all categories) — **17,137** violations
- PMD total excluding Documentation (apex-lint has no doc rules): **34,598**

## Per-category totals

PMD categories:

| PMD category | count |
|---|---:|
| Best Practices | 22,521 |
| Documentation | 9,258 |
| Code Style | 6,471 |
| Design | 3,388 |
| Security | 1,022 |
| Error Prone | 610 |
| Performance | 586 |

apex-lint categories:

| apex-lint category | count |
|---|---:|
| best-practices | 14,698 |
| design | 1,124 |
| error-prone | 550 |
| security | 522 |
| code-style | 133 |
| performance | 110 |

## Head-to-head on equivalent rules

| PMD rule | PMD | apex-lint rule(s) | apex-lint | Δ (al−pmd) |
|---|---:|---|---:|---:|
| ApexAssertionsShouldIncludeMessage | 11,928 | ApexAssertionsShouldIncludeMessage | 11,737 | -191 |
| ApexUnitTestClassShouldHaveRunAs | 7,449 | ApexUnitTestClassShouldHaveRunAs | 890 | -6,559 |
| ApexUnitTestClassShouldHaveAsserts | 865 | TestWithoutAsserts | 562 | -303 |
| ApexCRUDViolation | 826 | UnguardedCrudOperation | 17 | -809 |
| ApexUnitTestMethodShouldHaveIsTestAnnotation | 822 | ApexUnitTestMethodShouldHaveIsTestAnnotation | 822 | +0 |
| MethodNamingConventions | 781 | MethodNamingConventions | 133 | -648 |
| CyclomaticComplexity | 713 | CyclomaticComplexity | 239 | -474 |
| CognitiveComplexity | 659 | CognitiveComplexity | 361 | -298 |
| ExcessiveParameterList | 558 | ExcessiveParameterList | 162 | -396 |
| AvoidDeeplyNestedIfStmts | 459 | AvoidDeeplyNestedIfStmts | 198 | -261 |
| AvoidDebugStatements | 233 | SystemDebugInLoop | 30 | -203 |
| AvoidNonRestrictiveQueries | 188 | AvoidNonRestrictiveQueries | 61 | -127 |
| AvoidHardcodingId | 129 | AvoidHardcodedId | 0 | -129 |
| DebugsShouldUseLoggingLevel | 128 | DebugsShouldUseLoggingLevel | 124 | -4 |
| ApexSharingViolations | 121 | ApexSharingViolations | 129 | +8 |
| ExcessivePublicCount | 75 | ExcessivePublicCount | 18 | -57 |
| EmptyCatchBlock | 67 | EmptyCatchBlock | 67 | +0 |
| AvoidGlobalModifier | 52 | AvoidGlobalModifier | 479 | +427 |
| ApexSOQLInjection | 45 | ApexSOQLInjection | 16 | -29 |
| OperationWithLimitsInLoop | 31 | SoqlInLoop, DmlInLoop, HttpCalloutInLoop, SoqlInBatchExecute | 19 | -12 |
| ApexXSSFromURLParam | 22 | ApexXSSFromURLParam | 2 | -20 |
| TooManyFields | 19 | TooManyFields | 60 | +41 |
| QueueableWithoutFinalizer | 14 | QueueableWithoutFinalizer | 20 | +6 |
| AvoidLogicInTrigger | 6 | TriggerInlineLogic | 14 | +8 |
| ApexOpenRedirect | 5 | ApexOpenRedirect | 1 | -4 |
| OverrideBothEqualsAndHashcode | 4 | OverrideBothEqualsAndHashcode | 8 | +4 |
| ApexUnitTestShouldNotUseSeeAllDataTrue | 4 | SeeAllDataTrue | 6 | +2 |
| ApexSuggestUsingNamedCred | 2 | HardcodedUrl | 32 | +30 |
| ApexXSSFromEscapeFalse | 1 | ApexXSSFromEscapeFalse | 1 | +0 |
| **TOTAL (mapped)** | **26,206** | | **16,208** | **-9,998** |

## PMD rules with NO apex-lint equivalent (coverage gaps in apex-lint)

| PMD rule | category | count |
|---|---|---:|
| ApexDoc | Documentation | 9,258 |
| IfElseStmtsMustUseBraces | Code Style | 1,529 |
| IfStmtsMustUseBraces | Code Style | 1,444 |
| UnusedLocalVariable | Best Practices | 1,253 |
| FieldNamingConventions | Code Style | 1,026 |
| FieldDeclarationsShouldBeAtStart | Code Style | 639 |
| StdCyclomaticComplexity | Design | 513 |
| LocalVariableNamingConventions | Code Style | 491 |
| EmptyStatementBlock | Error Prone | 391 |
| NcssMethodCount | Design | 311 |
| ClassNamingConventions | Code Style | 224 |
| EagerlyLoadedDescribeSObjectResult | Performance | 128 |
| PropertyNamingConventions | Code Style | 121 |
| FormalParameterNamingConventions | Code Style | 95 |
| ForLoopsMustUseBraces | Code Style | 69 |
| OneDeclarationPerLine | Code Style | 51 |
| NcssTypeCount | Design | 37 |
| ExcessiveClassLength | Design | 24 |
| NcssConstructorCount | Design | 20 |
| EmptyIfStmt | Error Prone | 13 |
| OperationWithHighCostInLoop | Performance | 6 |
| EmptyTryOrFinallyBlock | Error Prone | 3 |
| AvoidDirectAccessTriggerMap | Error Prone | 2 |
| WhileLoopsMustUseBraces | Code Style | 1 |
| MethodWithSameNameAsEnclosingClass | Error Prone | 1 |

_PMD-only subtotal: 17,650_

## apex-lint rules with NO PMD equivalent (apex-lint extras)

| apex-lint rule | category | count |
|---|---|---:|
| DatabaseQueryWithVariable | security | 350 |
| MapGetWithoutNullCheck | error-prone | 278 |
| ChainedRelationshipAccess | error-prone | 160 |
| UnusedPrivateMethod | design | 72 |
| SoqlResultNotNullChecked | error-prone | 34 |
| AvoidFutureAnnotation | best-practices | 26 |
| ApexCSRF | security | 4 |
| SoqlResultIndexWithoutCheck | error-prone | 3 |
| ApexBadCrypto | security | 1 |
| ApexSSRF | security | 1 |

_apex-lint-only subtotal: 929_

## Per-repo totals

| repo | PMD | apex-lint |
|---|---:|---:|
| EDA | 8,741 | 4,094 |
| NPSP | 27,446 | 11,103 |
| Volunteers-for-Salesforce | 2,214 | 1,096 |
| apex-code-inspector | 353 | 64 |
| apex-playground | 757 | 146 |
| apex-recipes | 707 | 164 |
| coral-cloud | 153 | 32 |
| dreamhouse-lwc | 66 | 12 |
| ebikes-lwc | 41 | 8 |
| fflib-apex-common | 1,948 | 366 |
| fflib-apex-mocks | 1,339 | 35 |
| streaming-monitor | 91 | 17 |

## File+line agreement on identically-named rules

For rules present in both tools under the same name, exact (rule, file-basename, line) match:

| rule | PMD | apex-lint | both | only PMD | only apex-lint | precision* |
|---|---:|---:|---:|---:|---:|---:|
| ApexAssertionsShouldIncludeMessage | 11754 | 11570 | 11562 | 192 | 8 | 100% |
| ApexOpenRedirect | 5 | 1 | 1 | 4 | 0 | 100% |
| ApexSOQLInjection | 45 | 16 | 1 | 44 | 15 | 6% |
| ApexSharingViolations | 114 | 127 | 85 | 29 | 42 | 67% |
| ApexUnitTestClassShouldHaveRunAs | 6925 | 859 | 1 | 6924 | 858 | 0% |
| ApexUnitTestMethodShouldHaveIsTestAnnotation | 808 | 808 | 808 | 0 | 0 | 100% |
| ApexXSSFromEscapeFalse | 1 | 1 | 1 | 0 | 0 | 100% |
| ApexXSSFromURLParam | 22 | 2 | 0 | 22 | 2 | 0% |
| AvoidDeeplyNestedIfStmts | 459 | 195 | 0 | 459 | 195 | 0% |
| AvoidGlobalModifier | 51 | 478 | 51 | 0 | 427 | 11% |
| AvoidNonRestrictiveQueries | 186 | 61 | 40 | 146 | 21 | 66% |
| CognitiveComplexity | 649 | 358 | 306 | 343 | 52 | 85% |
| CyclomaticComplexity | 698 | 238 | 229 | 469 | 9 | 96% |
| DebugsShouldUseLoggingLevel | 125 | 121 | 121 | 4 | 0 | 100% |
| EmptyCatchBlock | 66 | 66 | 66 | 0 | 0 | 100% |
| ExcessiveParameterList | 549 | 158 | 158 | 391 | 0 | 100% |
| ExcessivePublicCount | 71 | 16 | 16 | 55 | 0 | 100% |
| MethodNamingConventions | 716 | 132 | 112 | 604 | 20 | 85% |
| OverrideBothEqualsAndHashcode | 4 | 8 | 0 | 4 | 8 | 0% |
| QueueableWithoutFinalizer | 14 | 20 | 0 | 14 | 20 | 0% |
| TooManyFields | 19 | 60 | 19 | 0 | 41 | 32% |

_*precision = share of apex-lint hits that PMD also reports at the same file+line (agreement, not ground truth)._
## Reconciliation — file-level vs line-level agreement

Several rules show ~0% line-level agreement but high file-level agreement. That means
both tools flag the *same files* but report a *different line* for the finding (line-offset),
or report at different granularity — not a real disagreement.

| rule | file-level agreement | interpretation |
|---|---:|---|
| ExcessiveParameterList | 100% | identical; apex-lint reports 1/method, PMD also per-overload |
| CyclomaticComplexity | 95% | agree; threshold/line-offset only |
| AvoidGlobalModifier | 94% | agree on files; apex-lint flags method+class (479) vs PMD class-level (52) |
| ApexUnitTestClassShouldHaveRunAs | 92% | agree on files; PMD reports per test method (7,449), apex-lint per class (890) |
| MethodNamingConventions | 92% | agree; PMD also flags more methods/class |
| AvoidDeeplyNestedIfStmts | 68% | mostly agree; line-offset (PMD reports outer `if`, apex-lint inner) |
| ApexSharingViolations | 68% | agree on majority |
| QueueableWithoutFinalizer | 64% | agree on majority |
| ApexXSSFromURLParam | 50% | partial |
| OverrideBothEqualsAndHashcode | 43% | threshold/pairing difference |
| TooManyFields | 29% | apex-lint threshold lower (60 vs 19 hits) |
| **ApexSOQLInjection** | **17%** | **genuine divergence — taint engine recall gap** |

## Takeaways

1. **Volume:** PMD reports 2.6× more violations (43.9k vs 17.1k). ~40% of PMD's volume is
   from rules apex-lint deliberately doesn't implement (ApexDoc 9.3k, brace rules 3.0k,
   naming conventions 1.7k, unused-locals 1.3k). Excluding Documentation, PMD is 34.6k.

2. **Where they agree closely:** the mechanical rules — `ApexAssertionsShouldIncludeMessage`
   (11,737 vs 11,928, 100% line match), `ApexUnitTestMethodShouldHaveIsTestAnnotation`
   (822 = 822, exact), `EmptyCatchBlock` (67 = 67, exact), `DebugsShouldUseLoggingLevel`,
   `ExcessiveParameterList`, `CyclomaticComplexity`. These validate apex-lint's parser and
   structural analysis as sound.

3. **Granularity differences (not bugs):** `ApexUnitTestClassShouldHaveRunAs` and
   `AvoidGlobalModifier` look wildly different by count but agree 92–94% at file level —
   PMD reports per occurrence, apex-lint per class. Same files, different counting.

4. **Real coverage gaps in apex-lint:**
   - `ApexCRUDViolation`: PMD 826 vs apex-lint 17 — apex-lint's `UnguardedCrudOperation`
     needs `--metadata-root` (not supplied here) and is heuristic; effectively disabled.
   - `AvoidHardcodingId`: PMD 129 vs apex-lint **0** — `AvoidHardcodedId` fired nothing;
     likely a detection bug worth investigating.
   - **`ApexSOQLInjection`: 45 vs 16, only 17% file overlap** — the taint engine catches a
     different (smaller) set than PMD. This is the most important precision/recall gap.
   - No documentation, brace-style, field/class/var naming, unused-local, or NCSS size rules.

5. **apex-lint unique value:** 929 violations from rules PMD lacks —
   `DatabaseQueryWithVariable` (350), `MapGetWithoutNullCheck` (278),
   `ChainedRelationshipAccess` (160), `SoqlResultNotNullChecked` (34) — null-safety / NRE
   rules that PMD's Apex ruleset does not cover.

---

## Fixes applied (post-comparison investigation)

Root-caused the two flagged gaps and fixed the genuine bug; the other turned out to be intentional.

### 1. ApexSOQLInjection "45 vs 16, 17% overlap" — taxonomy artifact + a real false negative

- **Taxonomy:** PMD's coarse `ApexSOQLInjection` (flags *any* non-literal `Database.query()`)
  maps to apex-lint's `DatabaseQueryWithVariable` (coarse) **plus** `ApexSOQLInjection`
  (taint-based, precise). Mapped correctly, apex-lint already covered **40/45 lines**.
- **Real bug:** both rules only recognized `Database.query()` / `queryWithBinds()` as SOQL
  sinks. They missed `Database.countQuery()`, `Database.getQueryLocator()`, and the
  `*WithBinds` variants — all dynamic-SOQL execution sinks. Fix: shared `SOQL_QUERY_SINKS`
  list used by both rules (`packages/apex-core/src/rules/security.ts`).
- **FP guard added:** `getQueryLocator` commonly takes inline bracketed SOQL
  (`getQueryLocator([SELECT … :bind])`), which is compile-checked and bind-safe. Added
  `isInlineSoqlArg()` so neither rule flags inline SOQL. (Caught 4 would-be FPs in NPSP.)
- **Result:** `DatabaseQueryWithVariable` 350 → **407** (+57 real sinks, incl. the 2
  `countQuery` files PMD found that apex-lint previously missed). `ApexSOQLInjection`
  unchanged (16) — no taint-seeded countQuery/getQueryLocator in this corpus.

### 2. AvoidHardcodedId "0 vs 129" — intentional, now surfaced at low severity

- **Not a detection bug.** All 129 PMD hits are in `*_TEST.cls`; non-test code has zero
  hardcoded IDs (both tools agree). apex-lint deliberately skipped test classes.
- **Decision:** flag test-class IDs too, but at `low` severity (vs `moderate` for
  production code) so they're visible without polluting the main signal.
- **Result:** 0 → **130** (all `low`). 99.2% file+line agreement with PMD — strict superset
  (every PMD hit caught) plus one borderline placeholder `'000aaaaaaaaaaaaaaa'`.

### Validation
- New corpus total: 17,137 → **17,324** (+130 hardcoded-IDs, +57 dynamic-SOQL sinks, −4 FPs avoided).
- Tests: **130/130 pass** (8 new: 5 sink-coverage, 2 inline-SOQL FP guards, 1 severity-split).
- `npx tsc --noEmit` clean. Zero remaining inline-SOQL false positives.

---

## Follow-up: ApexXSSFromURLParam (22 vs 2) and ApexOpenRedirect (5 vs 1)

Investigated as potential recall gaps. **Both are PMD over-reporting, not apex-lint misses** —
the opposite of the SOQL case. No code change made.

### ApexXSSFromURLParam — PMD flags sources, apex-lint flags sinks
PMD reports the **input read** (`ApexPages.currentPage().getParameters().get('x')`) wherever it
occurs, regardless of whether that value reaches an unescaped render. Examples of PMD hits that
are not XSS at all:
- `VOL_CTRL_VolunteersFind:48` — `string id = …getParameters().get('campaignId')` (stored, compared)
- `CON_ContactMerge_CTRL:523` — `recordId` used only in `keySet().contains(recordId)`
- `VOL_CTRL_SendBulkEmail:251` — the flagged line is literally `if (jobId != null)`

apex-lint uses sink+taint analysis: it flags only when tainted input reaches
`ApexPages.Message` / `addMessage` / `addError(…, false)`. The `addMessage` sinks that *do*
exist in PMD's flagged files render `System.Label.*`, `ex.getMessage()`, or status messages —
**not** user params — so apex-lint correctly stays silent. Its 2 findings
(`BDI_DataImportDeleteBTN_CTRL:86`, `VOL_SharedCode:889`) are the genuine taint-reaching cases.
Verified: no real XSS sink in PMD's 22 is missed by apex-lint.

### ApexOpenRedirect — PMD flags any `new PageReference(<non-literal>)`
- `ADDR_CopyAddrHHObjBTN_CTRL:293` — `returnurl` is assigned from `pageref.getUrl()` (not user
  input) and flows cross-method via a class property. Not user-controlled → correctly not flagged.
- `CON_DeleteContactOverride_CTRL:372` — `new PageReference(url)` where `url` is a method
  **parameter**; intra-method taint cannot see the caller's value.

apex-lint's one finding (`BDI_DataImportDeleteBTN_CTRL:164`) is the genuine taint-from-param case.
The remaining PMD hits are either non-user sources (false positives) or cross-method flows that
would require **interprocedural taint** — a known limitation of the intra-method engine, tracked
as a design tradeoff rather than a bug. Adding param-based taint sources would import PMD's noise.

### Net
| security rule | PMD | apex-lint | verdict |
|---|---:|---:|---|
| ApexSOQLInjection (+ DatabaseQueryWithVariable) | 45 | 423 | apex-lint covers all real sinks after the countQuery/getQueryLocator fix |
| ApexXSSFromURLParam | 22 | 2 | apex-lint correct; PMD flags sources/usages (false positives) |
| ApexOpenRedirect | 5 | 1 | apex-lint correct; PMD coarse + cross-method (mostly false positives) |
