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

  if (withFile.length <= cols) return withFile;

  // Try truncating the filename to fit
  const budget = cols - base.length - 5; // "  ·  " is 5 chars
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
