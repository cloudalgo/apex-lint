# Changelog

All notable changes to apex-lint are documented here.

---

## [0.1.18] — 2026-06-27

### Added
- `MapGetWithoutNullCheck` — flags inline `Map.get(key).field` dereferences where the result is not null-checked
- `SoqlResultIndexWithoutCheck` — flags `[SELECT ...][0]` inline SOQL index access without an isEmpty() guard
- `TriggerContextNullAccess` — flags `Trigger.old` in INSERT-only triggers and `Trigger.new` in DELETE-only triggers where the collection is always null
- `ChainedRelationshipAccess` — flags 3+ level sObject relationship chains (e.g. `account.Owner.Email`) without null guards or safe navigation
- `SoqlResultNotNullChecked` — flags variables assigned from `LIMIT 1` SOQL and subsequently accessed without a null check
- `MapGetResultNotNullChecked` — flags variables assigned from `Map.get()` and subsequently accessed without a null check

---

## [0.1.17] — 2026-06-27

### Fixed

- **`MethodNamingConventions` no longer flags helper methods inside `@IsTest` classes.**
  Our rule skipped `@isTest`-annotated methods but not plain helpers in test classes
  (e.g. `createTestUser_noAccess`, `assertCompareBoolean`). These legitimately use
  underscores. PMD provides this via `testPattern` config; we skip the whole class.
  Eliminated 34 false positives across fflib, NPSP, and EDA.

- **`DebugsShouldUseLoggingLevel` no longer fires when a `LoggingLevel` variable is
  passed as an argument.**
  `system.debug(level, message)` — where `level` is a variable, not the literal
  `LoggingLevel.WARN` enum — was incorrectly flagged because the check was
  `!text.includes("logginglevel.")`. Fixed to use argument-count logic (PMD uses
  `count(*)=2`): fires only when exactly 1 argument is present (no logging level
  parameter at all). Eliminated 7 false positives in `UTIL_Debug.cls`-style wrappers.

- **`ApexAssertionsShouldIncludeMessage` now restricted to `@IsTest` classes.**
  PMD extends `AbstractApexUnitTestRule` which only visits `@IsTest` classes.
  Production classes may use `System.assert()` for defensive assertions (e.g.
  fflib's `TestSObjectDomain` stub that must live in a production file so
  `Type.newInstance()` can resolve it). Added `isInsideTestClass()` guard.
  Eliminated 5 false positives in `fflib_SObjectDomain.cls` and similar.

---

## [0.1.16] — 2026-06-26

### Added

- **CLI progress bar during scans.**
  A zero-dependency TTY progress bar now renders while scanning large codebases.
  Shows `[████░░░░] 42/100 files  SoqlInLoop ░░░` with the current file name,
  clears cleanly on completion, and degrades gracefully when stdout is not a TTY
  (CI, piped output) — no output in non-TTY mode. Guarded against `total=0`
  edge cases.

### Fixed

- **`EmptyCatchBlock` no longer fires on non-empty catch blocks.**
  `block.statement()` always returned empty because ANTLR wraps catch body children
  as `BlockStatement` nodes, not `Statement` nodes. Replaced with `block.getChildCount() <= 2`
  (only `{` and `}` terminals = truly empty). Eliminated 1,301 false positives across 6
  real-world Salesforce repos (fflib, NPSP, EDA, apex-recipes, Volunteers).

- **`ApexSOQLInjection` no longer fires when a tainted variable is used as a SOQL bind variable.**
  `hasWordRef` was matching field names inside string literals (e.g. `WHERE Id = :id` — the
  field `Id` matched the tainted variable `id`). Fixed by stripping single-quoted string
  literal contents from the `Database.query()` argument before taint-variable matching.
  Eliminated 2 critical false positives in NPSP (`PMT_PaymentWizard_CTRL.cls`).

- **`TestWithoutAsserts` now recognises the Spring '22 `System.Assert.*` namespace API.**
  `System.Assert.areEqual()`, `System.Assert.isTrue()`, `System.Assert.isFalse()`, etc.
  appear as `system.assert.areequal(` in the parse tree — not matching the existing
  `system.assert(` or `assert.` checks. Added `system.assert.` prefix detection.
  Eliminated 272 false positives in apex-recipes and other modern codebases.

- **`TestWithoutAsserts` now recognises delegate assertion helpers.**
  Test methods that call private helper methods named `assertXxx(...)` (e.g.
  `assertCompareBoolean()`, `assertEqualsSelectFields()`) are no longer flagged.
  Equivalent to PMD's `additionalAssertMethodPattern` built in by default.
  Eliminated 137 false positives across NPSP, EDA, and Volunteers.

- **`AvoidNonRestrictiveQueries` no longer flags SOQL queries that have a `LIMIT` clause.**
  A `LIMIT` without a `WHERE` (e.g. `[SELECT Id FROM Account LIMIT 0]`) is bounded and
  safe. PMD uses `\b(where|limit)\b` — we now match that behaviour. Eliminated 32 false
  positives across NPSP, EDA, and apex-recipes.

- **`HardcodedUrl` no longer fires inside `@IsTest` classes.**
  Hardcoded mock callout URLs in test classes are standard Salesforce test practice
  (`HttpCalloutMock`, `StaticResourceCalloutMock`). Aligned with PMD's
  `ApexSuggestUsingNamedCred` which skips test classes. Eliminated 57 false positives
  in EDA and NPSP test files.

---

## [0.1.15] — 2026-06-26

### Fixed

- **`UnguardedCrudOperation` no longer fires in `@IsTest` classes.**
  Test data setup DML runs in system context and never requires CRUD/FLS guards.
  71 false positives eliminated on a real-world org (75% of all hits were in test files).

- **`AvoidHardcodedId` no longer fires in `@IsTest` classes.**
  Hardcoded Salesforce IDs used as test inputs (e.g. `isRequestValid('123456789012345')`)
  are intentional test fixtures, not production bugs. 45 of 48 violations on the same
  org were false positives in test classes.

- **`SoqlInBatchExecute` now recognises the spaced bind colon form.**
  Apex SOQL allows both `:var` and `: var` (space before the variable name). The
  previous `includes(':' + varName)` check missed the spaced form, causing
  scope-bound queries written as `WHERE Id IN : scopeMap.keySet()` to be
  incorrectly flagged.

---

## [0.1.14] — 2026-06-26

### Fixed

- **`@SuppressWarnings` now correctly scopes to the annotated method.**
  Previously `ancestorOfType(node, "MethodDeclarationContext")` always returned
  `undefined` because `MethodDeclarationContext` is a sibling of `ModifierContext`
  inside `ClassBodyDeclarationContext`, not an ancestor. The annotation node's
  ancestor chain is `Annotation → Modifier → ClassBodyDeclaration → ClassBody →
  ClassDeclaration`. The fix walks the `ClassBodyDeclarationContext` for its
  method sibling, so method-level suppressions now scope to the method rather
  than silently falling back to class scope.

- **`@SuppressWarnings` rule ID matching is now case-insensitive.**
  The extracted rule ID was stored with the user's original casing, but the
  engine compared with `===` against PascalCase IDs. Writing
  `@SuppressWarnings('pmd.soqlinloop')` silently failed to suppress
  `ApexSOQLInjection`. The rule ID is now lowercased on storage and compared
  case-insensitively in the engine.

- **`--fail-on` CLI flag now takes precedence over `failOn` in config.**
  `args.failOn` was initialised to `"moderate"` (never `undefined`), so
  `config.failOn ?? args.failOn` always resolved to the config value when a
  config file was present — the CLI flag was silently ignored. The default is
  now `undefined`; priority is CLI → config → `"moderate"`.

- **`FutureMethodChaining` no longer loses the outer class's `@future` set when
  walking inner classes.** The `ClassDeclarationContext` handler unconditionally
  overwrote `futureMethods` on every class entry, including inner classes. The
  set is now only re-collected when entering an outer (top-level) class.

- **`ApexOpenRedirect` false-positive fallback removed.** A conservative branch
  fired when `tainted.size === 0` (no taint sources found), flagging
  `new PageReference(map.get("url"))` in clean methods. Only confirmed
  taint-to-sink flows are now reported.

- **`ApexBadCrypto` now catches `System.Crypto.*` fully-qualified calls.**
  Previously only bare `Crypto.*` calls were matched.

- **`UnusedPrivateMethod` no longer treats field accesses as call sites.**
  `DotExpressionContext` covers both field reads (`account.Name`) and method
  calls (`account.doThing()`). Field accesses were added to `calledNames`,
  masking unused private methods whose name matched a field. The fix skips
  dot expressions that contain no call parentheses.

- **Glob exclude patterns are now fully anchored.** `compileGlob` produced
  unanchored `RegExp` objects, allowing `**/*Test.cls` to match
  `.cls.backup` as a substring. Patterns now have `^` and `$` anchors.

- **CI smoke test no longer fails on expected violations.** The CI workflow now
  passes `--fail-on critical` so the job only fails on crashes or genuine
  critical findings, not on the moderate/low violations that exist in the
  fixture project by design.

---

## [0.1.13] — 2026-06-26

### Fixed

- **Trigger files with block-comment headers no longer fail to parse.**
  Trigger files that begin with `/* ... */` block comments (e.g. `OrderTrigger.trigger`)
  were silently skipped with a `mismatched input 'trigger'` parse error. The root cause was
  a regex-based trigger detector that only recognised `//` line comments before the `trigger`
  keyword. The regex was replaced with a sequential comment-skipping scanner
  (`isTriggerSource`) that correctly handles `/* */` block comments, `//` line comments, and
  any mix of both — without the backtracking hazard that caused the word "trigger" inside a
  comment body to be misread as the Apex `trigger` keyword.

  **Affected files:** `packages/apex-core/src/ast/parser.ts`

---

## [0.1.12] — 2026-06-25

### Changed

- `.gitignore` updated to exclude local `specs.md` and `CLAUDE.md` files.

---

## [0.1.11] — 2026-06-24

### Docs

- Fixed rule count, config field names, and embedding examples in README.

---

## [0.1.10] — 2026-06-24

### Docs

- Added comprehensive dependency usage guide and full API reference for `@cloudalgo/apex-core`.

---

## [0.1.9] — 2026-06-23

### Fixed

- `lint()` now accepts an object form `{ source, filePath, ...opts }` in addition to a bare
  string, making embedded usage cleaner. `LintFile` type exported from the public API.

---

## [0.1.8] — 2026-06-23

### Docs

- Added CLI-specific README for the `@cloudalgo/apex-lint` package.

---

## [0.1.7] — 2026-06-22

### Docs

- Added `@cloudalgo/apex-core`-specific README covering the embedded API, `Linter` class,
  and `MetadataProvider` interface.

---

## [0.1.6] — 2026-06-22

### Fixed

- `README.md` now included in published package files for both packages.

---

## [0.1.5] — 2026-06-22

### Infra

- CI uses `--ignore-scripts` to harden supply-chain policy (esbuild binary not needed for
  `tsc` builds).

---

## [0.1.4] — 2026-06-22

### Fixed

- `onlyBuiltDependencies` moved to `pnpm-workspace.yaml` for pnpm@11 compatibility.
- esbuild build scripts approved for pnpm@11 supply-chain policy.

---

## [0.1.3] — 2026-06-22

### Fixed

- Node.js engine requirement set to `>=20` (was inadvertently requiring Node 22+ after a
  pnpm version conflict in the initial release scripts was resolved).

---

## [0.1.2] — 2026-06-22

### Infra

- Added release automation script and CI/publish GitHub Actions workflows.

---

## [0.1.1] — 2026-06-22

### Fixed

- Release script simplified; pnpm version conflict in publish workflow resolved.

---

## [0.1.0] — 2026-06-21

### Initial Release

**`@cloudalgo/apex-core`** — embedded Apex static-analysis engine:

- 41-rule catalog across 6 categories: `security`, `performance`, `error-prone`, `design`,
  `best-practices`, `code-style`
- Single-pass tree-walk engine: one traversal per file dispatches all rules
- Intra-method taint analysis for SOQL injection, open redirect, SSRF, and XSS
- `MetadataProvider` seam: `FilesystemMetadataProvider` (sfdx project on disk) and
  `NullMetadataProvider` for zero-dependency embedding
- `@SuppressWarnings('PMD.RuleId')` and `// NOPMD` suppression
- TypeScript-first, pure Node — no JVM, no external processes

**`@cloudalgo/apex-lint`** — CLI:

- `apex-lint <path...>` — discovers and lints `.cls` and `.trigger` files
- Output formats: `pretty`, `json`, `sarif`
- `--rules`, `--exclude-rules`, `--categories`, `--fail-on`, `--metadata-root` flags
- Config file auto-discovery (`apexlint.config.json` / `.apexlintrc.json`)
- `--list-rules` to print the full rule catalog
- Exit code 1 when violations meet or exceed `--fail-on` threshold
