#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from "node:fs";
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
import { loadConfig, type ApexLintConfig } from "./config.js";
import { discoverApexFiles } from "./discover.js";
import { reportPretty, reportJson } from "./reporters/text.js";
import { reportSarif } from "./reporters/sarif.js";
import { ProgressBar } from "./progress.js";
import { createRequire } from "node:module";
import { readUpdateCache, fireUpdateCheck, printBanner } from "./update.js";

const _require = createRequire(import.meta.url);
const CURRENT_VERSION = (_require('../package.json') as { version: string }).version;

const SEV_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  moderate: 3,
  low: 2,
  info: 1,
};

const VALID_FORMATS = ["pretty", "json", "sarif"] as const;
const VALID_SEVERITIES = Object.keys(SEV_RANK) as Severity[];

/** Thrown for bad invocation; caught at the top level → stderr + exit 2. */
class UsageError extends Error {}

interface Args {
  paths: string[];
  format: "pretty" | "json" | "sarif";
  failOn: Severity | undefined;
  configPath?: string;
  outputPath?: string;
  metadataRoots: string[];
  listRules: boolean;
  help: boolean;
  /** CLI --rules: only run these rule IDs (overrides config). */
  rules?: string[];
  /** CLI --exclude-rules: exclude these rule IDs (merged with config). */
  excludeRules?: string[];
  /** CLI --categories: only run rules in these categories (overrides config). */
  categories?: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    paths: [],
    format: "pretty",
    failOn: undefined,
    metadataRoots: [],
    listRules: false,
    help: false,
  };
  // Reads the value following a value-flag, erroring if it is missing.
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("-")) {
      throw new UsageError(`Option ${flag} requires a value.`);
    }
    return v;
  };
  const list = (i: number, flag: string): string[] =>
    value(i, flag).split(",").map((s) => s.trim()).filter(Boolean);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--format":
      case "-f": {
        const fmt = value(i++, a);
        if (!(VALID_FORMATS as readonly string[]).includes(fmt)) {
          throw new UsageError(`Invalid --format "${fmt}". Expected: ${VALID_FORMATS.join(" | ")}.`);
        }
        args.format = fmt as Args["format"];
        break;
      }
      case "--fail-on": {
        const sev = value(i++, a);
        if (!(VALID_SEVERITIES as string[]).includes(sev)) {
          throw new UsageError(`Invalid --fail-on "${sev}". Expected: ${VALID_SEVERITIES.join(" | ")}.`);
        }
        args.failOn = sev as Severity;
        break;
      }
      case "--config":
      case "-c":
        args.configPath = value(i++, a);
        break;
      case "--output":
      case "-o":
        args.outputPath = value(i++, a);
        break;
      case "--metadata-root":
        args.metadataRoots.push(value(i++, a));
        break;
      case "--list-rules":
        args.listRules = true;
        break;
      case "--rules":
        args.rules = list(i++, a);
        break;
      case "--exclude-rules":
        args.excludeRules = list(i++, a);
        break;
      case "--categories":
        args.categories = list(i++, a);
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (a.startsWith("-")) {
          throw new UsageError(`Unknown option: ${a}`);
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
  -f, --format <fmt>          pretty | json | sarif               (default: pretty)
  -o, --output <file>         write results to file instead of stdout
      --fail-on <sev>         fail build at this severity+        (default: moderate)
                              critical | high | moderate | low | info
  -c, --config <file>         path to config json (default: apexlint.config.json)
      --rules <ids>           comma-separated rule IDs to run     (default: all)
      --exclude-rules <ids>   comma-separated rule IDs to exclude
      --categories <cats>     comma-separated categories to run
                              security | performance | error-prone | design
                              best-practices | code-style
      --metadata-root <dir>   sfdx project dir for SObject metadata (repeatable)
      --list-rules            print the rule catalog and exit
  -h, --help                  show this help

Config file (apexlint.config.json or .apexlintrc.json, auto-discovered):
  {
    "rules": ["SoqlInLoop", "ApexSOQLInjection"],   // run only these rules
    "excludeRules": ["MethodNamingConventions"],     // skip these rules
    "categories": ["security", "performance"],       // run only these categories
    "severityOverrides": { "EmptyCatchBlock": "critical" },
    "excludePaths": ["**/*Test.cls", "**/legacy/**"],
    "maxViolationsPerFile": 50,
    "metadataRoots": ["./force-app"],
    "failOn": "high"
  }

Exit codes: 0 = clean (below threshold), 1 = violations at/above threshold, 2 = usage error.`;

/**
 * Filter and configure the rule set.
 * Priority: CLI flags > config file > defaults (all rules, all categories).
 */
function selectRules(
  rules: Rule[],
  config: ApexLintConfig,
  cli: { rules?: string[]; excludeRules?: string[]; categories?: string[] },
): Rule[] {
  // Include list: CLI overrides config
  const includeIds = cli.rules ?? config.rules;
  const includeSet = includeIds ? new Set(includeIds.map((s) => s.toLowerCase())) : null;
  // Exclude list: CLI + config merged
  const excludeIds = new Set<string>([
    ...config.disabledRules,
    ...(config.excludeRules ?? []),
    ...(cli.excludeRules ?? []),
  ]);
  // Category filter: CLI overrides config
  const cats = cli.categories ?? config.categories;

  return rules
    .filter((r) => !excludeIds.has(r.id))
    // Opt-in rules run only when named explicitly in the include list.
    .filter((r) => !r.optIn || (includeSet?.has(r.id.toLowerCase()) ?? false))
    .filter((r) => !includeSet || includeSet.has(r.id.toLowerCase()))
    .filter((r) => !cats || cats.map((s) => s.toLowerCase()).includes(r.category.toLowerCase()))
    .map((r) => (config.severityOverrides[r.id] ? { ...r, severity: config.severityOverrides[r.id] } : r));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const cache = readUpdateCache();
  if (!args.help && !args.listRules) {
    fireUpdateCheck();
  }
  if (process.stderr.isTTY === true && args.format === 'pretty' && !args.help && !args.listRules) {
    printBanner(CURRENT_VERSION, cache?.latest ?? null);
  }

  if (args.help) {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (args.listRules) {
    const categories = [...new Set(allRules.map((r) => r.category))];
    for (const cat of categories) {
      const catRules = allRules.filter((r) => r.category === cat);
      process.stdout.write(`\n${cat} (${catRules.length})\n${"─".repeat(cat.length + 4)}\n`);
      for (const r of catRules) {
        const tags = `${r.needsMetadata ? " [metadata]" : ""}${r.optIn ? " [opt-in]" : ""}`;
        process.stdout.write(`  ${r.id.padEnd(32)} ${r.severity.padEnd(10)} ${r.description}${tags}\n`);
      }
    }
    process.stdout.write(`\n${allRules.length} rules total.\n`);
    return;
  }
  if (args.paths.length === 0) {
    process.stderr.write("Error: no input paths given.\n\n" + HELP + "\n");
    process.exit(2);
  }

  const { config, path: cfgPath } = loadConfig(cwd, args.configPath);

  const rules = selectRules(allRules, config, {
    rules: args.rules,
    excludeRules: args.excludeRules,
    categories: args.categories,
  });

  if (rules.length === 0) {
    process.stderr.write("Warning: no rules selected after filtering — check --rules / --categories / config.\n");
    process.exit(0);
  }

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

  // Output
  const emit = args.outputPath
    ? (s: string) => writeFileSync(resolve(args.outputPath!), s, "utf8")
    : (s: string) => process.stdout.write(s);

  if (args.format === "json") {
    emit(reportJson(all) + "\n");
  } else if (args.format === "sarif") {
    emit(reportSarif(all, rules, cwd, CURRENT_VERSION) + "\n");
  } else {
    if (cfgPath) process.stderr.write(`Using config: ${cfgPath}\n`);
    const suppNote = totalSuppressed > 0 ? `, ${totalSuppressed} suppressed` : "";
    const ruleNote = rules.length < allRules.length ? `, ${rules.length}/${allRules.length} rules active` : "";
    process.stderr.write(
      `Scanned ${files.length} file(s)${ruleNote}${suppNote}` +
        (metadata instanceof FilesystemMetadataProvider ? `, ${metadata.objectNames().length} SObject(s) known.\n` : ".\n"),
    );
    emit(reportPretty(all, cwd) + "\n");
    if (syntaxProblems.length) {
      process.stderr.write("\nParse errors:\n" + syntaxProblems.join("\n") + "\n");
    }
  }
  if (args.outputPath) process.stderr.write(`Results written to ${args.outputPath}\n`);

  // Exit code: CLI --fail-on > config failOn > default "moderate"
  const failOn = args.failOn ?? config.failOn ?? "moderate";
  const threshold = SEV_RANK[failOn];
  const failing = all.some((v) => SEV_RANK[v.severity] >= threshold);
  process.exit(failing ? 1 : 0);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

try {
  main();
} catch (err) {
  if (err instanceof UsageError) {
    process.stderr.write(`Error: ${err.message}\n\nRun apex-lint --help for usage.\n`);
    process.exit(2);
  }
  // Unexpected failure (e.g. malformed config): report and exit 2, not 1,
  // so CI distinguishes a tool error from "violations found".
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}
