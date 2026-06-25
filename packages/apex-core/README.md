# @cloudalgo/apex-core

Pure-Node Apex static analysis engine. Parses Salesforce Apex source using the same ANTLR grammar as PMD 7 (`@apexdevtools/apex-parser`), walks the parse tree through an ESLint-style rule dispatcher, and returns structured violation objects.

No Java. No JVM. No Salesforce CLI dependency.

Used by [`@cloudalgo/apex-lint`](https://www.npmjs.com/package/@cloudalgo/apex-lint) (the CLI), and embeddable directly in any Node ≥ 20 application — editors, CI bots, VS Code extensions, build pipelines.

---

## Install

```bash
npm install @cloudalgo/apex-core
```

---

## Usage

```ts
import { Linter, allRules } from "@cloudalgo/apex-core";

const linter = new Linter(allRules);

const result = linter.lint({
  filePath: "AccountService.cls",
  source: `
    public class AccountService {
      public void updateAccounts(List<Account> records) {
        for (Account a : records) {
          update a;  // DML in loop
        }
      }
    }
  `,
});

console.log(result.violations);
// [{ ruleId: 'DmlInLoop', severity: 'high', line: 5, message: '...' }]
console.log(result.suppressedCount); // 0
```

---

## API

### `new Linter(rules: Rule[])`

Creates a linter instance pre-loaded with the given rules. Reuse across files — the Linter is stateless between `lint()` calls.

### `linter.lint(file: LintFile): LintResult`

Also accepts `lint(source: string, opts?: LintOptions)` for the positional form.

```ts
interface LintFile {
  source: string;              // Apex source text
  filePath?: string;           // used in violation output + for .trigger detection
  metadata?: MetadataProvider; // optional — enables type-aware rules
}

interface LintResult {
  filePath: string;
  violations: Violation[];
  suppressedCount: number;     // violations suppressed by // NOPMD or @SuppressWarnings
  syntaxErrors: { line: number; column: number; message: string }[];
}

interface Violation {
  ruleId: string;
  severity: "critical" | "high" | "moderate" | "low" | "info";
  line: number;
  column?: number;
  endLine?: number;
  message: string;
  category: string;
  file: string;
}
```

### `allRules: Rule[]`

All 41 built-in rules. Pass a filtered subset to run only specific rules:

```ts
import { allRules } from "@cloudalgo/apex-core";

// Only security rules
const securityRules = allRules.filter(r => r.category === "security");
const linter = new Linter(securityRules);
```

### Rule categories

`security` · `performance` · `error-prone` · `design` · `best-practices` · `code-style`

---

## Suppression

Inline suppressions are honoured automatically — no extra configuration needed:

```apex
[SELECT Id FROM Account LIMIT 1]; // NOPMD: SoqlInLoop

@SuppressWarnings('PMD.DmlInLoop')
public void bulkInsert(List<SObject> records) { ... }

@SuppressWarnings('PMD')
public class LegacyHelper { ... }   // suppress all rules
```

---

## MetadataProvider (optional)

Some rules (`UnguardedCrudOperation`) need SObject metadata to avoid false positives. Provide a `MetadataProvider` to enable them:

```ts
import { Linter, allRules, FilesystemMetadataProvider } from "@cloudalgo/apex-core";

const metadata = new FilesystemMetadataProvider("./force-app/main/default");
const linter = new Linter(allRules);

const result = linter.lint({ filePath: "...", source: "...", metadata });
```

`FilesystemMetadataProvider` reads `.object-meta.xml` files from an sfdx project layout. Without a provider, type-aware rules silently degrade to no-ops rather than firing false positives.

---

## Built-in rules (41)

See [`@cloudalgo/apex-lint`](https://www.npmjs.com/package/@cloudalgo/apex-lint) for the full rule reference with descriptions, severity levels, and examples.

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
      QueryContext: (node) => {
        if (isInsideLoop(node)) ctx.report(node, "This runs in a loop.");
      },
    };
  },
};

// Use alongside built-in rules
const linter = new Linter([...allRules, myRule]);
```

Context types map 1:1 to grammar rules in the Apex ANTLR grammar. The visitor key is the constructor name of the parse-tree node (e.g. `QueryContext`, `MethodDeclarationContext`). Walk a sample file with `node.constructor.name` to discover what's available.

---

## Repository

[github.com/cloudalgo/apex-lint](https://github.com/cloudalgo/apex-lint)

License: BSD-3-Clause
