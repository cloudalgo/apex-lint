# CLI Banner + Update Check — Design Spec
Date: 2026-06-26

## Overview

Add a branded ASCII box banner to the apex-lint CLI that prints on stderr at startup (TTY-only, pretty mode), and a zero-latency cache-first update notifier that shows a version upgrade prompt inside the banner when a newer npm release is available.

---

## Banner Format

### No update available

```
  ┌──────────────────────────────────────────────┐
  │  ▲  APEX-LINT  ·  zero-JVM Apex linter       │
  │     v0.1.15  ·  by CloudAlgo                 │
  └──────────────────────────────────────────────┘
```

### Update available (from cache)

```
  ┌──────────────────────────────────────────────┐
  │  ▲  APEX-LINT  ·  zero-JVM Apex linter       │
  │     v0.1.15  ·  by CloudAlgo                 │
  │                                              │
  │  ⚠  v0.2.0 available                        │
  │     npm i -g @cloudalgo/apex-lint            │
  │     pnpm add -g @cloudalgo/apex-lint         │
  └──────────────────────────────────────────────┘
```

Fixed outer width: 50 chars. Unicode box-drawing characters: `┌ ─ ┐ │ └ ┘`. Triangle `▲` for the "apex" (peak) meaning. Warning `⚠` for the update line.

---

## Architecture

No new files. Two helper functions and one `printBanner` function added directly to `packages/apex-lint-cli/src/cli.ts`. The feature is too small to warrant a separate module.

### Version source

```ts
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const CURRENT_VERSION: string = (_require('../package.json') as { version: string }).version;
```

Reads from `packages/apex-lint-cli/package.json` at runtime. No hardcoding.

### `readUpdateCache(): { latest: string; checkedAt: number } | null`

- Reads `path.join(os.homedir(), '.apex-lint-update')` synchronously
- Parses JSON; returns `null` on any error (missing file, malformed JSON, wrong shape)
- Never throws

### `fireUpdateCheck(): void`

- Compares `Date.now()` to `cache.checkedAt`; skips if cache is less than 24 hours old
- If stale or missing: fires `fetch('https://registry.npmjs.org/@cloudalgo/apex-lint/latest')` as a detached promise — never `await`-ed, never blocks
- On fetch success: parses `json.version`, writes `{ latest, checkedAt: Date.now() }` to `~/.apex-lint-update`
- On any error (network, parse, write): silently discards — `catch(() => {})`

### `semverGt(a: string, b: string): boolean`

- Splits `major.minor.patch` on `.`, compares as integers tuple-wise
- Returns `true` if `a > b`, `false` otherwise
- No library. No pre-release handling (not needed).

### `printBanner(current: string, cachedLatest: string | null): void`

- Writes to `process.stderr`
- Renders the fixed 50-char box
- Calls `semverGt(cachedLatest, current)` — if true, appends the update section inside the box
- Never throws

---

## Call Sequence in `main()`

```ts
// 1. Parse args
const args = parseArgs(process.argv.slice(2));

// 2. Read cache (sync, instant)
const cache = readUpdateCache();

// 3. Fire background update check (async, fire-and-forget)
fireUpdateCheck();

// 4. Print banner (TTY-only, pretty mode, not --help, not --list-rules)
if (process.stderr.isTTY && args.format === 'pretty' && !args.help && !args.listRules) {
  printBanner(CURRENT_VERSION, cache?.latest ?? null);
}

// 5. ... rest of existing main() logic unchanged ...
```

---

## Display Conditions

| Condition | Banner shows |
|-----------|--------------|
| `stderr.isTTY === true` AND `format === 'pretty'` AND `!help` AND `!listRules` | Yes |
| `stderr.isTTY === false` (CI, piped) | No |
| `--format json` or `--format sarif` | No |
| `--help` or `--list-rules` | No |

Update section shows inside the banner only when `semverGt(cache.latest, CURRENT_VERSION)` is true.

---

## Cache File

Path: `~/.apex-lint-update`
Format:
```json
{ "latest": "0.2.0", "checkedAt": 1719446400000 }
```

TTL: 24 hours (`86_400_000` ms). Written by `fireUpdateCheck` on successful registry response. Silently ignored if missing, unreadable, or malformed.

---

## npm Registry Endpoint

`https://registry.npmjs.org/@cloudalgo/apex-lint/latest`

Response field used: `.version` (string).

---

## Out of Scope

- Pre-release / beta version handling
- Color / ANSI styling in the banner
- Configurable TTL or opt-out flag
- Showing the update notice at the end of scan output (always shown in banner)
