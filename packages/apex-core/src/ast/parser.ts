import { ApexParserFactory, ApexParser } from "@apexdevtools/apex-parser";

/**
 * A parsed Apex unit. We keep this deliberately thin: the rest of the engine
 * only ever touches `tree` and `syntaxErrors`, never the parser package
 * directly. If the grammar/runtime changes, this file is the only thing that
 * moves. (See README "Why wrap the parser".)
 */
export interface ParsedUnit {
  /** Root parse-tree node (a CompilationUnitContext or TriggerUnitContext). */
  tree: any;
  /** Source text, retained for column math and method-body slicing. */
  source: string;
  /** Syntax errors collected during parse (empty = clean parse). */
  syntaxErrors: SyntaxError[];
}

export interface SyntaxError {
  line: number;
  column: number;
  message: string;
}

/**
 * Returns true if `source` is a trigger file by finding the first non-comment,
 * non-whitespace token and checking whether it is `trigger`. Uses a sequential
 * scanner rather than a regex to avoid backtracking issues where the word
 * "trigger" inside a comment body can leak out and match the final \btrigger\b.
 */
function isTriggerSource(source: string): boolean {
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < len && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(i + 2, len);
      continue;
    }
    // Probe a fixed-length window ("trigger" = 7 chars + 1 for the \b boundary)
    // rather than slicing the whole remaining source.
    return /^trigger\b/i.test(source.slice(i, i + 8));
  }
  return false;
}

/**
 * Parse an Apex class or trigger. Inline SOQL/SOSL is parsed into the same
 * tree automatically by the grammar — no second parser needed.
 */
export function parseApex(source: string): ParsedUnit {
  const errors: SyntaxError[] = [];
  const parser: ApexParser = ApexParserFactory.createParser(source, false);

  // Swap the default console error listener for one that collects.
  parser.removeErrorListeners();
  parser.addErrorListener({
    syntaxError: (
      _recognizer: unknown,
      _offending: unknown,
      line: number,
      column: number,
      msg: string,
    ) => {
      errors.push({ line, column, message: msg });
    },
    // ANTLR's BaseErrorListener also defines these; no-ops are fine.
    reportAmbiguity: () => {},
    reportAttemptingFullContext: () => {},
    reportContextSensitivity: () => {},
  } as any);

  const tree = isTriggerSource(source)
    ? parser.triggerUnit()
    : parser.compilationUnit();

  return { tree, source, syntaxErrors: errors };
}
