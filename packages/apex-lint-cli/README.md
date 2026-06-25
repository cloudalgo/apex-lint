# @cloudalgo/apex-lint

Zero-JVM Salesforce Apex linter. No Java, no Code Analyzer plugin — runs 41 built-in static analysis rules against your Apex source using the same ANTLR grammar as PMD 7.

```bash
npm install -g @cloudalgo/apex-lint
apex-lint force-app/
```

---

## Quick start

```bash
# Lint an sfdx project
apex-lint path/to/force-app

# Run only security rules
apex-lint force-app --categories security

# Fail CI on high severity and above
apex-lint force-app --fail-on high

# SARIF output for GitHub code scanning
apex-lint force-app --format sarif --output results.sarif

# List all 41 rules grouped by category
apex-lint --list-rules
```

---

## CLI reference

```
apex-lint <path...> [options]

Options:
  -f, --format <fmt>          pretty | json | sarif          (default: pretty)
  -o, --output <file>         write results to file instead of stdout
      --fail-on <sev>         fail at this severity+         (default: moderate)
                              critical | high | moderate | low | info
  -c, --config <file>         path to config json
      --rules <ids>           comma-separated rule IDs to run (default: all 41)
      --exclude-rules <ids>   comma-separated rule IDs to skip
      --categories <cats>     comma-separated categories to run
                              security | performance | error-prone | design
                              best-practices | code-style
      --metadata-root <dir>   sfdx project root for SObject metadata (repeatable)
      --list-rules            print all rules grouped by category
  -h, --help                  show this help
```

Summary and progress always go to **stderr**; violation output goes to `--output` or stdout — safe to pipe in CI without mixing logs.

---

## Configuration

Place `apexlint.config.json` (or `.apexlintrc.json`) in your project root — auto-discovered from the current directory and each scanned path. Pass an explicit path with `--config`.

```json
{
  "rules": ["SoqlInLoop", "DmlInLoop", "ApexSOQLInjection"],
  "excludeRules": ["MethodNamingConventions", "AvoidGlobalModifier"],
  "categories": ["security", "performance"],
  "severityOverrides": {
    "EmptyCatchBlock": "critical",
    "AvoidNonRestrictiveQueries": "info"
  },
  "excludePaths": ["**/test/**", "**/*Test.cls", "**/legacy/**"],
  "maxViolationsPerFile": 50,
  "metadataRoots": ["./force-app/main/default"],
  "failOn": "high"
}
```

| Field | CLI equivalent | Description |
|-------|---------------|-------------|
| `rules` | `--rules` | Run ONLY these rule IDs — all others are skipped |
| `excludeRules` | `--exclude-rules` | Skip these rule IDs (merged with CLI flag) |
| `categories` | `--categories` | Run only rules in these categories |
| `severityOverrides` | — | Override per-rule severity |
| `excludePaths` | — | Glob patterns for files to skip (`*`, `**`, `?` supported) |
| `maxViolationsPerFile` | — | Cap violations per file (useful on large legacy codebases) |
| `metadataRoots` | `--metadata-root` | sfdx project roots for SObject metadata |
| `failOn` | `--fail-on` | Minimum severity for non-zero exit |

**Precedence:** CLI flags override config. `rules` takes priority over `excludeRules` and `categories`.

---

## Suppression

Compatible with PMD suppression syntax:

```apex
doSomething(); // NOPMD

[SELECT Id FROM Account]; // NOPMD: SoqlInLoop

@SuppressWarnings('PMD.DmlInLoop')
public void myMethod() { ... }

@SuppressWarnings('PMD')
public class LegacyHelper { ... }
```

---

## Rules (41)

### Security (10)
| Rule | Severity |
|------|----------|
| `ApexSOQLInjection` | critical |
| `ApexOpenRedirect` | high |
| `ApexSSRF` | high |
| `ApexXSSFromURLParam` | high |
| `ApexXSSFromEscapeFalse` | high |
| `ApexBadCrypto` | high |
| `ApexSharingViolations` | high |
| `DatabaseQueryWithVariable` | high |
| `UnguardedCrudOperation` ★ | high |
| `ApexCSRF` | moderate |

### Performance (6)
| Rule | Severity |
|------|----------|
| `SoqlInLoop` | high |
| `DmlInLoop` | high |
| `HttpCalloutInLoop` | high |
| `SoqlInBatchExecute` | moderate |
| `AvoidNonRestrictiveQueries` | low |
| `SystemDebugInLoop` | low |

### Error-Prone (6)
| Rule | Severity |
|------|----------|
| `InaccessibleAuraEnabledGetter` | high |
| `TestMethodsMustBeInTestClasses` | high |
| `FutureMethodChaining` | high |
| `EmptyCatchBlock` | moderate |
| `OverrideBothEqualsAndHashcode` | moderate |
| `AvoidHardcodedId` | moderate |

### Design (8)
| Rule | Severity |
|------|----------|
| `TriggerInlineLogic` | moderate |
| `CyclomaticComplexity` | moderate |
| `CognitiveComplexity` | moderate |
| `AvoidDeeplyNestedIfStmts` | moderate |
| `ExcessiveParameterList` | low |
| `ExcessivePublicCount` | low |
| `TooManyFields` | low |
| `UnusedPrivateMethod` | low |

### Best Practices (10)
| Rule | Severity |
|------|----------|
| `TestWithoutAsserts` | moderate |
| `SeeAllDataTrue` | moderate |
| `HardcodedUrl` | moderate |
| `QueueableWithoutFinalizer` | low |
| `AvoidGlobalModifier` | low |
| `AvoidFutureAnnotation` | low |
| `DebugsShouldUseLoggingLevel` | low |
| `ApexAssertionsShouldIncludeMessage` | low |
| `ApexUnitTestMethodShouldHaveIsTestAnnotation` | low |
| `ApexUnitTestClassShouldHaveRunAs` | low |

### Code Style (1)
| Rule | Severity |
|------|----------|
| `MethodNamingConventions` | low |

★ type-aware — needs `--metadata-root` for SObject context

Full descriptions, examples, and fix guidance: [docs/rules.md](https://github.com/cloudalgo/apex-lint/blob/main/docs/rules.md)

---

## GitHub Actions example

```yaml
- name: Apex lint
  run: |
    npx @cloudalgo/apex-lint force-app \
      --format sarif \
      --output apex-lint.sarif \
      --fail-on high

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: apex-lint.sarif
```

---

## Embedding the engine

To run rules programmatically (no CLI), use [`@cloudalgo/apex-core`](https://www.npmjs.com/package/@cloudalgo/apex-core).

---

## Repository

[github.com/cloudalgo/apex-lint](https://github.com/cloudalgo/apex-lint) · License: BSD-3-Clause
