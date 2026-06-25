# @cloudalgo/eslint-parser-apex

ESLint custom parser for Salesforce Apex. Bridges `@apexdevtools/apex-parser` (the same ANTLR grammar PMD 7 uses) into an ESTree-compatible AST that ESLint can traverse.

Used internally by [`@cloudalgo/eslint-plugin-apex`](https://www.npmjs.com/package/@cloudalgo/eslint-plugin-apex). You only need to install this directly if you want to write your own ESLint rules for Apex without using the plugin.

---

## Install

```bash
npm install --save-dev @cloudalgo/eslint-parser-apex
```

---

## Usage with ESLint v9 (flat config)

```js
// eslint.config.js
import apexParser from "@cloudalgo/eslint-parser-apex";

export default [
  {
    files: ["**/*.cls", "**/*.trigger"],
    languageOptions: {
      parser: apexParser,
    },
  },
];
```

## Usage with ESLint v8 (legacy config)

```json
// .eslintrc.json
{
  "parser": "@cloudalgo/eslint-parser-apex",
  "rules": {}
}
```

---

## What the parser produces

Each Apex parse-tree node is wrapped as an ESTree node with:

```ts
{
  type: string;        // constructor name from the ANTLR grammar (e.g. "QueryContext")
  body: ApexNode[];    // child context nodes (terminal tokens are excluded)
  loc: { start, end }; // line/column from ANTLR token positions
  range: [number, number]; // byte offsets
  _antlr: any;         // the raw ANTLR context, available in rule visitors
}
```

The root is wrapped in a synthetic `type: "Program"` node so ESLint's internal validation passes.

---

## Writing rules with this parser

The visitor key in your ESLint rule is the ANTLR context constructor name:

```js
// my-rule.js
export default {
  create(context) {
    return {
      // fires for every SOQL query
      QueryContext(node) {
        context.report({ node, message: "Found a SOQL query." });
      },
    };
  },
};
```

Inspect `node._antlr.constructor.name` while walking a sample file to discover available context types. The grammar is `@apexdevtools/apex-parser`.

---

## Simpler alternative

If you want ready-made rules rather than writing your own, use [`@cloudalgo/eslint-plugin-apex`](https://www.npmjs.com/package/@cloudalgo/eslint-plugin-apex) which bundles this parser with 41 built-in rules.

---

## Repository

[github.com/cloudalgo/apex-lint](https://github.com/cloudalgo/apex-lint) · License: BSD-3-Clause
