# @cloudalgo/eslint-plugin-apex

ESLint plugin for Salesforce Apex. Bundles 41 static analysis rules — SOQL/DML in loops, governor-limit violations, taint-tracked security issues, complexity, and best practices — and a custom Apex parser so the whole setup is one dependency.

Compatible with ESLint v8 (legacy config) and ESLint v9 (flat config).

---

## Install

```bash
npm install --save-dev @cloudalgo/eslint-plugin-apex eslint
```

---

## Setup — ESLint v9 (flat config)

```js
// eslint.config.js
import apex from "@cloudalgo/eslint-plugin-apex";

export default [
  // recommended: all 41 rules, critical/high → error, others → warn
  ...apex.flatConfigs.recommended,
];
```

With a metadata root for type-aware rules (e.g. `UnguardedCrudOperation`):

```js
// eslint.config.js
import apex from "@cloudalgo/eslint-plugin-apex";

export default [
  {
    files: ["**/*.cls", "**/*.trigger"],
    languageOptions: {
      parser: apex.parser,
    },
    plugins: { apex: { rules: apex.rules } },
    settings: {
      "apex/metadataRoot": "./force-app/main/default",
    },
    rules: {
      "apex/SoqlInLoop": "error",
      "apex/DmlInLoop": "error",
      "apex/ApexSOQLInjection": "error",
      "apex/UnguardedCrudOperation": "warn",
    },
  },
];
```

## Setup — ESLint v8 (legacy .eslintrc)

```json
{
  "extends": ["plugin:apex/recommended"],
  "settings": {
    "apexMetadataRoot": "./force-app/main/default"
  }
}
```

---

## Rules (41)

### Security (10)
| Rule | Default |
|------|---------|
| `apex/ApexSOQLInjection` | error |
| `apex/ApexOpenRedirect` | error |
| `apex/ApexSSRF` | error |
| `apex/ApexXSSFromURLParam` | error |
| `apex/ApexXSSFromEscapeFalse` | error |
| `apex/ApexBadCrypto` | error |
| `apex/ApexSharingViolations` | error |
| `apex/DatabaseQueryWithVariable` | error |
| `apex/UnguardedCrudOperation` | error |
| `apex/ApexCSRF` | warn |

### Performance (6)
| Rule | Default |
|------|---------|
| `apex/SoqlInLoop` | error |
| `apex/DmlInLoop` | error |
| `apex/HttpCalloutInLoop` | error |
| `apex/SoqlInBatchExecute` | warn |
| `apex/AvoidNonRestrictiveQueries` | warn |
| `apex/SystemDebugInLoop` | warn |

### Error-Prone (6)
| Rule | Default |
|------|---------|
| `apex/InaccessibleAuraEnabledGetter` | error |
| `apex/TestMethodsMustBeInTestClasses` | error |
| `apex/FutureMethodChaining` | error |
| `apex/EmptyCatchBlock` | warn |
| `apex/OverrideBothEqualsAndHashcode` | warn |
| `apex/AvoidHardcodedId` | warn |

### Design (8)
| Rule | Default |
|------|---------|
| `apex/TriggerInlineLogic` | warn |
| `apex/CyclomaticComplexity` | warn |
| `apex/CognitiveComplexity` | warn |
| `apex/AvoidDeeplyNestedIfStmts` | warn |
| `apex/ExcessiveParameterList` | warn |
| `apex/ExcessivePublicCount` | warn |
| `apex/TooManyFields` | warn |
| `apex/UnusedPrivateMethod` | warn |

### Best Practices (10)
| Rule | Default |
|------|---------|
| `apex/TestWithoutAsserts` | warn |
| `apex/SeeAllDataTrue` | warn |
| `apex/HardcodedUrl` | warn |
| `apex/QueueableWithoutFinalizer` | warn |
| `apex/AvoidGlobalModifier` | warn |
| `apex/AvoidFutureAnnotation` | warn |
| `apex/DebugsShouldUseLoggingLevel` | warn |
| `apex/ApexAssertionsShouldIncludeMessage` | warn |
| `apex/ApexUnitTestMethodShouldHaveIsTestAnnotation` | warn |
| `apex/ApexUnitTestClassShouldHaveRunAs` | warn |

### Code Style (1)
| Rule | Default |
|------|---------|
| `apex/MethodNamingConventions` | warn |

---

## Suppression

Standard ESLint inline suppression works:

```apex
// eslint-disable-next-line apex/SoqlInLoop
[SELECT Id FROM Account WHERE Id IN :ids];
```

PMD-style suppression (`// NOPMD`) is also supported via the underlying `@cloudalgo/apex-core` engine.

---

## VS Code integration

Install the ESLint VS Code extension. With this plugin configured, Apex lint errors appear inline in the editor on save.

---

## Prefer the CLI?

[`@cloudalgo/apex-lint`](https://www.npmjs.com/package/@cloudalgo/apex-lint) runs the same 41 rules without requiring an ESLint setup — useful for CI scripts, pre-commit hooks, and editors without ESLint integration.

---

## Repository

[github.com/cloudalgo/apex-lint](https://github.com/cloudalgo/apex-lint) · License: BSD-3-Clause
