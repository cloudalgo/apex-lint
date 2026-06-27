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

// Compare release versions only. Strip any prerelease/build metadata first so
// "1.2.0-beta" parses as [1,2,0] rather than [1,2,NaN] (NaN comparisons are all
// false, which silently broke the "update available" check on prerelease tags).
function releaseParts(v: string): number[] {
  return v.split('+')[0].split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
}

export function semverGt(a: string, b: string): boolean {
  const pa = releaseParts(a);
  const pb = releaseParts(b);
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
  // Respect the common opt-outs; never phone home in CI.
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI) return;
  const cache = readUpdateCache();
  if (cache && Date.now() - cache.checkedAt < UPDATE_TTL_MS) return;
  void fetch('https://registry.npmjs.org/@cloudalgo/apex-lint/latest', {
    signal: AbortSignal.timeout(3000),
  })
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
  const hr = `  ┌${'─'.repeat(DASH_COUNT)}┐`;
  const br = `  └${'─'.repeat(DASH_COUNT)}┘`;

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
