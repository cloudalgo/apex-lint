# apex-lint

Zero-JVM static analysis for Salesforce Apex. No Java, no apex-jorje, no Code Analyzer plugin — parses Apex with the same ANTLR grammar PMD 7 uses (`@apexdevtools/apex-parser`), runs 47 built-in rules against the parse tree, and emits findings as pretty text, JSON, or SARIF.

---

## Packages

### [@cloudalgo/apex-lint](packages/apex-lint-cli/README.md) — CLI

[![npm](https://img.shields.io/npm/v/@cloudalgo/apex-lint)](https://www.npmjs.com/package/@cloudalgo/apex-lint)

The command-line linter. Install globally and run against any sfdx project. Supports `pretty`, `json`, and `sarif` output, config file auto-discovery, rule/category filtering, and PMD-compatible suppression.

```bash
npm install -g @cloudalgo/apex-lint
apex-lint force-app/
```

→ [Full CLI README](packages/apex-lint-cli/README.md) · [npm](https://www.npmjs.com/package/@cloudalgo/apex-lint)

---

### [@cloudalgo/apex-core](packages/apex-core/README.md) — Engine

[![npm](https://img.shields.io/npm/v/@cloudalgo/apex-core)](https://www.npmjs.com/package/@cloudalgo/apex-core)

The embeddable static analysis engine. Exposes a `Linter` class you can call from any Node ≥ 20 application — editors, CI bots, VS Code extensions, build pipelines. The CLI and ESLint plugin are both built on top of this package.

```ts
import { Linter, allRules } from "@cloudalgo/apex-core";
const result = new Linter(allRules).lint({ filePath: "MyClass.cls", source });
```

→ [Full engine README](packages/apex-core/README.md) · [npm](https://www.npmjs.com/package/@cloudalgo/apex-core)

---

### [@cloudalgo/eslint-plugin-apex](packages/eslint-plugin-apex/README.md) — ESLint plugin

[![npm](https://img.shields.io/npm/v/@cloudalgo/eslint-plugin-apex)](https://www.npmjs.com/package/@cloudalgo/eslint-plugin-apex)

ESLint plugin that brings all 47 Apex rules into standard ESLint tooling. Works with ESLint v8 (legacy `.eslintrc`) and v9 (flat config). Enables inline `// eslint-disable` suppression and VS Code integration via the ESLint extension.

```js
// eslint.config.js (ESLint v9)
import apex from "@cloudalgo/eslint-plugin-apex";
export default [...apex.flatConfigs.recommended];
```

→ [Full plugin README](packages/eslint-plugin-apex/README.md) · [npm](https://www.npmjs.com/package/@cloudalgo/eslint-plugin-apex)

---

### [@cloudalgo/eslint-parser-apex](packages/eslint-parser-apex/README.md) — ESLint parser

[![npm](https://img.shields.io/npm/v/@cloudalgo/eslint-parser-apex)](https://www.npmjs.com/package/@cloudalgo/eslint-parser-apex)

The custom ESLint parser that bridges `@apexdevtools/apex-parser` into an ESTree-compatible AST. Bundled inside `eslint-plugin-apex` — only install this separately if you want to write your own ESLint rules for Apex.

→ [Full parser README](packages/eslint-parser-apex/README.md) · [npm](https://www.npmjs.com/package/@cloudalgo/eslint-parser-apex)

---

## Quick start

```bash
# requires Node >= 20
npm install -g @cloudalgo/apex-lint

# lint an sfdx project
apex-lint path/to/force-app

# or run from the monorepo
pnpm install && pnpm -r build
node packages/apex-lint-cli/dist/cli.js path/to/force-app
```

---

## CLI reference

```
apex-lint <path...> [options]

Options:
  -f, --format <fmt>          pretty | json | sarif               (default: pretty)
  -o, --output <file>         write results to file instead of stdout
      --fail-on <sev>         fail build at this severity+        (default: moderate)
                              critical | high | moderate | low | info
  -c, --config <file>         path to config json (default: apexlint.config.json)
      --rules <ids>           comma-separated rule IDs to run     (default: all)
      --exclude-rules <ids>   comma-separated rule IDs to exclude
      --categories <cats>     comma-separated categories to run
                              security | performance | error-prone | design
                              best-practices | code-style
      --metadata-root <dir>   sfdx project dir for SObject metadata (repeatable)
      --list-rules            print the rule catalog grouped by category
  -h, --help                  show this help

Exit codes: 0 = clean (below threshold), 1 = violations at/above threshold, 2 = usage error.
```

Summary and progress always print to **stderr**; violation output goes to `--output` or stdout. CI logs show the summary even when capturing results to a file.

### Common usage

```bash
# Run only security rules
apex-lint force-app --categories security

# Run two specific rules
apex-lint force-app --rules SoqlInLoop,DmlInLoop

# Exclude noisy low-value rules
apex-lint force-app --exclude-rules MethodNamingConventions,ApexAssertionsShouldIncludeMessage

# SARIF for GitHub code scanning
apex-lint force-app --format sarif --output results.sarif

# JSON for custom tooling
apex-lint force-app --format json --output results.json

# Only fail CI on high+
apex-lint force-app --fail-on high

# List all 47 rules grouped by category
apex-lint --list-rules
```

---

## Configuration

Place `apexlint.config.json` (or `.apexlintrc.json`) in your project root. Auto-discovered from the current directory and each scanned path. Pass an explicit path with `--config`.

```json
{
  "rules": ["SoqlInLoop", "DmlInLoop", "ApexSOQLInjection"],
  "excludeRules": ["MethodNamingConventions", "ApexAssertionsShouldIncludeMessage"],
  "categories": ["security", "performance"],
  "severityOverrides": {
    "EmptyCatchBlock": "critical",
    "AvoidGlobalModifier": "info"
  },
  "excludePaths": [
    "**/test/**",
    "**/*Test.cls",
    "**/legacy/**"
  ],
  "maxViolationsPerFile": 50,
  "metadataRoots": ["./force-app/main/default"],
  "failOn": "high"
}
```

| Field | CLI equivalent | Description |
|-------|---------------|-------------|
| `rules` | `--rules` | Run only these rule IDs — all others are skipped |
| `excludeRules` | `--exclude-rules` | Skip these rule IDs (merged with CLI flag) |
| `categories` | `--categories` | Run only rules in these categories |
| `severityOverrides` | — | Override per-rule severity |
| `excludePaths` | — | Glob patterns for files to skip (`*`, `**`, `?` supported) |
| `maxViolationsPerFile` | — | Cap violations per file (useful on large legacy codebases) |
| `metadataRoots` | `--metadata-root` | sfdx project roots for SObject metadata |
| `failOn` | `--fail-on` | Minimum severity for non-zero exit |

**Precedence:** CLI flags override config file. `rules` (include list) takes priority over `excludeRules` and `categories`.

See [`apexlint.config.example.json`](apexlint.config.example.json) for a fully annotated starter config.

---

## Suppression

Suppress findings inline without touching config — compatible with PMD suppression syntax so existing suppressions migrate as-is.

```apex
// Suppress all rules on this line
doSomething(); // NOPMD

// Suppress one specific rule on this line
[SELECT Id FROM Account]; // NOPMD: SoqlInLoop

// Suppress a rule for an entire method or class
@SuppressWarnings('PMD.SoqlInLoop')
public void myMethod() { ... }

// Suppress all rules for a class
@SuppressWarnings('PMD')
public class LegacyHelper { ... }
```

Suppressed violations are counted separately and shown in the summary line (`N suppressed`) so suppressions are transparent to reviewers.

---

## Rules

47 built-in rules across 6 categories. See [docs/rules.md](docs/rules.md) for the full reference with examples and fixes.

**Opt-in rules.** A rule tagged `[opt-in]` does **not** run by default — it executes only when you name it explicitly via `--rules <Id>` (or list it under `rules` in config). These are heuristic, high-volume rules that are valuable for a targeted audit but too noisy to gate every build. `MapGetResultNotNullChecked` is the current example: without Apex type/dataflow analysis it cannot distinguish a real null risk from a `Map.get()` the developer knows is populated, or from `SObject.get(fieldName)` field access — so on large codebases it fires hundreds of mostly-safe findings (this is also why PMD ships no equivalent). Making it opt-in keeps the signal available for `apex-lint <path> --rules MapGetResultNotNullChecked` audits without flooding default runs. Run `--list-rules` to see which rules are `[opt-in]`.

### Security (10)

| Rule | Severity | Description |
|------|----------|-------------|
| `ApexSOQLInjection` | **critical** | User-controlled input flows into `Database.query()` — taint-tracked |
| `ApexOpenRedirect` | high | User-controlled URL flows into `PageReference` |
| `ApexSSRF` | high | User-controlled URL flows into `HttpRequest.setEndpoint()` |
| `ApexXSSFromURLParam` | high | Tainted data flows into `ApexPages.Message()` or `addError(…, false)` |
| `ApexXSSFromEscapeFalse` | high | `addError(msg, false)` with non-literal message — escaping disabled |
| `ApexBadCrypto` | high | Weak algorithm in `Crypto.*` call (MD5, SHA-1, HMAC-SHA1) |
| `ApexSharingViolations` | high | Class performs SOQL/DML without explicit sharing declaration |
| `DatabaseQueryWithVariable` | high | `Database.query()` with non-literal argument |
| `UnguardedCrudOperation` ★ | high | DML without CRUD/FLS check |
| `ApexCSRF` | moderate | DML in a constructor runs on every GET request |

★ type-aware (uses MetadataProvider — needs `--metadata-root`)

### Performance (6)

| Rule | Severity | Description |
|------|----------|-------------|
| `SoqlInLoop` | high | SOQL inside a for/while/do loop |
| `DmlInLoop` | high | DML inside a loop |
| `HttpCalloutInLoop` | high | HTTP callout inside a loop |
| `SoqlInBatchExecute` | moderate | Batch `execute()` SOQL not bound to `scope` parameter |
| `AvoidNonRestrictiveQueries` | low | SOQL without a WHERE clause |
| `SystemDebugInLoop` | low | `System.debug()` inside a loop |

### Error-Prone (12)

| Rule | Severity | Description |
|------|----------|-------------|
| `InaccessibleAuraEnabledGetter` | high | `@AuraEnabled` member without public/global access |
| `TestMethodsMustBeInTestClasses` | high | `@IsTest` method in a non-`@IsTest` class — never runs |
| `FutureMethodChaining` | high | `@future` calling another `@future` — runtime exception |
| `EmptyCatchBlock` | moderate | Empty catch block silently swallows exceptions |
| `OverrideBothEqualsAndHashcode` | moderate | `equals()` without `hashCode()` breaks Map/Set |
| `AvoidHardcodedId` | moderate | Hardcoded 15/18-char Salesforce record ID |
| `MapGetWithoutNullCheck` | moderate | Map.get() result used without null check — dereference is unsafe if key is missing |
| `SoqlResultIndexWithoutCheck` | moderate | Inline SOQL result accessed by index without empty check |
| `TriggerContextNullAccess` | moderate | Trigger.old on INSERT triggers or Trigger.new on DELETE triggers is always null |
| `ChainedRelationshipAccess` | info | 3+ level sObject relationship chain without null guards |
| `SoqlResultNotNullChecked` | moderate | LIMIT 1 SOQL result variable accessed without null check |
| `MapGetResultNotNullChecked` | info | Map.get() result variable accessed without null check — **opt-in** (off by default), run with `--rules MapGetResultNotNullChecked` |

### Design (8)

| Rule | Severity | Description |
|------|----------|-------------|
| `TriggerInlineLogic` | moderate | SOQL/DML directly in trigger body |
| `CyclomaticComplexity` | moderate | Method complexity > 10 |
| `CognitiveComplexity` | moderate | Weighted nesting complexity > 15 |
| `AvoidDeeplyNestedIfStmts` | moderate | Nesting depth > 4 |
| `ExcessiveParameterList` | low | Method with > 5 parameters |
| `ExcessivePublicCount` | low | Class with > 45 public members |
| `TooManyFields` | low | Class with > 15 fields |
| `UnusedPrivateMethod` | low | Private method never called within the class |

### Best Practices (10)

| Rule | Severity | Description |
|------|----------|-------------|
| `TestWithoutAsserts` | moderate | Test method with no assertion calls |
| `SeeAllDataTrue` | moderate | `@IsTest(SeeAllData=true)` uses live org data |
| `HardcodedUrl` | moderate | `http://` or `https://` URL in a string literal |
| `QueueableWithoutFinalizer` | low | Queueable with no `System.attachFinalizer()` |
| `AvoidGlobalModifier` | low | `global` class — cannot be deleted once packaged |
| `AvoidFutureAnnotation` | low | `@future` — prefer Queueable for new async code |
| `DebugsShouldUseLoggingLevel` | low | `System.debug()` without a `LoggingLevel` argument |
| `ApexAssertionsShouldIncludeMessage` | low | Test assertion without a failure message |
| `ApexUnitTestMethodShouldHaveIsTestAnnotation` | low | Deprecated `testMethod` keyword |
| `ApexUnitTestClassShouldHaveRunAs` | low | Test class with no `System.runAs()` call |

### Code Style (1)

| Rule | Severity | Description |
|------|----------|-------------|
| `MethodNamingConventions` | low | Method names should be camelCase |

---

## Architecture

```
apex-core
  ast/parser.ts              wraps @apexdevtools/apex-parser (the only file that touches it)
  ast/walk.ts                traversal helpers — isInsideLoop, enclosingMethod, walk, …
  engine/types.ts            Rule / RuleContext / Violation contracts
  engine/engine.ts           Linter: one tree-walk dispatches all rules (ESLint model)
  engine/suppression.ts      buildSuppressions() — // NOPMD and @SuppressWarnings('PMD')
  metadata/provider.ts       MetadataProvider interface  ← the seam
  metadata/filesystem-provider.ts   reads sfdx objects/ from disk
  rules/security.ts          taint analysis engine + security rules
  rules/performance.ts       loop-based governor limit rules
  rules/design.ts            complexity, dead code, structural rules
  rules/style.ts             testing, naming, best-practice rules
  rules/loops.ts             SOQL/DML-in-loop
  rules/crud.ts              unguarded CRUD operations
  rules/async.ts             @future / Queueable rules
```

**Key design decisions:**

1. **Parser is wrapped, never imported by rules.** `ast/contexts.ts` is the single seam to `@apexdevtools/apex-parser` — it re-exports the parser's generated context types so rules import them from `ast/`, never the parser package. When the grammar changes, only the wrapper moves.

2. **Typed AST.** Rule handlers receive the parser's generated context types, not `any` — a closed `ContextMap` maps each dispatched context name to its type, so calling a non-existent accessor (or a typo) is a compile error. `walk`/`report`/the AST helpers are typed to `AstNode`. Dispatch stays `node.constructor.name`-keyed with one controlled cast in the engine.

3. **Type-aware rules depend on `MetadataProvider`, not on an org.** `UnguardedCrudOperation` runs identically in CI (filesystem) and embedded in an app (live org). With no provider it degrades silently rather than firing false positives.

4. **Taint analysis for security rules.** `ApexSOQLInjection`, `ApexOpenRedirect`, `ApexSSRF`, and `ApexXSSFromURLParam` share an intra-method, AST-ordered taint engine (`engine/taint.ts`, computed once per method and cached) — variables seeded from VF params, REST request body, cookies, or `public`/`global`/`webservice` method parameters are tracked through assignment chains to injection sinks.

5. **Parallel by default.** Large runs fan out parse+lint across a worker-thread pool (each worker rebuilds its rule set and metadata from the serializable config); small runs stay serial.

---

## Adding a rule

```ts
import type { Rule } from "../engine/types.js";
import { isInsideLoop } from "../ast/walk.js";

export const myRule: Rule = {
  id: "MyRule",
  category: "performance",
  severity: "high",
  description: "One-line description shown in --list-rules.",
  create(ctx) {
    return {
      // `node` is typed `QueryContext` (from the closed ContextMap) — its
      // accessors are checked at compile time.
      QueryContext: (node) => {
        if (isInsideLoop(node)) ctx.report(node, "SOQL inside a loop hits governor limits.");
      },
    };
  },
};
```

Register in `rules/index.ts`. To discover which context type a construct produces, walk a sample file and print `node.constructor.name`. If you dispatch on a context not yet in the closed `ContextMap` (`ast/contexts.ts`), `tsc` flags it — add the one-line entry.

---

## Roadmap

- **PMD ruleset import** — read `ruleset.xml`, map rule enable/severity to apex-lint config.
- **Baseline file** — snapshot current violations, fail only on *new* ones (key adoption feature for legacy orgs).
- **Incremental cache** — per-file hash cache to skip unchanged files (parse+lint is already parallelized across worker threads).
- **Cross-method taint** — extend taint propagation beyond single methods using a per-class call graph.

---

## License

BSD-3-Clause. Bundles the Apex ANTLR grammar via `@apexdevtools/apex-parser` (also BSD-3-Clause).
