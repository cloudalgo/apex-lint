# apex-lint Usage Guide

## Installation

### From npm (once published)

```bash
npm install -g @cloudalgo/apex-lint
apex-lint --help
```

### From source

```bash
git clone https://github.com/cloudalgo/apex-lint
cd apex-lint
pnpm install
pnpm -r build
# binary at packages/apex-lint-cli/dist/cli.js
node packages/apex-lint-cli/dist/cli.js --help
```

---

## Basic usage

Point the CLI at any combination of directories or individual `.cls` / `.trigger` files:

```bash
# Entire sfdx project
apex-lint force-app/main/default

# Classes and triggers separately
apex-lint force-app/main/default/classes force-app/main/default/triggers

# Single file
apex-lint force-app/main/default/classes/MyController.cls
```

---

## Output formats

### Pretty (default) — human-readable terminal output

```bash
apex-lint force-app
```

```
force-app/main/default/classes/OrderService.cls
  74:32   high     SOQL query inside a loop — move it outside and bulkify.  SoqlInLoop
  127:14  moderate Empty catch block — handle or log the exception.         EmptyCatchBlock

2 violation(s) in 1 file(s).
```

### JSON — machine-readable, pipe into scripts or dashboards

```bash
apex-lint force-app --format json
apex-lint force-app --format json --output results.json
```

Each violation in the JSON array:

```json
{
  "file": "force-app/main/default/classes/OrderService.cls",
  "line": 74,
  "column": 32,
  "severity": "high",
  "ruleId": "SoqlInLoop",
  "message": "SOQL query inside a loop — move it outside and bulkify."
}
```

Top-level shape:

```json
{
  "violationCount": 2,
  "violations": [ ... ]
}
```

### SARIF — GitHub code scanning / VS Code Problems panel

```bash
apex-lint force-app --format sarif --output results.sarif
```

Upload `results.sarif` as a GitHub Actions artifact or push it to the code
scanning API to get inline PR annotations.

---

## Saving results to a file

Use `--output` to write results to a file. Progress and summary are always
printed to stderr (visible in the terminal / CI log) regardless:

```bash
apex-lint force-app --format json --output /tmp/lint.json
# → stderr: "Scanned 142 file(s), 286 SObject(s) known."
# → /tmp/lint.json: full JSON results
```

---

## Controlling severity threshold

`--fail-on` sets the minimum severity that causes a non-zero exit code.
Violations below the threshold are still reported but don't fail the build.

| `--fail-on` value | Fails on |
|---|---|
| `critical` | critical only |
| `high` | high + critical |
| `moderate` (default) | moderate + high + critical |
| `low` | low + moderate + high + critical |
| `info` | everything |

```bash
# Fail only on high/critical — ignore moderate/low noise during initial rollout
apex-lint force-app --fail-on high

# Fail on everything (strictest)
apex-lint force-app --fail-on info
```

---

## SObject metadata (for CRUD/FLS rule)

The `UnguardedCrudOperation` rule needs to know which SObjects exist in the org
so it doesn't fire false positives on ad-hoc class names. Point it at the sfdx
project root containing `objects/`:

```bash
apex-lint force-app/main/default/classes \
  --metadata-root force-app/main/default
```

`--metadata-root` can be repeated for multi-package projects:

```bash
apex-lint src/classes \
  --metadata-root src \
  --metadata-root vendor/managed-package/src
```

Without `--metadata-root`, the CRUD rule stays silent rather than fire false positives.

---

## Configuration file

Create `apexlint.config.json` (or `.apexlintrc.json`) in the directory where you run the CLI:

```json
{
  "rules": ["SoqlInLoop", "DmlInLoop", "ApexSOQLInjection"],
  "excludeRules": ["MethodNamingConventions", "SystemDebugInLoop"],
  "categories": ["security", "performance"],
  "severityOverrides": {
    "SoqlInLoop": "critical",
    "AvoidHardcodedId": "high"
  },
  "excludePaths": ["**/*Test.cls", "**/legacy/**"],
  "maxViolationsPerFile": 50,
  "metadataRoots": ["force-app/main/default"],
  "failOn": "high"
}
```

| Field | CLI equivalent | Purpose |
|---|---|---|
| `rules` | `--rules` | Run ONLY these rule IDs (all others skipped) |
| `excludeRules` | `--exclude-rules` | Skip these rule IDs (merged with CLI flag) |
| `categories` | `--categories` | Run only rules in these categories |
| `severityOverrides` | — | Override default severity per rule |
| `excludePaths` | — | Glob patterns for files to skip |
| `maxViolationsPerFile` | — | Cap violations per file |
| `metadataRoots` | `--metadata-root` | sfdx roots for SObject metadata |
| `failOn` | `--fail-on` | Minimum severity for non-zero exit |

**Precedence:** CLI flags override config. `rules` takes priority over `excludeRules` and `categories`.

Pass a custom path with `--config`:

```bash
apex-lint force-app --config ci/strict-apexlint.json
```

---

## Suppression

### Line suppression

```apex
// Suppress all rules on this line
Database.query(dynamicQuery); // NOPMD

// Suppress one specific rule on this line
Database.query(dynamicQuery); // NOPMD: DatabaseQueryWithVariable
```

### Method/class suppression

```apex
// Suppress one rule for this entire method
@SuppressWarnings('PMD.SoqlInLoop')
public void legacyBulkMethod() {
    for (Account a : accounts) {
        [SELECT Id FROM Contact WHERE AccountId = :a.Id]; // still fires other rules
    }
}

// Suppress all rules for this entire class
@SuppressWarnings('PMD')
public class LegacyGodClass {
    // ...
}
```

Suppressed violations are counted separately and shown in the summary line:

```
Scanned 142 file(s), 3 suppressed, 286 SObject(s) known.
```

---

## CI integration

### GitHub Actions

```yaml
- name: Run apex-lint
  run: |
    npm install -g @cloudalgo/apex-lint
    apex-lint force-app/main/default \
      --metadata-root force-app/main/default \
      --format sarif \
      --output apex-lint.sarif \
      --fail-on high

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: apex-lint.sarif
```

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | No violations at or above `--fail-on` threshold |
| `1` | At least one violation at or above threshold |
| `2` | Usage error (bad flag, no input paths) |

---

## Listing available rules

```bash
apex-lint --list-rules
```

```
SoqlInLoop                 high      performance
  SOQL query inside a for/while/do loop.
DmlInLoop                  high      performance
  DML statement inside a loop.
SoqlInBatchExecute         moderate  performance
  SOQL in batch execute() should bind to the scope parameter.
...
```

Rules marked `[metadata]` require `--metadata-root` to fire.

---

## Embedding the engine

Install just the core package in your Node app:

```bash
npm install @cloudalgo/apex-core
```

```ts
import { Linter, allRules, FilesystemMetadataProvider } from '@cloudalgo/apex-core';

// Object form — source + options in one bag (recommended)
const linter = new Linter(allRules);

const result = linter.lint({
  filePath: 'MyClass.cls',
  source: apexSource,
  metadata: new FilesystemMetadataProvider(['force-app/main/default']),
});

console.log(result.violations);      // Violation[]
console.log(result.suppressedCount); // number of // NOPMD suppressions
console.log(result.syntaxErrors);    // parse errors (usually empty)
```

Or the positional form — `lint(source, opts)` — works identically:

```ts
const metadata = new FilesystemMetadataProvider(['force-app/main/default']);
const result = linter.lint(apexSource, { filePath: 'MyClass.cls', metadata });
```

Supply your own `MetadataProvider` to point the engine at a live org via jsforce
instead of the filesystem — the rules don't know the difference.

See the full API reference at [npmjs.com/@cloudalgo/apex-core](https://www.npmjs.com/package/@cloudalgo/apex-core).

---

## Interpreting results

### Priority order for a legacy org

Fix in this order for maximum impact:

1. **`SoqlInLoop` / `DmlInLoop`** (high) — governor limit bombs; will blow the
   101 SOQL / 150 DML limit under bulk triggers
2. **`DatabaseQueryWithVariable`** (high) — dynamic SOQL injection; user-controlled
   input flows into `Database.query()`
3. **`UnguardedCrudOperation`** (high) — DML without a CRUD/FLS check; fails
   when run by users without object permissions
4. **`SoqlInBatchExecute`** (moderate) — batch jobs querying unrelated data
   instead of their own scope
5. **`EmptyCatchBlock`** (moderate) — swallowed exceptions hide real errors
6. **`FutureMethodChaining`** (high) — calling `@future` from `@future` throws
   a runtime exception immediately

### Noise rules (suppress or disable for legacy orgs)

| Rule | Why it's noisy | Suggestion |
|---|---|---|
| `MethodNamingConventions` | Test methods often use `snake_case` for readability | Disable in config |
| `SystemDebugInLoop` | Low severity; common in old orgs | `--fail-on moderate` skips it |
| `TestWithoutAsserts` | Smoke tests intentionally have no asserts | Suppress with `// NOPMD` |
