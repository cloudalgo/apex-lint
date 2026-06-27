import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import type { Violation } from "@cloudalgo/apex-core";
import type { ApexLintConfig } from "./config.js";
import type { RuleSelection } from "./rules-select.js";

/** Per-file lint result handed back from a worker. */
export interface FileResult {
  file: string;
  violations: Violation[];
  suppressedCount: number;
  syntaxErrors: { line: number; column: number; message: string }[];
}

/** Init payload passed to each worker via workerData. All fields are structured-clone-safe. */
export interface WorkerInit {
  files: string[];
  roots: string[];
  config: ApexLintConfig;
  selection: RuleSelection;
}

/** Below this file count, worker startup overhead outweighs the parallelism gain. */
export const PARALLEL_THRESHOLD = 64;

function chunk<T>(items: T[], parts: number): T[][] {
  const out: T[][] = Array.from({ length: parts }, () => []);
  items.forEach((item, i) => out[i % parts].push(item));
  return out.filter((c) => c.length > 0);
}

/**
 * Lint `files` across a worker-thread pool. Each worker rebuilds its own rule set
 * and metadata provider from the (serializable) config + selection + roots, lints
 * its chunk, and streams back one message per file. Resolves once every worker
 * exits. Throws if any worker errors — the caller falls back to serial.
 */
export function lintInParallel(
  files: string[],
  roots: string[],
  config: ApexLintConfig,
  selection: RuleSelection,
  onResult: (r: FileResult) => void,
): Promise<void> {
  const workerUrl = new URL("./lint-worker.js", import.meta.url);
  const workers = Math.min(files.length, Math.max(1, availableParallelism() - 1));
  const chunks = chunk(files, workers);

  return Promise.all(
    chunks.map(
      (chunkFiles) =>
        new Promise<void>((resolve, reject) => {
          const init: WorkerInit = { files: chunkFiles, roots, config, selection };
          const w = new Worker(workerUrl, { workerData: init });
          w.on("message", (r: FileResult) => onResult(r));
          w.on("error", reject);
          w.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`lint worker exited with code ${code}`))));
        }),
    ),
  ).then(() => undefined);
}
