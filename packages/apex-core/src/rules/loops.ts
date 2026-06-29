import type { Rule } from "../engine/types.js";
import type {
  AstNode,
  QueryContext,
  InsertStatementContext,
  UpdateStatementContext,
  DeleteStatementContext,
  UpsertStatementContext,
  UndeleteStatementContext,
} from "../ast/contexts.js";
import { isInsideLoop } from "../ast/walk.js";

/** SOQL query (`[SELECT ...]`) executed inside a loop — governor-limit risk. */
export const soqlInLoop: Rule = {
  id: "SoqlInLoop",
  category: "performance",
  severity: "high",
  description: "SOQL queries should not run inside loops (governor limits).",
  create(ctx) {
    return {
      QueryContext: (node: QueryContext) => {
        if (isInsideLoop(node)) {
          ctx.report(node, "SOQL query inside a loop — move it outside and bulkify.");
        }
      },
    };
  },
};

const DML_CONTEXTS: Record<string, string> = {
  InsertStatementContext: "insert",
  UpdateStatementContext: "update",
  DeleteStatementContext: "delete",
  UpsertStatementContext: "upsert",
  UndeleteStatementContext: "undelete",
};

/** DML statement inside a loop — governor-limit risk. */
export const dmlInLoop: Rule = {
  id: "DmlInLoop",
  category: "performance",
  severity: "high",
  description: "DML statements should not run inside loops (governor limits).",
  create(ctx) {
    const listener: Record<string, (n: AstNode) => void> = {};
    for (const [type, verb] of Object.entries(DML_CONTEXTS)) {
      listener[type] = (node: AstNode) => {
        if (isInsideLoop(node)) {
          ctx.report(node, `${verb.toUpperCase()} DML inside a loop — collect records and DML once after the loop.`);
        }
      };
    }
    return listener;
  },
};
