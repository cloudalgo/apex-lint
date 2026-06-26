# Changelog

All notable changes to apex-lint are documented here.

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
