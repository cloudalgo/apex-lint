# CLI Progress Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live single-line progress bar to the `apex-lint` CLI that renders on stderr during scanning and clears cleanly when done.

**Architecture:** A new `progress.ts` module exports a `ProgressBar` class and a pure `renderBar()` function. The class wraps TTY detection and stderr writes; `renderBar()` is pure and unit-testable. Three call sites are added to the existing scan loop in `cli.ts`.

**Tech Stack:** Node.js 20+ built-in (`node:path`, `node:test`, `node:assert`), TypeScript strict, ESM modules (`"type": "module"` in package).

## Global Constraints

- Zero new runtime dependencies — no npm packages added to `package.json#dependencies`
- TypeScript strict mode — no `any`, no `@ts-ignore`
- ESM imports only — all imports use `.js` extension suffix (e.g. `'./progress.js'`)
- Tests run with: `node --import tsx/esm --test <file>` from the workspace root (`/Volumes/WorkHD/rnd/apex-lint`)
- `tsx` is a workspace-root devDep and is already available
- Build: `pnpm --filter @cloudalgo/apex-lint build` from workspace root

---

### Task 1: Create `progress.ts` with `renderBar()` and `ProgressBar`

**Files:**
- Create: `packages/apex-lint-cli/src/progress.ts`
- Create: `packages/apex-lint-cli/tests/progress.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function renderBar(
    current: number,
    total: number,
    violations: number,
    filePath: string,
    cols?: number,
  ): string

  export class ProgressBar {
    constructor(total: number)
    tick(filePath: string, violationCount: number): void
    done(): void
  }
  ```

- [ ] **Step 1: Create `packages/apex-lint-cli/tests/` directory and write the failing tests**

Create `packages/apex-lint-cli/tests/progress.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBar } from '../src/progress.js';

test('renders full bar at 100%', () => {
  const line = renderBar(10, 10, 42, '/path/to/MyClass.cls', 120);
  assert.ok(line.includes('█'.repeat(32)), 'bar should be fully filled');
  assert.ok(line.includes('100%'), 'should show 100%');
  assert.ok(line.includes('10/10'), 'should show count');
  assert.ok(line.includes('42 violations'), 'should show violation count');
  assert.ok(line.includes('MyClass.cls'), 'should show basename');
});

test('renders bar at first file (10%)', () => {
  const line = renderBar(1, 10, 0, '/path/to/File.cls', 120);
  assert.ok(line.includes('░'), 'should have empty segments at 10%');
  assert.ok(line.includes(' 10%'), 'should show 10%');
  assert.ok(line.includes('0 violations'), 'should show zero violations');
});

test('renders half-filled bar at 50%', () => {
  const line = renderBar(5, 10, 100, '/path/to/File.cls', 120);
  assert.ok(line.includes('█'.repeat(16) + '░'.repeat(16)), 'bar should be half filled');
  assert.ok(line.includes(' 50%'), 'should show 50%');
});

test('formats violations with comma separator', () => {
  const line = renderBar(1, 10, 1234, '/path/to/File.cls', 120);
  assert.ok(line.includes('1,234 violations'), 'should format with commas');
});

test('truncates long filename to fit terminal width', () => {
  const longName = 'A'.repeat(80) + '.cls';
  const line = renderBar(1, 10, 0, `/path/${longName}`, 80);
  assert.ok(line.length <= 80, `line length ${line.length} should be <= 80`);
  assert.ok(line.includes('…'), 'should include ellipsis for truncation');
});

test('drops filename when terminal too narrow for any filename', () => {
  // cols=72 leaves no room for "  ·  <filename>" after the base
  const line = renderBar(1, 10, 0, '/path/File.cls', 72);
  assert.ok(line.length <= 72, `line length ${line.length} should be <= 72`);
});

test('uses basename only, not full path', () => {
  const line = renderBar(1, 10, 0, '/very/long/path/to/MyClass.cls', 120);
  assert.ok(line.includes('MyClass.cls'), 'should show basename');
  assert.ok(!line.includes('/very/long/path/to/'), 'should not show full path');
});
```

- [ ] **Step 2: Run tests to verify they fail with "not defined"**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
node --import tsx/esm --test packages/apex-lint-cli/tests/progress.test.ts
```

Expected: all tests fail with `Cannot find module '../src/progress.js'` or similar import error.

- [ ] **Step 3: Create `packages/apex-lint-cli/src/progress.ts`**

```ts
import { basename } from 'node:path';

const BAR_WIDTH = 32;
const FILLED = '█';
const EMPTY = '░';

/**
 * Pure rendering function — exported for unit tests.
 * cols defaults to stderr column count or 120.
 */
export function renderBar(
  current: number,
  total: number,
  violations: number,
  filePath: string,
  cols: number = process.stderr.columns ?? 120,
): string {
  const pct = Math.floor((current / total) * 100);
  const filled = Math.round((current / total) * BAR_WIDTH);
  const bar = FILLED.repeat(filled) + EMPTY.repeat(BAR_WIDTH - filled);
  const violStr = violations.toLocaleString('en-US');
  const file = basename(filePath);

  const base = `scanning  [${bar}] ${String(pct).padStart(3)}%  ${current}/${total}  ·  ${violStr} violations`;
  const withFile = `${base}  ·  ${file}`;

  if (withFile.length <= cols - 2) return withFile;

  // Try truncating the filename to fit
  const budget = cols - 2 - base.length - 5; // "  ·  " is 5 chars
  if (budget >= 2) {
    const trimmed = '…' + file.slice(-(budget - 1));
    return `${base}  ·  ${trimmed}`;
  }

  return base;
}

export class ProgressBar {
  private readonly total: number;
  private current: number = 0;
  private active: boolean;

  constructor(total: number) {
    this.total = total;
    this.active = total > 0 && process.stderr.isTTY === true;
  }

  tick(filePath: string, violationCount: number): void {
    if (!this.active) return;
    this.current++;
    process.stderr.write('\r' + renderBar(this.current, this.total, violationCount, filePath));
  }

  done(): void {
    if (!this.active) return;
    const cols = process.stderr.columns ?? 120;
    process.stderr.write('\r' + ' '.repeat(cols) + '\r');
    this.active = false;
  }
}
```

- [ ] **Step 4: Run tests again to verify they pass**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
node --import tsx/esm --test packages/apex-lint-cli/tests/progress.test.ts
```

Expected output — all 7 tests pass:
```
✔ renders full bar at 100% (Xms)
✔ renders empty bar at start (Xms)
✔ renders half-filled bar at 50% (Xms)
✔ formats violations with comma separator (Xms)
✔ truncates long filename to fit terminal width (Xms)
✔ drops filename when terminal too narrow for any filename (Xms)
✔ uses basename only, not full path (Xms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

- [ ] **Step 5: Build to verify TypeScript compiles cleanly**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
pnpm --filter @cloudalgo/apex-lint build
```

Expected: exits 0, `packages/apex-lint-cli/dist/progress.js` and `progress.d.ts` created.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
git add packages/apex-lint-cli/src/progress.ts packages/apex-lint-cli/tests/progress.test.ts
git commit -m "feat(cli): add ProgressBar and renderBar — zero-dep TTY progress"
```

---

### Task 2: Integrate `ProgressBar` into `cli.ts`

**Files:**
- Modify: `packages/apex-lint-cli/src/cli.ts`

**Interfaces:**
- Consumes (from Task 1):
  ```ts
  import { ProgressBar } from './progress.js';
  // new ProgressBar(total: number)
  // bar.tick(filePath: string, violationCount: number): void
  // bar.done(): void
  ```

- [ ] **Step 1: Add the import to `cli.ts`**

At the top of `packages/apex-lint-cli/src/cli.ts`, after the existing imports (around line 16), add:

```ts
import { ProgressBar } from "./progress.js";
```

- [ ] **Step 2: Add the three call sites inside `main()`**

Locate the block starting at line 211 (approximate) in `cli.ts` that currently reads:

```ts
  const linter = new Linter(rules);
  const files = discoverApexFiles(
    args.paths.map((p) => resolve(p)),
    config.excludePaths,
  );
  const all: Violation[] = [];
  const syntaxProblems: string[] = [];
  let totalSuppressed = 0;

  for (const file of files) {
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const result = linter.lint(src, { filePath: file, metadata });
    const violations = config.maxViolationsPerFile
      ? result.violations.slice(0, config.maxViolationsPerFile)
      : result.violations;
    all.push(...violations);
    totalSuppressed += result.suppressedCount;
    for (const e of result.syntaxErrors) {
      syntaxProblems.push(`${file}:${e.line}:${e.column} parse error: ${e.message}`);
    }
  }
```

Replace it with:

```ts
  const linter = new Linter(rules);
  const files = discoverApexFiles(
    args.paths.map((p) => resolve(p)),
    config.excludePaths,
  );
  const all: Violation[] = [];
  const syntaxProblems: string[] = [];
  let totalSuppressed = 0;
  const bar = new ProgressBar(files.length);

  for (const file of files) {
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const result = linter.lint(src, { filePath: file, metadata });
    const violations = config.maxViolationsPerFile
      ? result.violations.slice(0, config.maxViolationsPerFile)
      : result.violations;
    all.push(...violations);
    totalSuppressed += result.suppressedCount;
    for (const e of result.syntaxErrors) {
      syntaxProblems.push(`${file}:${e.line}:${e.column} parse error: ${e.message}`);
    }
    bar.tick(file, all.length);
  }

  bar.done();
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
pnpm --filter @cloudalgo/apex-lint build
```

Expected: exits 0, no errors.

- [ ] **Step 4: Manually verify the progress bar in an interactive terminal**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
node packages/apex-lint-cli/dist/cli.js fixtures/sample-project --format pretty
```

Expected: you see the bar animating across files, then it clears and the normal `Scanned N file(s)…` summary appears.

Also verify it's silent when piped:

```bash
node packages/apex-lint-cli/dist/cli.js fixtures/sample-project 2>/dev/null
```

Expected: output only — no progress bar characters leak into stderr redirect.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
git add packages/apex-lint-cli/src/cli.ts
git commit -m "feat(cli): integrate ProgressBar into scan loop"
```
