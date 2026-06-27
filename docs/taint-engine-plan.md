# Taint Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-rule text-heuristic taint logic in `security.ts` with a single shared, AST-based, intra-procedural taint-tracking engine consumed by all 4 security sink rules, adding public/global method parameters as taint sources.

**Architecture:** A new `engine/taint.ts` module owns taint. `computeTaint(methodNode, sanitizers)` runs once per `(method, sanitizer-set)` (memoized in a module-level node-keyed `WeakMap`) and returns `{ tainted: Set<string>, isEntryPoint }`. The 4 rules call `getTaint(...)` and become thin sink matchers. Propagation collects assignment steps from the AST in document order (no `textOf().split(";")`) and iterates to a fixed point.

**Tech Stack:** TypeScript (strict), `@apexdevtools/apex-parser` ANTLR parse tree, `node:test` via `tsx`, pnpm workspaces.

## Global Constraints

- TypeScript strict mode — no `any` in new code except the untyped parse-tree `node` params (the codebase types these as `any` deliberately; match that).
- Parse-tree node type checks use `nodeType(node)` (constructor name); text via `textOf(node)` (whitespace-stripped); always lowercase before comparing.
- Variable names stored in taint sets are **lowercased**.
- Rules return a listener keyed by parse-tree context type name; the engine does ONE walk dispatching to handlers. Do not add extra top-level walks except inside a rule's own handler.
- Tests run with `npx tsx --test <file>` and the whole suite with `pnpm test`. Every task ends green.
- Imports between engine files use the `.js` extension (ESM/NodeNext): `import { x } from "./taint.js"`.
- Commit after each task.

---

### Task 1: Entry-point detection in `engine/taint.ts`

**Files:**
- Create: `packages/apex-core/src/engine/taint.ts`
- Test: `packages/apex-core/tests/engine/taint.test.ts`

**Interfaces:**
- Produces: `isEntryPoint(methodNode: any): boolean` — true when the method's modifiers include `public`, `global`, or `webservice`. `entryPointParamNames(methodNode: any): string[]` — formal parameter names (original case).

- [ ] **Step 1: Write the failing test**

```ts
// packages/apex-core/tests/engine/taint.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApex } from '../../src/ast/parser.js';
import { walk, nodeType } from '../../src/ast/walk.js';
import { isEntryPoint, entryPointParamNames } from '../../src/engine/taint.js';

function methods(src: string): any[] {
  const { tree } = parseApex(src);
  const out: any[] = [];
  walk(tree, (n) => { if (nodeType(n) === 'MethodDeclarationContext') out.push(n); });
  return out;
}

test('isEntryPoint: public/global/webservice methods are entry points', () => {
  const [pub, glob, ws, priv, none] = methods(`public class C {
    public void a(String x){}
    global void b(){}
    webservice static void c(String f){}
    private void d(String y){}
    void e(String z){}
  }`);
  assert.equal(isEntryPoint(pub), true);
  assert.equal(isEntryPoint(glob), true);
  assert.equal(isEntryPoint(ws), true);
  assert.equal(isEntryPoint(priv), false);
  assert.equal(isEntryPoint(none), false);
});

test('isEntryPoint: @AuraEnabled public method is an entry point (via public)', () => {
  const [m] = methods(`public class C { @AuraEnabled public static List<Account> s(String term, Id who){ return null; } }`);
  assert.equal(isEntryPoint(m), true);
  assert.deepEqual(entryPointParamNames(m), ['term', 'who']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test packages/apex-core/tests/engine/taint.test.ts`
Expected: FAIL — `isEntryPoint is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/apex-core/src/engine/taint.ts
import { walk, nodeType, textOf } from "../ast/walk.js";

const ENTRY_MODIFIER = /^(public|global|webservice)$/;

/** True when the method's access modifiers make it externally reachable. */
export function isEntryPoint(methodNode: any): boolean {
  // Modifiers live on the enclosing ClassBodyDeclarationContext, two levels up:
  // MethodDeclarationContext -> MemberDeclarationContext -> ClassBodyDeclarationContext.
  const cbDecl = methodNode?.parentCtx?.parentCtx;
  for (let i = 0; i < (cbDecl?.getChildCount?.() ?? 0); i++) {
    const c = cbDecl.getChild(i);
    if (nodeType(c) === "ModifierContext" && ENTRY_MODIFIER.test(textOf(c).toLowerCase())) {
      return true;
    }
  }
  return false;
}

/** Formal parameter names of a method (original case). */
export function entryPointParamNames(methodNode: any): string[] {
  const names: string[] = [];
  const fp = methodNode?.formalParameters ? methodNode.formalParameters() : null;
  if (fp) {
    walk(fp, (p) => {
      if (nodeType(p) === "FormalParameterContext" && p.id) names.push(textOf(p.id()));
    });
  }
  return names;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test packages/apex-core/tests/engine/taint.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/apex-core/src/engine/taint.ts packages/apex-core/tests/engine/taint.test.ts
git commit -m "feat(taint): entry-point detection (public/global/webservice methods)"
```

---

### Task 2: `computeTaint` + `getTaint` cache + constants

**Files:**
- Modify: `packages/apex-core/src/engine/taint.ts`
- Test: `packages/apex-core/tests/engine/taint.test.ts`

**Interfaces:**
- Consumes: `isEntryPoint`, `entryPointParamNames` (Task 1).
- Produces:
  - `TAINT_SOURCES: string[]`, `SOQL_SANITIZERS: string[]`, `XSS_SANITIZERS: string[]`, `stripStringLiterals(s: string): string`, `hasWordRef(text: string, varName: string): boolean` — exported for the rules.
  - `interface TaintResult { tainted: Set<string>; isEntryPoint: boolean }`
  - `getTaint(methodNode: any, sanitizers: string[]): TaintResult` — memoized per `(node, sanitizers)`.

- [ ] **Step 1: Write the failing test (append to taint.test.ts)**

```ts
import { getTaint, TAINT_SOURCES, SOQL_SANITIZERS } from '../../src/engine/taint.js';

function firstMethod(src: string): any {
  const { tree } = parseApex(src);
  let m: any = null;
  walk(tree, (n) => { if (!m && nodeType(n) === 'MethodDeclarationContext') m = n; });
  return m;
}

test('getTaint: VF param source taints assigned var and propagates through concat', () => {
  const m = firstMethod(`public class C { void run(){
    String name = ApexPages.currentPage().getParameters().get('q');
    String soql = 'SELECT Id FROM Account WHERE Name = ' + name;
  }}`);
  const { tainted } = getTaint(m, SOQL_SANITIZERS);
  assert.ok(tainted.has('name'));
  assert.ok(tainted.has('soql'));
});

test('getTaint: public method params are tainted; escapeSingleQuotes clears taint', () => {
  const m = firstMethod(`public class C { public void run(String term){
    String safe = String.escapeSingleQuotes(term);
  }}`);
  const { tainted, isEntryPoint } = getTaint(m, SOQL_SANITIZERS);
  assert.equal(isEntryPoint, true);
  assert.ok(tainted.has('term'));
  assert.equal(tainted.has('safe'), false); // sanitized
});

test('getTaint: private method params are NOT tainted', () => {
  const m = firstMethod(`public class C { private void run(String term){
    String soql = 'SELECT Id FROM Account WHERE Name = ' + term;
  }}`);
  const { tainted } = getTaint(m, SOQL_SANITIZERS);
  assert.equal(tainted.has('term'), false);
  assert.equal(tainted.has('soql'), false);
});

test('getTaint: result is cached (same object for same node + sanitizers)', () => {
  const m = firstMethod(`public class C { public void run(String t){} }`);
  assert.strictEqual(getTaint(m, SOQL_SANITIZERS), getTaint(m, SOQL_SANITIZERS));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test packages/apex-core/tests/engine/taint.test.ts`
Expected: FAIL — `getTaint is not a function`.

- [ ] **Step 3: Write the implementation (append to taint.ts)**

```ts
export const TAINT_SOURCES = [
  "currentpage().getparameters().get(",
  "currentpage().getparameters()",
  "apexpages.currentpage().getparameters()",
  "system.currentpagereference().getparameters()",
  "restcontext.request.requestbody",
  "restcontext.request.params",
  "restcontext.request",
  "cookie.getvalue(",
  "url.getcurrentrequesturl(",
];

export const SOQL_SANITIZERS = ["string.escapesinglequotes(", "escapesinglequotes("];
export const XSS_SANITIZERS = ["string.escapehtml4(", "string.escapehtml3(", "encodingutil.htmlencode("];

/** Escape-aware string-literal stripper (handles Apex `\'`). */
export function stripStringLiterals(s: string): string {
  return s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** Whole-word reference test; both args already lowercased. */
export function hasWordRef(text: string, varName: string): boolean {
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(varName, pos);
    if (idx < 0) return false;
    const before = idx > 0 ? text[idx - 1] : "";
    const after = idx + varName.length < text.length ? text[idx + varName.length] : "";
    if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true;
    pos = idx + 1;
  }
  return false;
}

export interface TaintResult {
  tainted: Set<string>;
  isEntryPoint: boolean;
}

// node -> (sanitizer-key -> result). WeakMap so entries die with the parse tree.
const taintCache = new WeakMap<object, Map<string, TaintResult>>();

export function getTaint(methodNode: any, sanitizers: string[]): TaintResult {
  let perNode = taintCache.get(methodNode);
  if (!perNode) taintCache.set(methodNode, (perNode = new Map()));
  const key = sanitizers.join("|");
  let result = perNode.get(key);
  if (!result) perNode.set(key, (result = computeTaint(methodNode, sanitizers)));
  return result;
}

function computeTaint(methodNode: any, sanitizers: string[]): TaintResult {
  const tainted = new Set<string>();
  const entry = isEntryPoint(methodNode);
  if (entry) for (const p of entryPointParamNames(methodNode)) tainted.add(p.toLowerCase());

  // Collect assignment steps from the AST in document order (one walk, no text split).
  const steps: { name: string; rhs: string }[] = [];
  walk(methodNode, (n) => {
    const t = nodeType(n);
    if (t === "VariableDeclaratorContext" && n.id) {
      const name = textOf(n.id()).toLowerCase();
      const full = textOf(n).toLowerCase();
      const eq = full.indexOf("=");
      if (eq >= 0) steps.push({ name, rhs: full.slice(eq + 1) });
    } else if (t === "AssignExpressionContext") {
      const lhs = textOf(n.getChild(0)).toLowerCase();
      if (/^[a-z_][a-z0-9_]*$/.test(lhs)) {
        const full = textOf(n).toLowerCase();
        const eq = full.indexOf("=");
        if (eq >= 0) steps.push({ name: lhs, rhs: full.slice(eq + 1) });
      }
    }
  });

  const isTaintedRhs = (rhs: string): boolean => {
    if (sanitizers.some((s) => rhs.includes(s))) return false;
    if (TAINT_SOURCES.some((s) => rhs.includes(s))) return true;
    const stripped = stripStringLiterals(rhs);
    return [...tainted].some((v) => hasWordRef(stripped, v));
  };

  for (let guard = 0; guard < 10; guard++) {
    let changed = false;
    for (const s of steps) {
      if (tainted.has(s.name)) continue;
      if (isTaintedRhs(s.rhs)) {
        tainted.add(s.name);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { tainted, isEntryPoint: entry };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test packages/apex-core/tests/engine/taint.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/apex-core/src/engine/taint.ts packages/apex-core/tests/engine/taint.test.ts
git commit -m "feat(taint): computeTaint + getTaint cache (AST-ordered propagation, param sources)"
```

---

### Task 3: Migrate `ApexSOQLInjection` to the engine

**Files:**
- Modify: `packages/apex-core/src/rules/security.ts` (apexSOQLInjection only; leave `buildTaintedVars` in place for the other 3 rules until Task 6)
- Create: `fixtures/security-samples/AuraControllerSample.cls`
- Test: `packages/apex-core/tests/rules/security.test.ts`

**Interfaces:**
- Consumes: `getTaint`, `SOQL_SANITIZERS`, `stripStringLiterals`, `hasWordRef` from `engine/taint.js`.

- [ ] **Step 1: Add the failing test (append to security.test.ts)**

```ts
test('ApexSOQLInjection: flags a tainted @AuraEnabled controller param reaching query', () => {
  const src = `public class Ctrl {
    @AuraEnabled
    public static List<Account> search(String term) {
      return Database.query('SELECT Id FROM Account WHERE Name = ' + term);
    }
  }`;
  const v = violations(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, 'critical');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test packages/apex-core/tests/rules/security.test.ts`
Expected: FAIL — `term` is a plain method param, not yet a source under the old `buildTaintedVars`.

- [ ] **Step 3: Implement — port the rule**

In `packages/apex-core/src/rules/security.ts`, add to the top imports:

```ts
import { getTaint, SOQL_SANITIZERS as ENGINE_SOQL_SANITIZERS } from "../engine/taint.js";
```

Replace the body of `apexSOQLInjection`'s `check` so it reads taint from the engine (keep the sink walk identical):

```ts
function check(methodNode: any): void {
  const { tainted } = getTaint(methodNode, ENGINE_SOQL_SANITIZERS);
  if (tainted.size === 0) return;

  walk(methodNode, (n) => {
    if (nodeType(n) !== "DotExpressionContext") return;
    const t = textOf(n).toLowerCase();
    if (!t.startsWith("database.query(") && !t.startsWith("database.querywithbinds(")) return;
    const parenIdx = t.indexOf("(");
    const args = stripStringLiterals(t.substring(parenIdx + 1));
    for (const v of tainted) {
      if (hasWordRef(args, v)) {
        ctx.report(n, `Tainted variable "${v}" from user-controlled input reaches Database.query() — use bind variables (:var) or String.escapeSingleQuotes() to prevent injection.`);
        return;
      }
    }
  });
}
```

(`stripStringLiterals` and `hasWordRef` still exist locally in security.ts and behave identically — leave the local copies until Task 6; the rule may use either. Do not import the engine copies yet to avoid name clashes.)

- [ ] **Step 4: Run the security tests**

Run: `npx tsx --test packages/apex-core/tests/rules/security.test.ts`
Expected: PASS — all prior cases plus the new `@AuraEnabled` case (existing escaped-quote/bind/escape cases still hold).

- [ ] **Step 5: Build, then verify the sample fixture and 12-repo regression**

```bash
pnpm --filter @cloudalgo/apex-core build
node packages/apex-lint-cli/dist/cli.js fixtures/security-samples/SoqlInjectionSample.cls --rules ApexSOQLInjection --format json
node packages/apex-lint-cli/dist/cli.js test-data --rules ApexSOQLInjection --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("ApexSOQLInjection on test-data:",JSON.parse(s).violationCount))'
```
Expected: sample still flags L8 + L15; test-data count is now > 0 (public/global params reaching queries). Spot-check 3-5 of the new hits to confirm they are tainted-param → query paths, not noise. Record the count.

- [ ] **Step 6: Add an @AuraEnabled fixture and commit**

```bash
cat > fixtures/security-samples/AuraControllerSample.cls <<'CLS'
public with sharing class AuraControllerSample {
    // VULNERABLE: @AuraEnabled param concatenated into a dynamic query.
    @AuraEnabled
    public static List<Account> search(String term) {
        return Database.query('SELECT Id FROM Account WHERE Name = \'' + term + '\'');
    }
    // SAFE: same param used as a bind variable.
    @AuraEnabled
    public static List<Account> safeSearch(String term) {
        return Database.query('SELECT Id FROM Account WHERE Name = :term');
    }
}
CLS
git add packages/apex-core/src/rules/security.ts packages/apex-core/tests/rules/security.test.ts fixtures/security-samples/AuraControllerSample.cls
git commit -m "feat(security): ApexSOQLInjection consumes shared taint engine; seed public/global params"
```

---

### Task 4: Migrate `ApexOpenRedirect` and `ApexSSRF`

**Files:**
- Modify: `packages/apex-core/src/rules/security.ts` (both rules)
- Test: `packages/apex-core/tests/rules/security.test.ts`

**Interfaces:**
- Consumes: `getTaint` from `engine/taint.js`. Both rules use the empty sanitizer set `[]`, so they share one cache entry per method.

- [ ] **Step 1: Add failing tests (append to security.test.ts)**

```ts
import { apexOpenRedirect, apexSSRF } from '../../src/rules/security.js';

test('ApexOpenRedirect: flags public-param URL into PageReference', () => {
  const src = `public class C { public PageReference go(String url){ return new PageReference(url); } }`;
  const v = new Linter([apexOpenRedirect]).lint(src).violations;
  assert.equal(v.length, 1);
});

test('ApexSSRF: flags public-param URL into setEndpoint', () => {
  const src = `public class C { public void call(String url){ HttpRequest r = new HttpRequest(); r.setEndpoint(url); } }`;
  const v = new Linter([apexSSRF]).lint(src).violations;
  assert.equal(v.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test packages/apex-core/tests/rules/security.test.ts`
Expected: FAIL — `url` param not a source under old `buildTaintedVars`.

- [ ] **Step 3: Implement — swap both rules' taint source**

Add to the engine import in security.ts:

```ts
import { getTaint } from "../engine/taint.js"; // (merge with the Task 3 import line)
```

In `apexOpenRedirect`'s `check`, replace `const tainted = buildTaintedVars(methodNode, TAINT_SOURCES, REDIRECT_SANITIZERS);` with:

```ts
const tainted = getTaint(methodNode, []).tainted;
```

In `apexSSRF`'s `check`, replace `const tainted = buildTaintedVars(methodNode, TAINT_SOURCES, []);` with:

```ts
const tainted = getTaint(methodNode, []).tainted;
```

Leave each rule's sink walk, the `isInsideTestContext` skip in redirect, and messages unchanged.

- [ ] **Step 4: Run tests + build**

Run: `npx tsx --test packages/apex-core/tests/rules/security.test.ts` → PASS (new + existing).
Run: `pnpm --filter @cloudalgo/apex-core build` → Done.

- [ ] **Step 5: Regression + commit**

```bash
for r in ApexOpenRedirect ApexSSRF; do
  node packages/apex-lint-cli/dist/cli.js test-data --rules $r --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(process.argv[1]||"",JSON.parse(s).violationCount))' "$r"
done
git add packages/apex-core/src/rules/security.ts packages/apex-core/tests/rules/security.test.ts
git commit -m "feat(security): ApexOpenRedirect + ApexSSRF consume shared taint engine"
```
Expected: counts ≥ the pre-change values (1 and 0); sample any increase to confirm genuine.

---

### Task 5: Migrate `ApexXSSFromURLParam`

**Files:**
- Modify: `packages/apex-core/src/rules/security.ts` (apexXSSFromURLParam)
- Test: `packages/apex-core/tests/rules/security.test.ts`

**Interfaces:**
- Consumes: `getTaint`, `XSS_SANITIZERS` from `engine/taint.js`.

- [ ] **Step 1: Add failing test (append)**

```ts
import { apexXSSFromURLParam } from '../../src/rules/security.js';

test('ApexXSSFromURLParam: flags public-param into ApexPages.Message', () => {
  const src = `public class C { public void warn(String msg){ ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.ERROR, msg)); } }`;
  const v = new Linter([apexXSSFromURLParam]).lint(src).violations;
  assert.equal(v.length, 1);
});

test('ApexXSSFromURLParam: no flag when escapeHtml4 sanitizes', () => {
  const src = `public class C { public void warn(String msg){ String safe = String.escapeHtml4(msg); ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.ERROR, safe)); } }`;
  const v = new Linter([apexXSSFromURLParam]).lint(src).violations;
  assert.equal(v.length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test packages/apex-core/tests/rules/security.test.ts`
Expected: FAIL — first new test fails (param not a source yet).

- [ ] **Step 3: Implement — swap the taint source**

Add `XSS_SANITIZERS as ENGINE_XSS_SANITIZERS` to the engine import. In `apexXSSFromURLParam`'s `check`, replace `const tainted = buildTaintedVars(methodNode, TAINT_SOURCES, XSS_SANITIZERS);` with:

```ts
const tainted = getTaint(methodNode, ENGINE_XSS_SANITIZERS).tainted;
```

Leave the three sink branches (Message / addMessage / addError) unchanged.

- [ ] **Step 4: Run tests + build**

Run: `npx tsx --test packages/apex-core/tests/rules/security.test.ts` → PASS.
Run: `pnpm --filter @cloudalgo/apex-core build` → Done.

- [ ] **Step 5: Regression + commit**

```bash
node packages/apex-lint-cli/dist/cli.js test-data --rules ApexXSSFromURLParam --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("ApexXSSFromURLParam:",JSON.parse(s).violationCount))'
git add packages/apex-core/src/rules/security.ts packages/apex-core/tests/rules/security.test.ts
git commit -m "feat(security): ApexXSSFromURLParam consumes shared taint engine"
```
Expected: count ≥ prior value (1); sample any increase.

---

### Task 6: Remove dead `buildTaintedVars`; full regression + docs

**Files:**
- Modify: `packages/apex-core/src/rules/security.ts` (delete `buildTaintedVars`; remove now-unused locals if any)
- Modify: `docs/code-review-findings.md`, `docs/taint-engine-design.md`

**Interfaces:**
- None produced. After this task the 4 rules depend only on `engine/taint.js`.

- [ ] **Step 1: Confirm `buildTaintedVars` has no remaining callers**

Run: `grep -rn "buildTaintedVars" packages/apex-core/src`
Expected: only its definition remains (no callers).

- [ ] **Step 2: Delete `buildTaintedVars` and any now-unused locals**

Remove the `buildTaintedVars` function from `security.ts`. If `stripStringLiterals` / `hasWordRef` / `TAINT_SOURCES` / `REDIRECT_SANITIZERS` / `XSS_SANITIZERS` in security.ts are now unused (rules import the engine copies), delete the dead ones; if still used by the rule sink walks, keep them. Resolve with: `npx tsc --noEmit -p packages/apex-core/tsconfig.json` (it flags unused vars only if `noUnusedLocals` is on — otherwise grep each name).

Run: `grep -n "stripStringLiterals\|hasWordRef\|TAINT_SOURCES\|REDIRECT_SANITIZERS\|XSS_SANITIZERS" packages/apex-core/src/rules/security.ts`
Keep only names with at least one use; delete the rest.

- [ ] **Step 3: Typecheck + full suite + build**

Run: `npx tsc --noEmit -p packages/apex-core/tsconfig.json` → no errors.
Run: `pnpm test` → all pass.
Run: `pnpm build` → all Done.

- [ ] **Step 4: Full 12-repo regression snapshot**

```bash
for r in ApexSOQLInjection ApexOpenRedirect ApexSSRF ApexXSSFromURLParam; do
  node packages/apex-lint-cli/dist/cli.js test-data --rules $r --format json > /tmp/tr.json 2>/dev/null
  node -e 'console.log(process.argv[1], require("/tmp/tr.json").violationCount)' "$r"
done
```
Expected: each ≥ its pre-engine value (no FNs introduced); increases are the new public/global-param findings. No crashes.

- [ ] **Step 5: Update docs and commit**

In `docs/code-review-findings.md`, mark H4 (taint perf) and the taint portions of H7/H8 as superseded by the shared engine. In `docs/taint-engine-design.md`, change Status to `Implemented`.

```bash
git add packages/apex-core/src/rules/security.ts docs/code-review-findings.md docs/taint-engine-design.md
git commit -m "refactor(security): remove buildTaintedVars; taint fully served by engine/taint.ts"
```

---

## Self-review notes
- **Spec coverage:** sources incl. public/global params (T1–T2), AST-ordered propagation/fixed point (T2), shared node-keyed cache (T2), per-rule sanitizer sets via `getTaint(node, sanitizers)` (T2–T5), 4 rules as thin sink matchers (T3–T5), `buildTaintedVars` removed (T6), unit + per-rule + fixture + 12-repo regression tests (all tasks). Propagators (`String.format/join`, collection ops): the fixed-point `hasWordRef`-on-RHS check already taints any LHS whose RHS references a tainted name, including those calls, since their argument text contains the tainted name — no special-casing needed; covered by the concat test in T2.
- **Performance:** §5's "computed once" is delivered by the `getTaint` cache (T2); redirect+SSRF share the `[]` entry.
- **Bind-var safety:** preserved — `stripStringLiterals` removes `:bind` occurrences inside the query literal before `hasWordRef` (existing security tests guard this; they must stay green in T3).
