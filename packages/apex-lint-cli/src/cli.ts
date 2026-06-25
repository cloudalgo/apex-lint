#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  Linter,
  allRules,
  FilesystemMetadataProvider,
  NullMetadataProvider,
  type Rule,
  type Severity,
  type Violation,
} from "@cloudalgo/apex-core";
import { loadConfig } from "./config.js";
import { discoverApexFiles } from "./discover.js";
import { reportPretty, reportJson, countBySeverity } from "./reporters/text.js";
import { reportSarif } from "./reporters/sarif.js";

const SEV_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  moderate: 3,
  low: 2,
  info: 1,
};

interface Args {
  paths: string[];
  format: "pretty" | "json" | "sarif";
  failOn: Severity;
  configPath?: string;
  metadataRoots: string[];
  listRules: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    paths: [],
    format: "pretty",
    failOn: "moderate",
    metadataRoots: [],
    listRules: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--format":
      case "-f":
        args.format = argv[++i] as Args["format"];
        break;
      case "--fail-on":
        args.failOn = argv[++i] as Severity;
        break;
      case "--config":
      case "-c":
        args.configPath = argv[++i];
        break;
      case "--metadata-root":
        args.metadataRoots.push(argv[++i]);
        break;
      case "--list-rules":
        args.listRules = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (a.startsWith("-")) {
          process.stderr.write(`Unknown option: ${a}\n`);
          process.exit(2);
        }
        args.paths.push(a);
    }
  }
  return args;
}

const HELP = `apex-lint — zero-JVM static analysis for Salesforce Apex

Usage:
  apex-lint <path...> [options]

Options:
  -f, --format <fmt>      pretty | json | sarif        (default: pretty)
      --fail-on <sev>     fail build at this severity+  (default: moderate)
                          critical | high | moderate | low | info
  -c, --config <file>     path to config json
      --metadata-root <d> sfdx project dir for SObject metadata (repeatable)
      --list-rules        print the rule catalog and exit
  -h, --help              show this help

Exit codes: 0 = clean (below threshold), 1 = violations at/above threshold, 2 = usage error.`;

function applyConfig(rules: Rule[], overrides: Record<string, Severity>, disabled: Set<string>): Rule[] {
  return rules
    .filter((r) => !disabled.has(r.id))
    .map((r) => (overrides[r.id] ? { ...r, severity: overrides[r.id] } : r));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (args.help) {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (args.listRules) {
    process.stdout.write("Built-in rules:\n\n");
    for (const r of allRules) {
      const tag = r.needsMetadata ? " [metadata]" : "";
      process.stdout.write(
        `  ${r.id.padEnd(26)} ${r.severity.padEnd(9)} ${r.category}${tag}\n      ${r.description}\n`,
      );
    }
    return;
  }
  if (args.paths.length === 0) {
    process.stderr.write("Error: no input paths given.\n\n" + HELP + "\n");
    process.exit(2);
  }

  const { config, path: cfgPath } = loadConfig(cwd, args.configPath);
  const disabled = new Set(config.disabledRules);
  const rules = applyConfig(allRules, config.severityOverrides, disabled);

  // Metadata: explicit flags > config > auto (the target dirs themselves).
  const roots =
    args.metadataRoots.length > 0
      ? args.metadataRoots
      : config.metadataRoots.length > 0
        ? config.metadataRoots
        : args.paths.map((p) => (isDir(p) ? p : cwd));
  const metadata =
    roots.length > 0 ? new FilesystemMetadataProvider(roots.map((r) => resolve(r))) : new NullMetadataProvider();

  const linter = new Linter(rules);
  const files = discoverApexFiles(args.paths.map((p) => resolve(p)));
  const all: Violation[] = [];
  const syntaxProblems: string[] = [];

  for (const file of files) {
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const result = linter.lint(src, { filePath: file, metadata });
    all.push(...result.violations);
    for (const e of result.syntaxErrors) {
      syntaxProblems.push(`${file}:${e.line}:${e.column} parse error: ${e.message}`);
    }
  }

  // Output
  if (args.format === "json") {
    process.stdout.write(reportJson(all) + "\n");
  } else if (args.format === "sarif") {
    process.stdout.write(reportSarif(all, rules, cwd) + "\n");
  } else {
    if (cfgPath) process.stderr.write(`Using config: ${cfgPath}\n`);
    process.stderr.write(`Scanned ${files.length} file(s)` +
      (metadata instanceof FilesystemMetadataProvider ? `, ${metadata.objectNames().length} SObject(s) known.\n` : ".\n"));
    process.stdout.write(reportPretty(all, cwd) + "\n");
    if (syntaxProblems.length) {
      process.stderr.write("\nParse errors:\n" + syntaxProblems.join("\n") + "\n");
    }
  }

  // Exit code from threshold
  const threshold = SEV_RANK[args.failOn];
  const failing = all.some((v) => SEV_RANK[v.severity] >= threshold);
  void countBySeverity;
  process.exit(failing ? 1 : 0);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

main();
