import type { Rule } from "../engine/types.js";
import { textOf } from "../ast/walk.js";

/** Catch block with no statements — swallows exceptions silently. */
export const emptyCatchBlock: Rule = {
  id: "EmptyCatchBlock",
  category: "error-prone",
  severity: "moderate",
  description: "Catch blocks should not be empty; at minimum log the exception.",
  create(ctx) {
    return {
      CatchClauseContext: (node) => {
        const block = node.block ? node.block() : null;
        if (!block) return;
        let stmts = block.statement ? block.statement() : [];
        if (stmts && !Array.isArray(stmts)) stmts = [stmts];
        if (!stmts || stmts.length === 0) {
          ctx.report(node, "Empty catch block — handle or log the exception.");
        }
      },
    };
  },
};

const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;

/** Method names should be camelCase. */
export const methodNamingConventions: Rule = {
  id: "MethodNamingConventions",
  category: "code-style",
  severity: "low",
  description: "Method names should be in camelCase.",
  create(ctx) {
    return {
      MethodDeclarationContext: (node) => {
        const idNode = node.id ? node.id() : null;
        const name = idNode ? textOf(idNode) : "";
        if (name && !CAMEL_CASE.test(name)) {
          ctx.report(idNode ?? node, `Method "${name}" should be camelCase.`);
        }
      },
    };
  },
};
