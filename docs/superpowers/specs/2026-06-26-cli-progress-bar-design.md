# CLI Progress Bar — Design Spec
Date: 2026-06-26

## Overview

Add a live, in-place progress bar to `apex-lint` CLI output so users get visual feedback while scanning large Apex codebases. Zero new runtime dependencies — implemented entirely with ANSI escape codes and `process.stderr`.

---

## Architecture

One new file is added:

```
packages/apex-lint-cli/src/progress.ts   ← new, self-contained ProgressBar class
packages/apex-lint-cli/src/cli.ts        ← 3 call sites added to the scan loop
```

No changes to `apex-core`, reporters, `discover.ts`, `config.ts`, or any other file.

### Integration points in `cli.ts`

```ts
const bar = new ProgressBar(files.length);        // before loop
for (const file of files) {
  // ...existing lint logic...
  bar.tick(file, all.length);                      // after each file
}
bar.done();                                        // after loop, before output
```

---

## ProgressBar class (`progress.ts`)

### Constructor

```ts
new ProgressBar(total: number)
```

- If `total === 0` or `!process.stderr.isTTY`, the instance becomes a no-op (all methods do nothing).
- Captures `total`, initialises `current = 0`.

### `tick(filePath: string, violationCount: number): void`

Increments `current`, then renders and writes the bar line to stderr via `\r`.

### `done(): void`

Clears the progress line by writing `\r` + spaces + `\r`, leaving the cursor at the start of the line so the normal summary line (`Scanned N file(s)…`) prints cleanly on a fresh line.

---

## Bar Format

```
scanning  [████████████████░░░░░░░░░░░░░░░░] 38%  421/1084  ·  1,203 violations  ·  CurrentClass.cls
```

| Segment | Detail |
|---------|--------|
| Label | Literal `scanning  ` (two trailing spaces) |
| `[…]` bar | 32-char fixed width; `█` filled, `░` empty |
| Percent | `  38%` — integer, right-aligned to 4 chars including `%` |
| Counts | `421/1084` |
| Separator | ` · ` |
| Violations | `1,203 violations` — number formatted with `toLocaleString('en-US')` |
| Separator | ` · ` |
| Filename | `path.basename(filePath)`, truncated with `…` if total line length exceeds `process.stderr.columns - 2` |

### Width clamping

```ts
const maxWidth = process.stderr.columns ?? 120;
```

If the assembled line is longer than `maxWidth - 2`, the filename is truncated:
```
…rrentClass.cls  →  …urrentClass.cls  (trim from left, prepend …)
```
If the line is still too long after truncating to 1 char, the filename segment is dropped entirely.

---

## TTY / CI behaviour

| Environment | Behaviour |
|-------------|-----------|
| Interactive terminal (`stderr.isTTY === true`) | Live progress bar |
| Piped / redirected stderr (`isTTY === false`) | Complete silence — no progress output |
| `total === 0` | No-op |

This ensures CI logs and piped usage (`apex-lint . 2>errors.txt`) are unaffected.

---

## What does NOT change

- `--format json` and `--format sarif` modes: progress still renders on stderr, output still goes to stdout (or `--output` file). No contamination.
- The final summary line (`Scanned N file(s) …`) still prints exactly as today via `process.stderr.write` after `bar.done()` clears the line.
- Parse error lines printed after the loop are unaffected.
- Exit codes are unaffected.

---

## Out of scope

- ETA / elapsed time display
- Multi-bar (one bar per rule category)
- Color (ANSI color codes) — plain characters only for maximum terminal compatibility
- Non-TTY progress fallback (e.g. "progress every 100 files" log line)
