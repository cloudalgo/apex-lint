# CLI Banner + Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a branded ASCII box banner to the apex-lint CLI and a zero-latency cache-first update notifier that shows inside the banner when a newer npm release is available.

**Architecture:** A new `update.ts` module exports four functions (`semverGt`, `readUpdateCache`, `fireUpdateCheck`, `printBanner`). `cli.ts` imports them and calls them at the top of `main()` before any other output. The update check fires as a background `fetch()` — no `await`, never blocks the scan.

**Tech Stack:** Node.js 20+ built-ins (`node:fs`, `node:os`, `node:path`, `node:module`, `node:test`, `node:assert`), TypeScript strict, ESM modules.

## Global Constraints

- Zero new runtime dependencies — nothing added to `packages/apex-lint-cli/package.json#dependencies`
- TypeScript strict mode — no `any`, no `@ts-ignore`
- ESM imports only — all local imports use `.js` extension suffix
- Tests run with: `node --import tsx/esm --test <file>` from `/Volumes/WorkHD/rnd/apex-lint`
- Build: `pnpm --filter @cloudalgo/apex-lint build` from workspace root
- Banner writes to `process.stderr` only — stdout is never touched
- Box outer width: 50 chars; inner content width: 42 chars (between `│  ` and `  │`)
- Dash count in top/bottom border: 46
- Cache file path: `path.join(os.homedir(), '.apex-lint-update')`
- Cache TTL: `86_400_000` ms (24 hours)
- Registry URL: `https://registry.npmjs.org/@cloudalgo/apex-lint/latest`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/apex-lint-cli/src/update.ts` | **Create** | `semverGt`, `readUpdateCache`, `fireUpdateCheck`, `printBanner` |
| `packages/apex-lint-cli/tests/update.test.ts` | **Create** | Unit tests for `semverGt` + `readUpdateCache` |
| `packages/apex-lint-cli/src/cli.ts` | **Modify** | Add import, `CURRENT_VERSION`, 3 call sites at top of `main()` |

---

### Task 1: `update.ts` — pure helpers + tests

**Files:**
- Create: `packages/apex-lint-cli/src/update.ts`
- Create: `packages/apex-lint-cli/tests/update.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface UpdateCache { latest: string; checkedAt: number }
  export function semverGt(a: string, b: string): boolean
  export function readUpdateCache(cachePath?: string): UpdateCache | null
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/apex-lint-cli/tests/update.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { semverGt, readUpdateCache } from '../src/update.js';

const TMP = join(tmpdir(), 'test-apex-lint-update');

// semverGt tests
test('semverGt: major bump is greater', () => {
  assert.ok(semverGt('2.0.0', '1.9.9'));
});
test('semverGt: minor bump is greater', () => {
  assert.ok(semverGt('1.1.0', '1.0.99'));
});
test('semverGt: patch bump is greater', () => {
  assert.ok(semverGt('1.0.1', '1.0.0'));
});
test('semverGt: equal versions returns false', () => {
  assert.ok(!semverGt('1.0.0', '1.0.0'));
});
test('semverGt: older version returns false', () => {
  assert.ok(!semverGt('0.9.0', '1.0.0'));
});

// readUpdateCache tests
test('readUpdateCache: returns null for missing file', () => {
  assert.strictEqual(readUpdateCache(TMP + '-nonexistent'), null);
});
test('readUpdateCache: returns null for malformed JSON', () => {
  const p = TMP + '-bad.json';
  writeFileSync(p, 'not-json', 'utf8');
  assert.strictEqual(readUpdateCache(p), null);
  unlinkSync(p);
});
test('readUpdateCache: returns null for wrong shape', () => {
  const p = TMP + '-shape.json';
  writeFileSync(p, JSON.stringify({ foo: 'bar' }), 'utf8');
  assert.strictEqual(readUpdateCache(p), null);
  unlinkSync(p);
});
test('readUpdateCache: returns parsed object for valid cache', () => {
  const p = TMP + '-valid.json';
  const expected = { latest: '0.2.0', checkedAt: 1719446400000 };
  writeFileSync(p, JSON.stringify(expected), 'utf8');
  assert.deepStrictEqual(readUpdateCache(p), expected);
  unlinkSync(p);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
node --import tsx/esm --test packages/apex-lint-cli/tests/update.test.ts
```

Expected: all 9 tests fail with `Cannot find module '../src/update.js'`.

- [ ] **Step 3: Create `packages/apex-lint-cli/src/update.ts` with pure helpers**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface UpdateCache {
  latest: string;
  checkedAt: number;
}

const CACHE_PATH = join(homedir(), '.apex-lint-update');
const UPDATE_TTL_MS = 86_400_000;
const DASH_COUNT = 46;
const INNER_WIDTH = 42;

export function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

export function readUpdateCache(cachePath = CACHE_PATH): UpdateCache | null {
  try {
    const raw = readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).latest === 'string' &&
      typeof (parsed as Record<string, unknown>).checkedAt === 'number'
    ) {
      return parsed as UpdateCache;
    }
    return null;
  } catch {
    return null;
  }
}

export function fireUpdateCheck(): void {
  const cache = readUpdateCache();
  if (cache && Date.now() - cache.checkedAt < UPDATE_TTL_MS) return;
  void fetch('https://registry.npmjs.org/@cloudalgo/apex-lint/latest')
    .then((r) => r.json())
    .then((data) => {
      const latest = (data as { version?: string }).version;
      if (typeof latest === 'string') {
        writeFileSync(CACHE_PATH, JSON.stringify({ latest, checkedAt: Date.now() }), 'utf8');
      }
    })
    .catch(() => {});
}

function padInner(s: string): string {
  return `  │  ${s.padEnd(INNER_WIDTH)}  │`;
}

export function printBanner(current: string, cachedLatest: string | null): void {
  const hasUpdate = cachedLatest !== null && semverGt(cachedLatest, current);
  const hr  = `  ┌${'─'.repeat(DASH_COUNT)}┐`;
  const br  = `  └${'─'.repeat(DASH_COUNT)}┘`;

  const lines = [
    hr,
    padInner(`▲  APEX-LINT  ·  zero-JVM Apex linter`),
    padInner(`   v${current}  ·  by CloudAlgo`),
  ];

  if (hasUpdate) {
    lines.push(padInner(''));
    lines.push(padInner(`⚠  v${cachedLatest} available`));
    lines.push(padInner(`   npm i -g @cloudalgo/apex-lint`));
    lines.push(padInner(`   pnpm add -g @cloudalgo/apex-lint`));
  }

  lines.push(br);
  process.stderr.write(lines.join('\n') + '\n\n');
}
```

- [ ] **Step 4: Run tests — verify all 9 pass**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
node --import tsx/esm --test packages/apex-lint-cli/tests/update.test.ts
```

Expected:
```
✔ semverGt: major bump is greater
✔ semverGt: minor bump is greater
✔ semverGt: patch bump is greater
✔ semverGt: equal versions returns false
✔ semverGt: older version returns false
✔ readUpdateCache: returns null for missing file
✔ readUpdateCache: returns null for malformed JSON
✔ readUpdateCache: returns null for wrong shape
✔ readUpdateCache: returns parsed object for valid cache
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

- [ ] **Step 5: Build to verify TypeScript compiles**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
pnpm --filter @cloudalgo/apex-lint build
```

Expected: exits 0, `dist/update.js` and `dist/update.d.ts` created.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
git add packages/apex-lint-cli/src/update.ts packages/apex-lint-cli/tests/update.test.ts
git commit -m "feat(cli): add update.ts — semverGt, readUpdateCache, fireUpdateCheck, printBanner"
```

---

### Task 2: Wire banner + update check into `cli.ts`

**Files:**
- Modify: `packages/apex-lint-cli/src/cli.ts`

**Interfaces:**
- Consumes (from Task 1):
  ```ts
  import { readUpdateCache, fireUpdateCheck, printBanner } from './update.js';
  // readUpdateCache(): UpdateCache | null
  // fireUpdateCheck(): void
  // printBanner(current: string, cachedLatest: string | null): void
  ```

- [ ] **Step 1: Add imports and `CURRENT_VERSION` to `cli.ts`**

After the existing imports (after line 17 `import { ProgressBar } from "./progress.js";`), add:

```ts
import { createRequire } from "node:module";
import { readUpdateCache, fireUpdateCheck, printBanner } from "./update.js";

const _require = createRequire(import.meta.url);
const CURRENT_VERSION = (_require('../package.json') as { version: string }).version;
```

- [ ] **Step 2: Add the 3 call sites at the top of `main()`**

In `main()`, after `const args = parseArgs(process.argv.slice(2));` and before `if (args.help)`, insert:

```ts
  const cache = readUpdateCache();
  fireUpdateCheck();
  if (process.stderr.isTTY === true && args.format === 'pretty' && !args.help && !args.listRules) {
    printBanner(CURRENT_VERSION, cache?.latest ?? null);
  }
```

The modified beginning of `main()` should look like this:

```ts
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const cache = readUpdateCache();
  fireUpdateCheck();
  if (process.stderr.isTTY === true && args.format === 'pretty' && !args.help && !args.listRules) {
    printBanner(CURRENT_VERSION, cache?.latest ?? null);
  }

  if (args.help) {
    process.stdout.write(HELP + "\n");
    return;
  }
  // ... rest of main() unchanged ...
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
pnpm --filter @cloudalgo/apex-lint build
```

Expected: exits 0, no errors.

- [ ] **Step 4: Run all tests to confirm nothing broke**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
node --import tsx/esm --test packages/apex-lint-cli/tests/progress.test.ts packages/apex-lint-cli/tests/update.test.ts
```

Expected: 17 tests total (8 progress + 9 update), all pass.

- [ ] **Step 5: Manual verify — banner renders on scan**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
node packages/apex-lint-cli/dist/cli.js fixtures/sample-project --format pretty
```

Expected: banner prints before the progress bar:
```
  ┌──────────────────────────────────────────────┐
  │  ▲  APEX-LINT  ·  zero-JVM Apex linter       │
  │     v0.1.15  ·  by CloudAlgo                 │
  └──────────────────────────────────────────────┘

scanning  [████░░░░░░░░░░░░░░░░░░░░░░░░░░░░] ...
```

- [ ] **Step 6: Manual verify — banner silent for non-TTY**

```bash
node packages/apex-lint-cli/dist/cli.js fixtures/sample-project 2>/dev/null | head -5
```

Expected: only violation output on stdout — no banner characters in output.

- [ ] **Step 7: Manual verify — banner silent for `--help` and `--list-rules`**

```bash
node packages/apex-lint-cli/dist/cli.js --help 2>&1 | head -3
node packages/apex-lint-cli/dist/cli.js --list-rules 2>&1 | head -3
```

Expected: both commands show their output with no banner prefix.

- [ ] **Step 8: Simulate update notice — write a stale cache with a higher version**

```bash
echo '{"latest":"99.0.0","checkedAt":0}' > ~/.apex-lint-update
node packages/apex-lint-cli/dist/cli.js fixtures/sample-project --format pretty
```

Expected: banner shows the update section:
```
  ┌──────────────────────────────────────────────┐
  │  ▲  APEX-LINT  ·  zero-JVM Apex linter       │
  │     v0.1.15  ·  by CloudAlgo                 │
  │                                              │
  │  ⚠  v99.0.0 available                       │
  │     npm i -g @cloudalgo/apex-lint            │
  │     pnpm add -g @cloudalgo/apex-lint         │
  └──────────────────────────────────────────────┘
```

Clean up after: `rm ~/.apex-lint-update`

- [ ] **Step 9: Commit**

```bash
cd /Volumes/WorkHD/rnd/apex-lint
git add packages/apex-lint-cli/src/cli.ts
git commit -m "feat(cli): integrate banner + update check into main()"
```
