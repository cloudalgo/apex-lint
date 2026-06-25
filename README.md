# apex-lint

A pure-Node, **zero-JVM** static analysis engine for Salesforce Apex. No Java, no
`apex-jorje`, no Code Analyzer plugin — it parses Apex with the same ANTLR
grammar PMD 7 itself uses (`@apexdevtools/apex-parser`), runs rules against the
parse tree, and emits findings as pretty text, JSON, or SARIF.

This repo is a **monorepo** with two packages:

| Package | What it is |
|---|---|
| `@cloudalgo/apex-core` | The engine: parser wrapper, rule engine, rule catalog, metadata providers. Embeds in AlgoScope. |
| `@cloudalgo/apex-lint` | The CLI: file discovery, config, reporters, exit codes. Wraps the core for terminal / CI use. |

Both consume one core so rules never diverge between the embedded scanner and
the standalone tool.

---

## Quick start

```bash
# requires Node >= 20
pnpm install
pnpm -r build

# lint an sfdx project (auto-detects objects/ for SObject metadata)
node packages/apex-lint-cli/dist/cli.js path/to/force-app

# or against the bundled fixture
pnpm demo
```

Output formats: `--format pretty|json|sarif`. SARIF uploads straight into GitHub
code scanning. Exit code is `1` when any violation meets `--fail-on` (default
`moderate`), `0` otherwise — wire that into CI.

```bash
node packages/apex-lint-cli/dist/cli.js force-app --format sarif --fail-on high > results.sarif
node packages/apex-lint-cli/dist/cli.js --list-rules
```

---

## Architecture (the parts that matter)

```
apex-core
  ast/parser.ts          wraps @apexdevtools/apex-parser — the ONLY file that
                         touches the parser package (pin/upgrade in one place)
  ast/walk.ts            traversal + helpers (isInsideLoop, enclosingMethod, …)
  engine/types.ts        Rule / RuleContext / Violation contracts
  engine/engine.ts       Linter: ONE tree-walk dispatches all rules (ESLint model)
  metadata/provider.ts   MetadataProvider interface  ← the seam
  metadata/filesystem-provider.ts   reads sfdx objects/ from disk (CLI/CI)
  metadata/org-provider.ts          jsforce-backed live describe (AlgoScope)  [stub]
  rules/*.ts             one file per rule area
```

Two design decisions worth knowing:

**1. The parser is wrapped, never imported directly by rules.** The Apex grammar
gains new syntax a few times a year. When it does, only `ast/parser.ts` moves;
every rule keeps working against our own AST helpers.

**2. Type-aware rules depend on a `MetadataProvider`, not on an org.** The same
`UnguardedCrudOperation` rule runs in CI (filesystem provider reads
`objects/**`) and inside AlgoScope (jsforce provider describes the live org).
The rule doesn't know which. With **no** provider it degrades silently rather
than firing false positives — see below.

---

## The metadata seam, demonstrated

`UnguardedCrudOperation` only fires when the provider confirms the DML target is
a real SObject:

```bash
# no metadata → CRUD rule stays silent (avoids false positives)
# filesystem metadata knows "Account" → CRUD violations appear
pnpm demo
```

In the fixture, the rule flags the unguarded `delete acc` and
`insert new Account()` but **not** the `insert a` that sits behind a
`Schema.sObjectType.Account.isCreateable()` check.

> ⚠️ The CRUD rule is a **phase-1 heuristic** ("is there a guard token anywhere
> in the method?"), not full dataflow. Replacing that check with proper
> def-use / reaching-definitions analysis is the phase-2 work — it plugs in
> behind the same rule + provider interfaces. See Roadmap.

---

## Adding a rule

A rule is an object returning a listener keyed by parse-tree context type. The
engine does the walking; you handle the nodes you care about.

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
      // key = the ANTLR context constructor name
      QueryContext: (node) => {
        if (isInsideLoop(node)) ctx.report(node, "Don't do that here.");
      },
    };
  },
};
```

Register it in `rules/index.ts`. To discover which context type a construct
parses to, walk a sample and print `node.constructor.name` (see how the existing
rules were authored).

---

## Configuration

`apexlint.config.json` (or `.apexlintrc.json`) in the working directory, or pass
`--config <file>`:

```json
{
  "disabledRules": ["MethodNamingConventions"],
  "severityOverrides": { "AvoidHardcodedId": "critical" },
  "metadataRoots": ["force-app"]
}
```

---

## Built-in rules (v0.1)

Syntactic tier (no metadata needed):
`SoqlInLoop`, `DmlInLoop`, `EmptyCatchBlock`, `MethodNamingConventions`,
`AvoidHardcodedId`.

Type-aware tier (uses the metadata seam): `UnguardedCrudOperation`.

These are a deliberately small, high-signal starter set. The point of the
scaffold is the *engine and seams*, not rule count — adding the next 20
syntactic rules is mechanical.

---

## Roadmap

- **More syntactic rules** — the cheap, high-value batch (empty blocks, nested
  loops, `Database.query` with variables, missing `@isTest` asserts, trigger
  best practices, ApexDoc). Each is a short tree-walk.
- **Suppression compatibility** — honor `// NOPMD` and
  `@SuppressWarnings('PMD.RuleName')` so existing PMD users migrate cleanly.
- **PMD ruleset import** — read an existing `ruleset.xml` and map rule
  enable/severity onto our config.
- **Baseline file** — snapshot current violations, fail only on *new* ones (the
  big adoption feature for legacy orgs).
- **Phase-2 security tier** — symbol table + def-use/taint analysis to make
  `UnguardedCrudOperation` and a new `SoqlInjection` rule precise.
- **Parallelism + cache** — worker_threads with a per-file hash cache for CI.

---

## License

BSD-3-Clause. Bundles the Apex ANTLR grammar via `@apexdevtools/apex-parser`
(also BSD-3-Clause).
