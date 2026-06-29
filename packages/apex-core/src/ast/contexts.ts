// The ONLY module in apex-core that imports the parser's generated types.
// Rules import context types from HERE, never from @apexdevtools/apex-parser —
// preserving the "parser is wrapped, never imported by rules" boundary.
//
// NULL-FIDELITY CAVEAT: ANTLR accessors are typed non-null (e.g.
// `QueryContext.whereClause(): WhereClauseContext`) but return null at runtime
// when the clause is absent. Always truthy-check (`if (n.whereClause())`);
// never chain off an accessor as if it were guaranteed non-null.
import type { ParserRuleContext } from "antlr4";
import type {
  AnnotationContext,
  CatchClauseContext,
  ClassBodyDeclarationContext,
  ClassDeclarationContext,
  ConstructorDeclarationContext,
  DotExpressionContext,
  LiteralContext,
  MethodCallExpressionContext,
  MethodDeclarationContext,
  ModifierContext,
  NewExpressionContext,
  QueryContext,
  VariableDeclaratorContext,
  InsertStatementContext,
  UpdateStatementContext,
  DeleteStatementContext,
  UpsertStatementContext,
  UndeleteStatementContext,
} from "@apexdevtools/apex-parser";

/** The typed parse-tree base. Carries parentCtx, start, stop, getChild, getChildCount, getText. */
export type AstNode = ParserRuleContext;

// Re-export every context type rules reference (dispatched + cast-only). Add to
// this list when a rule needs a context not yet here (tsc will tell you).
export type {
  AnnotationContext,
  CatchClauseContext,
  ClassBodyDeclarationContext,
  ClassDeclarationContext,
  ConstructorDeclarationContext,
  DotExpressionContext,
  LiteralContext,
  MethodCallExpressionContext,
  MethodDeclarationContext,
  ModifierContext,
  NewExpressionContext,
  QueryContext,
  VariableDeclaratorContext,
  // DML statement contexts — dispatched on directly (loops.ts / crud.ts / async.ts):
  InsertStatementContext,
  UpdateStatementContext,
  DeleteStatementContext,
  UpsertStatementContext,
  UndeleteStatementContext,
  // cast-only (used inside walk callbacks / accessor chains):
  WhereClauseContext,
  LimitClauseContext,
  IdContext,
  TypeRefContext,
  BlockContext,
  LocalVariableDeclarationContext,
  VariableDeclaratorsContext,
  FormalParameterContext,
} from "@apexdevtools/apex-parser";

/** Closed map: listener key name → its context type. The keys are the exhaustive
 *  set of context types rules dispatch on. */
export interface ContextMap {
  AnnotationContext: AnnotationContext;
  CatchClauseContext: CatchClauseContext;
  ClassBodyDeclarationContext: ClassBodyDeclarationContext;
  ClassDeclarationContext: ClassDeclarationContext;
  ConstructorDeclarationContext: ConstructorDeclarationContext;
  DotExpressionContext: DotExpressionContext;
  LiteralContext: LiteralContext;
  MethodCallExpressionContext: MethodCallExpressionContext;
  MethodDeclarationContext: MethodDeclarationContext;
  ModifierContext: ModifierContext;
  NewExpressionContext: NewExpressionContext;
  QueryContext: QueryContext;
  VariableDeclaratorContext: VariableDeclaratorContext;
  InsertStatementContext: InsertStatementContext;
  UpdateStatementContext: UpdateStatementContext;
  DeleteStatementContext: DeleteStatementContext;
  UpsertStatementContext: UpsertStatementContext;
  UndeleteStatementContext: UndeleteStatementContext;
}

/** Typed rule listener — each handler receives its context type. Wired into
 *  engine/types.ts in the final task. */
export type RuleListener = { [K in keyof ContextMap]?: (node: ContextMap[K]) => void };
