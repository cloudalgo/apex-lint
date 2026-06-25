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

// Allow leading line comments before the trigger keyword (common in real orgs)
const TRIGGER_RE = /^\s*(?:\/\/[^\n]*\n\s*)*trigger\b/i;

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

  const tree = TRIGGER_RE.test(source)
    ? parser.triggerUnit()
    : parser.compilationUnit();

  return { tree, source, syntaxErrors: errors };
}
