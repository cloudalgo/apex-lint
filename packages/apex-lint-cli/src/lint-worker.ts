import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import {
  Linter,
  allRules,
  FilesystemMetadataProvider,
  NullMetadataProvider,
} from "@cloudalgo/apex-core";
import { selectRules } from "./rules-select.js";
import type { WorkerInit, FileResult } from "./lint-pool.js";

// One worker lints a chunk of files. Rule objects can't cross the thread
// boundary, so we reconstruct the identical rule set from allRules + the config
// + the selection, and rebuild the metadata provider from the same roots.
const { files, roots, config, selection } = workerData as WorkerInit;

const rules = selectRules(allRules, config, selection);
const metadata = roots.length > 0
  ? new FilesystemMetadataProvider(roots)
  : new NullMetadataProvider();
const linter = new Linter(rules);

for (const file of files) {
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const r = linter.lint(src, { filePath: file, metadata });
  const violations = config.maxViolationsPerFile
    ? r.violations.slice(0, config.maxViolationsPerFile)
    : r.violations;
  const result: FileResult = {
    file,
    violations,
    suppressedCount: r.suppressedCount,
    syntaxErrors: r.syntaxErrors,
  };
  parentPort!.postMessage(result);
}
