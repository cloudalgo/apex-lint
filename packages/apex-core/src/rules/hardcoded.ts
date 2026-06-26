import type { Rule } from "../engine/types.js";
import { nodeType, textOf } from "../ast/walk.js";

function classHasIsTest(classNode: any): boolean {
  const typeDecl = classNode.parentCtx;
  if (!typeDecl) return false;
  for (let i = 0; i < (typeDecl.getChildCount?.() ?? 0); i++) {
    const child = typeDecl.getChild(i);
    if (nodeType(child) !== "ModifierContext") continue;
    for (let j = 0; j < (child.getChildCount?.() ?? 0); j++) {
      const ann = child.getChild(j);
      if (nodeType(ann) === "AnnotationContext" &&
          textOf(ann).replace(/^@/, "").split("(")[0].toLowerCase() === "istest") return true;
    }
  }
  return false;
}

// 15- or 18-char alphanumeric, must contain a digit (cuts false positives like
// plain words). Salesforce record IDs always include digits in the key prefix.
const ID_BODY = /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/;
const HAS_DIGIT = /[0-9]/;

/** Hardcoded Salesforce record IDs break across orgs/sandboxes. */
export const avoidHardcodedId: Rule = {
  id: "AvoidHardcodedId",
  category: "error-prone",
  severity: "moderate",
  description: "Avoid hardcoding Salesforce record IDs; they differ across orgs.",
  create(ctx) {
    let inTestClass = false;
    return {
      ClassDeclarationContext: (node) => {
        if (nodeType(node.parentCtx) === "TypeDeclarationContext") {
          inTestClass = classHasIsTest(node);
        }
      },
      LiteralContext: (node) => {
        if (inTestClass) return;
        const raw = textOf(node);
        if (raw.length < 17) return; // 15 chars + 2 quotes
        if (raw[0] !== "'" || raw[raw.length - 1] !== "'") return;
        const inner = raw.slice(1, -1);
        if (ID_BODY.test(inner) && HAS_DIGIT.test(inner)) {
          ctx.report(node, `Hardcoded record ID "${inner}" — query or use Custom Metadata instead.`);
        }
      },
    };
  },
};
