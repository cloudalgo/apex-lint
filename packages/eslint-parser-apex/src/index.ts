import { ApexParserFactory } from "@apexdevtools/apex-parser";

// ─── ESTree-compatible node ───────────────────────────────────────────────────

export interface ApexNode {
  type: string;
  /** Children — the only property ESLint traverses via visitorKeys. */
  body: ApexNode[];
  loc: { start: Pos; end: Pos };
  range: [number, number];
  /** Original ANTLR context, unwrapped in the plugin adapter so rules get it. */
  _antlr: any;
}

interface Pos {
  line: number;
  column: number;
}

// ESLint needs to know which property holds children for each node type.
// We use a single "body" property for all types, so every type maps to ['body'].
export const visitorKeys: Record<string, string[]> = new Proxy(
  {} as Record<string, string[]>,
  { get: (_t, _k) => ["body"] },
);

// ─── ANTLR → ESTree conversion ────────────────────────────────────────────────

function toPos(token: any, isEnd = false): Pos {
  if (!token) return { line: 1, column: 0 };
  return {
    line: token.line ?? 1,
    column: isEnd
      ? (token.column ?? 0) + (token.text?.length ?? 1)
      : (token.column ?? 0),
  };
}

function convertNode(antlr: any): ApexNode {
  const start = antlr.start;
  const stop = antlr.stop;

  const node: ApexNode = {
    type: antlr.constructor?.name ?? "Unknown",
    body: [],
    loc: {
      start: toPos(start, false),
      end: toPos(stop, true),
    },
    range: [start?.startIndex ?? 0, (stop?.stopIndex ?? 0) + 1],
    _antlr: antlr,
  };

  const count = antlr.getChildCount?.() ?? 0;
  for (let i = 0; i < count; i++) {
    const child = antlr.getChild(i);
    // Only recurse into context nodes; skip terminal tokens
    if (child?.constructor?.name?.endsWith("Context")) {
      node.body.push(convertNode(child));
    }
  }

  return node;
}

// ─── Token extraction ─────────────────────────────────────────────────────────

interface EslintToken {
  type: string;
  value: string;
  range: [number, number];
  loc: { start: Pos; end: Pos };
}

/**
 * Extract ANTLR tokens from the token stream into ESLint's token format.
 * ESLint's SourceCode constructor validates that `ast.tokens` exists and is
 * an array; the content is used for eslint-disable comments and token-level
 * rules. We include all non-hidden-channel tokens.
 */
function extractTokens(parser: any, vocabulary: any): EslintToken[] {
  const stream = parser.inputStream ?? parser.tokenStream ?? parser._input;
  if (!stream) return [];
  // Fill the stream so all tokens are available
  stream.fill?.();
  const raw: any[] = stream.tokens ?? [];

  return raw
    .filter((t: any) => t.channel === 0 && t.type !== -1 /* EOF */)
    .map((t: any) => {
      const typeName: string =
        vocabulary?.getSymbolicName?.(t.type) ??
        vocabulary?.getLiteralName?.(t.type) ??
        "Token";
      const text: string = t.text ?? "";
      const startCol: number = t.column ?? 0;
      const endCol: number = startCol + text.length;
      return {
        type: typeName,
        value: text,
        range: [t.startIndex ?? 0, (t.stopIndex ?? 0) + 1] as [number, number],
        loc: {
          start: { line: t.line ?? 1, column: startCol },
          end: { line: t.line ?? 1, column: endCol },
        },
      };
    });
}

// ─── Parse entrypoint ─────────────────────────────────────────────────────────

const TRIGGER_RE = /^\s*(?:\/\/[^\n]*\n\s*)*trigger\b/i;

/** Synthetic root wrapping the real root so ESLint sees type="Program". */
function wrapAsProgram(root: ApexNode, tokens: EslintToken[]): any {
  return {
    type: "Program",
    body: [root],
    loc: root.loc,
    range: root.range,
    _antlr: root._antlr,
    tokens,
    comments: [],
  };
}

export interface ParseResult {
  ast: any;
  visitorKeys: Record<string, string[]>;
  /** Syntax errors collected during parse. */
  errors: Array<{ line: number; column: number; message: string }>;
}

/**
 * ESLint custom parser entrypoint.
 * ESLint calls `parseForESLint(text, options)` first; falls back to `parse`.
 */
export function parse(text: string, _options?: unknown): any {
  return parseForESLint(text, _options).ast;
}

const defaultExport = { parse, parseForESLint, meta: { name: "@cloudalgo/eslint-parser-apex", version: "0.1.0" } };
export default defaultExport;

export function parseForESLint(
  text: string,
  _options?: unknown,
): ParseResult {
  const errors: ParseResult["errors"] = [];

  const parser = ApexParserFactory.createParser(text, false);
  parser.removeErrorListeners();
  parser.addErrorListener({
    syntaxError: (
      _r: unknown,
      _o: unknown,
      line: number,
      column: number,
      msg: string,
    ) => {
      errors.push({ line, column, message: msg });
    },
    reportAmbiguity: () => {},
    reportAttemptingFullContext: () => {},
    reportContextSensitivity: () => {},
  } as any);

  const antlrRoot = TRIGGER_RE.test(text)
    ? parser.triggerUnit()
    : parser.compilationUnit();

  const tokens = extractTokens(parser, (parser as any).vocabulary);
  const ast = wrapAsProgram(convertNode(antlrRoot), tokens);
  return { ast, visitorKeys, errors };
}
