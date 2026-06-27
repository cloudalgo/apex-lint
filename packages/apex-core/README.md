# @cloudalgo/apex-core

Pure-Node Apex static analysis engine. Parses Salesforce Apex source using the same ANTLR grammar as PMD 7 (`@apexdevtools/apex-parser`), walks the parse tree through an ESLint-style rule dispatcher, and returns structured violation objects.

No Java. No JVM. No Salesforce CLI dependency. Works in any Node ≥ 20 process — CI bots, VS Code extensions, build pipelines, Electron apps.

---

## Install

```bash
npm install @cloudalgo/apex-core
```

Requires **Node 20 or later**. Works with both CommonJS and ESM projects.

---

## Quick start

```ts
import { Linter, allRules } from "@cloudalgo/apex-core";

const linter = new Linter(allRules);

const result = linter.lint({
  filePath: "AccountService.cls",
  source: `
    public class AccountService {
      public void updateAccounts(List<Account> records) {
        for (Account a : records) {
          update a;  // DML in loop — violation
        }
      }
    }
  `,
});

console.log(result.violations);
// [{
//   ruleId: 'DmlInLoop',
//   severity: 'high',
//   category: 'performance',
//   message: '...',
//   line: 5,
//   file: 'AccountService.cls'
// }]
console.log(`${result.violations.length} violations, ${result.suppressedCount} suppressed`);
```

---

## Scanning files from disk

```ts
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Linter, allRules } from "@cloudalgo/apex-core";

const linter = new Linter(allRules);

function scanDirectory(dir: string) {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true });
  for (const f of files) {
    if (!f.isFile()) continue;
    if (!f.name.endsWith(".cls") && !f.name.endsWith(".trigger")) continue;

    const filePath = join(f.parentPath ?? f.path, f.name);
    const source = readFileSync(filePath, "utf8");
    const result = linter.lint({ filePath, source });

    for (const v of result.violations) {
      console.log(`${v.file}:${v.line} [${v.severity}] ${v.ruleId} — ${v.message}`);
    }
  }
}

scanDirectory("./force-app/main/default/classes");
```

---

## Filtering rules

```ts
import { Linter, allRules } from "@cloudalgo/apex-core";

// Only security rules
const securityLinter = new Linter(allRules.filter(r => r.category === "security"));

// Only specific rules by ID
const focused = new Linter(allRules.filter(r =>
  ["SoqlInLoop", "DmlInLoop", "ApexSOQLInjection"].includes(r.id)
));

// All rules except noisy ones
const quieter = new Linter(allRules.filter(r =>
  r.id !== "MethodNamingConventions" && r.id !== "AvoidGlobalModifier"
));
```

---

## API reference

### `new Linter(rules: Rule[])`

Creates a linter instance pre-loaded with the given rules. Stateless between `lint()` calls — construct once, reuse across many files.

---

### `linter.lint(file: LintFile): LintResult`
### `linter.lint(source: string, opts?: LintOptions): LintResult`

Two accepted forms — use whichever fits your call site.

```ts
/** Object form — source and options in one bag */
interface LintFile {
  source: string;               // Apex source text (required)
  filePath?: string;            // used in violation output and .trigger detection
  metadata?: MetadataProvider;  // optional — enables type-aware rules
  disabled?: Set<string>;       // rule IDs to skip for this file
}

/** Positional options — used with lint(source, opts) */
interface LintOptions {
  filePath?: string;
  metadata?: MetadataProvider;
  disabled?: Set<string>;
}

interface LintResult {
  filePath: string;
  violations: Violation[];
  suppressedCount: number;      // violations filtered by // NOPMD or @SuppressWarnings
  syntaxErrors: { line: number; column: number; message: string }[];
}

interface Violation {
  ruleId: string;
  severity: "critical" | "high" | "moderate" | "low" | "info";
  category: string;
  message: string;
  line: number;
  column: number;
  endLine: number;
  file: string;
}
```

---

### `allRules: Rule[]`

All 47 built-in rules, ready to pass directly to `new Linter()`.

---

### `Rule` interface (for custom rules)

```ts
interface Rule {
  id: string;
  category: string;
  severity: Severity;
  description: string;
  create(ctx: RuleContext): RuleListener;
}

interface RuleContext {
  filePath: string;
  source: string;
  metadata: MetadataProvider;
  report(node: any, message: string, overrides?: Partial<Violation>): void;
}

type RuleListener = Record<string, (node: any) => void>;
// Keys are parse-tree context class names, e.g. "QueryContext", "MethodDeclarationContext"
```

---

## Suppression

Inline suppressions are honoured automatically:

```apex
[SELECT Id FROM Account LIMIT 1]; // NOPMD: SoqlInLoop

@SuppressWarnings('PMD.DmlInLoop')
public void bulkInsert(List<SObject> records) { ... }

@SuppressWarnings('PMD')
public class LegacyHelper { ... }   // suppress all rules
```

Suppressed violations are counted in `result.suppressedCount` — they don't appear in `violations`.

---

## MetadataProvider (optional)

Type-aware rules like `UnguardedCrudOperation` need SObject metadata to avoid false positives. Without a provider they silently degrade to no-ops.

```ts
import { Linter, allRules, FilesystemMetadataProvider } from "@cloudalgo/apex-core";

// Reads .object-meta.xml from an sfdx project layout
const metadata = new FilesystemMetadataProvider("./force-app/main/default");
const linter = new Linter(allRules);

const result = linter.lint({ filePath: "AccountService.cls", source, metadata });
```

---

## AST utilities (for custom rules)

```ts
import {
  walk,           // depth-first pre-order traversal
  nodeType,       // node.constructor.name
  textOf,         // raw text of a node (no spaces — "insertnew Account()" for "insert new Account()")
  lineOf,         // start line
  columnOf,       // start column
  endLineOf,      // end line
  isInsideLoop,   // true if node is inside a for/while/do-while
  ancestorOfType, // nearest ancestor by constructor name
  enclosingMethod // nearest MethodDeclarationContext ancestor
} from "@cloudalgo/apex-core";
```

---

## Writing a custom rule

```ts
import type { Rule } from "@cloudalgo/apex-core";
import { isInsideLoop } from "@cloudalgo/apex-core";

export const myRule: Rule = {
  id: "MyCustomRule",
  category: "performance",
  severity: "high",
  description: "Detects something expensive in a loop.",
  create(ctx) {
    return {
      // Key = parse-tree context class name
      QueryContext: (node) => {
        if (isInsideLoop(node)) {
          ctx.report(node, "SOQL inside a loop — move outside or use bind variables.");
        }
      },
    };
  },
};

const linter = new Linter([...allRules, myRule]);
```

To discover which context name a given Apex construct produces, walk a sample file and print `node.constructor.name`. All node types come from the `@apexdevtools/apex-parser` grammar.

---

## Built-in rule catalog

| ID | Category | Severity |
|----|----------|----------|
| `ApexSOQLInjection` | security | critical |
| `ApexOpenRedirect` | security | high |
| `ApexSSRF` | security | high |
| `ApexXSSFromURLParam` | security | high |
| `ApexXSSFromEscapeFalse` | security | high |
| `ApexBadCrypto` | security | high |
| `ApexSharingViolations` | security | high |
| `DatabaseQueryWithVariable` | security | high |
| `UnguardedCrudOperation` | security | high |
| `ApexCSRF` | security | moderate |
| `SoqlInLoop` | performance | high |
| `DmlInLoop` | performance | high |
| `HttpCalloutInLoop` | performance | high |
| `SoqlInBatchExecute` | performance | moderate |
| `AvoidNonRestrictiveQueries` | performance | low |
| `SystemDebugInLoop` | performance | low |
| `InaccessibleAuraEnabledGetter` | error-prone | high |
| `TestMethodsMustBeInTestClasses` | error-prone | high |
| `FutureMethodChaining` | error-prone | high |
| `EmptyCatchBlock` | error-prone | moderate |
| `OverrideBothEqualsAndHashcode` | error-prone | moderate |
| `AvoidHardcodedId` | error-prone | moderate |
| `MapGetWithoutNullCheck` | error-prone | moderate |
| `SoqlResultIndexWithoutCheck` | error-prone | moderate |
| `TriggerContextNullAccess` | error-prone | moderate |
| `ChainedRelationshipAccess` | error-prone | info |
| `SoqlResultNotNullChecked` | error-prone | moderate |
| `MapGetResultNotNullChecked` | error-prone | info (opt-in) |
| `TriggerInlineLogic` | design | moderate |
| `CyclomaticComplexity` | design | moderate |
| `CognitiveComplexity` | design | moderate |
| `AvoidDeeplyNestedIfStmts` | design | moderate |
| `ExcessiveParameterList` | design | low |
| `ExcessivePublicCount` | design | low |
| `TooManyFields` | design | low |
| `UnusedPrivateMethod` | design | low |
| `TestWithoutAsserts` | best-practices | moderate |
| `SeeAllDataTrue` | best-practices | moderate |
| `HardcodedUrl` | best-practices | moderate |
| `QueueableWithoutFinalizer` | best-practices | low |
| `AvoidGlobalModifier` | best-practices | low |
| `AvoidFutureAnnotation` | best-practices | low |
| `DebugsShouldUseLoggingLevel` | best-practices | low |
| `ApexAssertionsShouldIncludeMessage` | best-practices | low |
| `ApexUnitTestMethodShouldHaveIsTestAnnotation` | best-practices | low |
| `ApexUnitTestClassShouldHaveRunAs` | best-practices | low |
| `MethodNamingConventions` | code-style | low |

---

## Repository

[github.com/cloudalgo/apex-lint](https://github.com/cloudalgo/apex-lint) · [npm](https://www.npmjs.com/package/@cloudalgo/apex-core)

License: BSD-3-Clause
