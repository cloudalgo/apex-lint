# apex-lint

Zero-JVM static analysis for Salesforce Apex. No Java, no apex-jorje, no Code Analyzer plugin — parses Apex with the same ANTLR grammar PMD 7 uses (`@apexdevtools/apex-parser`), runs 41 built-in rules against the parse tree, and emits findings as pretty text, JSON, or SARIF.

| Package | Description |
|---------|-------------|
| `@cloudalgo/apex-core` | Engine: parser, rule dispatcher, rule catalog, metadata providers. Embeds in any Node app. |
| `@cloudalgo/apex-lint` | CLI: file discovery, config, reporters, exit codes. |

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

# List all 41 rules grouped by category
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

41 built-in rules across 6 categories. See [docs/rules.md](docs/rules.md) for the full reference with examples and fixes.

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

### Error-Prone (6)

| Rule | Severity | Description |
|------|----------|-------------|
| `InaccessibleAuraEnabledGetter` | high | `@AuraEnabled` member without public/global access |
| `TestMethodsMustBeInTestClasses` | high | `@IsTest` method in a non-`@IsTest` class — never runs |
| `FutureMethodChaining` | high | `@future` calling another `@future` — runtime exception |
| `EmptyCatchBlock` | moderate | Empty catch block silently swallows exceptions |
| `OverrideBothEqualsAndHashcode` | moderate | `equals()` without `hashCode()` breaks Map/Set |
| `AvoidHardcodedId` | moderate | Hardcoded 15/18-char Salesforce record ID |

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

1. **Parser is wrapped, never imported by rules.** When the Apex grammar gains new syntax, only `ast/parser.ts` moves. Every rule keeps working.

2. **Type-aware rules depend on `MetadataProvider`, not on an org.** `UnguardedCrudOperation` runs identically in CI (filesystem) and embedded in an app (live org). With no provider it degrades silently rather than firing false positives.

3. **Taint analysis for security rules.** `ApexSOQLInjection`, `ApexOpenRedirect`, `ApexSSRF`, and `ApexXSSFromURLParam` use PMD-style intra-method forward propagation — variables seeded from VF params, REST request body, or cookies are tracked through assignment chains to injection sinks. No false positives from safe internal variables.

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
      QueryContext: (node) => {
        if (isInsideLoop(node)) ctx.report(node, "SOQL inside a loop hits governor limits.");
      },
    };
  },
};
```

Register in `rules/index.ts`. To discover which context type a construct produces, walk a sample file and print `node.constructor.name` — see existing rules for examples.

---

## Roadmap

- **PMD ruleset import** — read `ruleset.xml`, map rule enable/severity to apex-lint config.
- **Baseline file** — snapshot current violations, fail only on *new* ones (key adoption feature for legacy orgs).
- **Parallelism + cache** — worker_threads with per-file hash cache for large monorepos.
- **Cross-method taint** — extend taint propagation beyond single methods using a per-class call graph.

---

## License

BSD-3-Clause. Bundles the Apex ANTLR grammar via `@apexdevtools/apex-parser` (also BSD-3-Clause).
