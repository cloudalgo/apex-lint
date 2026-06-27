# Apex NRE (Null Reference Exception) — Rule Research & Feasibility

**Date:** 2026-06-27  
**Scope:** What causes `System.NullPointerException` in Apex, what existing tools cover, and which rules apex-lint can implement.

---

## Current Tool Coverage (as of mid-2025)

### PMD
Zero dedicated NRE rules across all 7 Apex rule categories (BestPractices, CodeStyle, Design, Documentation, ErrorProne, Performance, Security).

The closest touch-point is `AvoidDirectAccessTriggerMap` — flags `Trigger.new[0]` — but its rationale is bulkification, not null safety. It is a syntactic XPath match, not a null-flow analysis.

**Confirmed:** PMD ErrorProne category has exactly 17 rules, none address null safety.

### Salesforce Code Analyzer (SFGE)
Had two relevant Graph Engine rules, both now **End of Life (August 2025)**:
- `ApexNullPointerException` (v3.10.0) — general null dereference at public entry points
- `PerformNullCheckOnSoqlVariables` / `MissingNullCheckOnSoqlVariable` (v3.15–16) — variables used in SOQL WHERE clauses without preceding null check

Code Analyzer v5 is in Developer Preview with the same depth-2 limitation on property chains (`Object.x` supported, `Object.x.y` not).

**Net result:** No current shipping tool detects the most common Apex NRE patterns.

---

## Common NRE-Producing Patterns in Apex

### 1. Map.get() result used without null check
```apex
// NRE: map.get() returns null for missing keys
Account acc = accountMap.get(someId);
String name = acc.Name;  // throws if key not in map

// Also inline:
String name = accountMap.get(someId).Name;  // NRE if missing
```

### 2. SOQL result accessed without empty check
```apex
// List[0] on empty list throws ListException, not NPE, but
// assigning to typed var and accessing fields causes NRE:
Account a = [SELECT Name FROM Account WHERE Id = :someId LIMIT 1];
// If no record: a is null
String name = a.Name;  // NRE

// More explicit:
List<Account> accs = [SELECT Name FROM Account WHERE Id = :someId];
String name = accs[0].Name;  // ListException if empty; NRE if assigned via [0] to var first
```

### 3. Multi-level relationship traversal without null guards
```apex
// If Owner is not queried or relationship is null:
String email = account.Owner.Email;       // NRE if Owner not queried
String city = opp.Account.BillingCity;   // NRE if Account not queried

// 3+ level chains (Graph Engine can't handle depth > 2):
String role = account.Owner.UserRole.Name;  // NRE at any hop
```

### 4. Safe navigation operator (`?.`) absent where it could prevent NRE
```apex
// Pattern: someObj.someMethod() or someObj.field without ?.
// Fix: someObj?.someMethod() or someObj?.field returns null instead of throwing
String upper = someString.toUpperCase();   // NRE if null
String upper = someString?.toUpperCase();  // returns null safely
```

### 5. Uninitialized variable dereference
```apex
Account acc;  // null
acc.Name = 'Test';  // NRE — never initialized
```

### 6. Trigger.new / Trigger.old on wrong event
```apex
// Trigger.old is null on INSERT; Trigger.new is null on DELETE
for (Account a : Trigger.old) { }  // NRE on INSERT trigger
```

---

## What apex-lint Can Realistically Implement

apex-lint uses ANTLR-based AST traversal (syntactic, single-file, no dataflow). This limits the analysis to patterns visible in a single expression or statement. True inter-procedural flow analysis (track a variable from assignment to use across statements) is expensive and produces high false-positive rates without type information.

### Tier 1 — High feasibility, syntactic patterns

#### `MapGetWithoutNullCheck`
**Category:** error-prone | **Severity:** warning

Detect inline `.get(...).<field>` chains on Map variables — the most common single-expression NRE pattern.

```apex
// Violation: map.get() result immediately dereferenced
String name = myMap.get(id).Name;
myMap.get(key).doSomething();

// OK: result stored and checked
Account a = myMap.get(id);
if (a != null) { String name = a.Name; }
// OK: safe nav
String name = myMap.get(id)?.Name;
```

**AST signal:** `MethodCallContext` where method name is `get` on a Map-typed receiver, immediately followed by field access (`.PropertyAccess`) or another method call — same expression, no intervening null check.  
**False positive risk:** Low — the inline chaining pattern is unambiguously unsafe.

---

#### `SoqlResultIndexWithoutCheck`
**Category:** error-prone | **Severity:** warning

Detect `[SOQL][0]` or `[SOQL].get(0)` — accessing first element of an inline SOQL result without an empty-list guard.

```apex
// Violation
Account a = [SELECT Id FROM Account LIMIT 1][0];
[SELECT Id FROM Account WHERE Name = :n][0].doSomething();

// OK
List<Account> accs = [SELECT Id FROM Account LIMIT 1];
if (!accs.isEmpty()) { Account a = accs[0]; }
```

**AST signal:** `QueryContext` (SOQL) immediately followed by `ArrayAccessContext` or `.get(0)` in the same expression.  
**False positive risk:** Low — this pattern is always unsafe without a guard.

---

#### `ChainedRelationshipAccessWithoutNullCheck`
**Category:** error-prone | **Severity:** info

Detect 3+ level property chains (`a.b.c`) on sObject variables — flags cases where Graph Engine can't reach and where NRE is common.

```apex
// Violation
String email = account.Owner.Email;      // 3 levels
String name = opp.Account.Owner.Name;   // 4 levels

// OK
String email = account.Owner?.Email;    // safe nav used
if (account.Owner != null) { String email = account.Owner.Email; }
```

**AST signal:** Property access chain depth ≥ 3 where the root identifier looks like an sObject reference (capital first letter, not `System.`, `Schema.`, etc.).  
**False positive risk:** Medium — false positives possible for non-sObject chains (e.g., `someService.getHelper().result`). Could be scoped to identifiers that match known sObject naming patterns or are declared as sObject types (would require type tracking, so keep at `info` severity initially).

---

#### `TriggerContextNullAccess`
**Category:** error-prone | **Severity:** warning

Detect `Trigger.old` usage in triggers that appear to be INSERT-only, and `Trigger.new` in DELETE-only triggers. Also flag `Trigger.old[n]` or `Trigger.new[n]` direct index access (extends existing PMD rule with null-safety rationale).

```apex
// In an INSERT trigger:
for (Account a : Trigger.old) { }  // NRE — Trigger.old is null on INSERT

// Safer patterns
if (Trigger.old != null) { for (Account a : Trigger.old) { } }
```

**AST signal:** Walk the `trigger` block header for `on ... (before insert)` / `(after insert)` and then detect `Trigger.old` references in the body. Inverse for `Trigger.new` on delete.  
**False positive risk:** Low for pure single-event triggers; higher for multi-event triggers (would need to check `Trigger.isInsert` guards).

---

### Tier 2 — Medium feasibility, intra-method tracking

These require tracking a variable from its assignment to its first use, within the same method body — feasible with a single-pass text scan (similar to how `apexSOQLInjection` does taint propagation).

#### `SoqlResultNotNullChecked`
**Category:** error-prone | **Severity:** warning

Detect when the result of a `[SOQL LIMIT 1]` query is assigned to a variable and that variable is subsequently accessed without a null check.

```apex
// Violation: assigned and accessed without null check
Account a = [SELECT Name FROM Account WHERE Id = :someId LIMIT 1];
System.debug(a.Name);  // NRE if no record found

// OK
Account a = [SELECT Name FROM Account WHERE Id = :someId LIMIT 1];
if (a != null) { System.debug(a.Name); }
```

**Implementation:** Track variables assigned from `[SELECT ... LIMIT 1]` (single-result pattern). Flag any field access or method call on those variables not preceded by `if (varName != null)` or `varName != null &&` in the method body.  
**False positive risk:** Medium — `LIMIT 1` doesn't guarantee exactly one result; developer may know record always exists. Keep at `warning`.

---

#### `MapGetResultNotNullChecked`
**Category:** error-prone | **Severity:** warning

Same approach as `SoqlResultNotNullChecked` but for `Map.get()` results stored in variables.

```apex
// Violation
Account a = accountMap.get(someId);
String name = a.Name;  // NRE if key not present

// OK
Account a = accountMap.get(someId);
if (a != null) { String name = a.Name; }
// Also OK
String name = a?.Name;
```

**Implementation:** Track variables assigned via `<SomeVar>.get(<anything>)` where the receiver is a Map-typed variable. Flag field/method access on the result variable without a null guard.  
**False positive risk:** Medium — `computeIfAbsent` and other patterns guarantee non-null; requires some type awareness to reduce FPs. Start with Map variable name heuristics (ends in `Map`, declared as `Map<...>`).

---

### Tier 3 — Lower feasibility / out of scope for syntactic linter

These require full inter-procedural dataflow analysis — beyond what a single-file, AST-only linter can do without high FP rates.

| Pattern | Why Hard |
|---------|----------|
| Uninitialized variable across methods | Requires inter-procedural tracking |
| Null from third-party API calls | No type signatures available |
| Conditional null via complex branch logic | Requires path-sensitive analysis |
| sObject field access where field wasn't queried | Requires SOQL field list cross-reference |

---

## Implementation Priority

| Rule | Tier | Category | Severity | FP Risk | Effort |
|------|------|----------|----------|---------|--------|
| `MapGetWithoutNullCheck` | 1 | error-prone | warning | Low | Small |
| `SoqlResultIndexWithoutCheck` | 1 | error-prone | warning | Low | Small |
| `TriggerContextNullAccess` | 1 | error-prone | warning | Low | Medium |
| `ChainedRelationshipAccessWithoutNullCheck` | 1 | error-prone | info | Medium | Small |
| `SoqlResultNotNullChecked` | 2 | error-prone | warning | Medium | Medium |
| `MapGetResultNotNullChecked` | 2 | error-prone | warning | Medium | Medium |

Start with the Tier 1 rules — they are fully syntactic, FP-safe, and cover the two most common real-world NRE sources (Map.get and direct SOQL index access).

---

## Safe Navigation Operator (`?.`) as the Fix Pattern

All Tier 1 and 2 rules should suggest `?.` as the preferred fix over explicit null checks:
- `someMap.get(id).Name` → `someMap.get(id)?.Name`
- `account.Owner.Email` → `account.Owner?.Email`
- `someString.toUpperCase()` → `someString?.toUpperCase()`

`?.` is available since Apex API version 49.0 (Summer '20) and is idiomatic modern Apex. Violation messages should include this suggestion.

---

## Sources
- PMD Apex errorprone ruleset: https://pmd.github.io/pmd/pmd_rules_apex_errorprone.html
- Salesforce Code Analyzer ApexNullPointerException (EOL): https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/apexnullpointerexception-rule.html
- Salesforce Code Analyzer PerformNullCheckOnSoqlVariables (EOL): https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/performnullcheckonsoqlvariables-rule.html
- SFGE rules inventory: https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/rules-sfge.html
- Graph Engine property chain depth-2 limit: https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/working-with-graph-engine.html
- PMD GitHub issue #2717 (cross-file dataflow gap): https://github.com/pmd/pmd/issues/2717
