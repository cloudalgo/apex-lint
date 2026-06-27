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

const ID_15 = /^[a-zA-Z0-9]{15}$/;
const ID_18 = /^[a-zA-Z0-9]{18}$/;
// Real low-volume IDs carry a run of padding zeros (instance + reserved char +
// left-padded record number). Random tokens like "a1b2c3d4e5f6g7h" do not.
const ZERO_RUN = /0{3,}/;
const CHECKSUM_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

/**
 * Validates the 3-char case-insensitivity checksum suffix of an 18-char ID.
 * Each 5-char chunk of the first 15 chars maps to one suffix char via a bitmask
 * of which positions are uppercase. A random 18-char token passes by chance only
 * ~1/32768, so this reliably rejects base64/hash literals.
 */
function valid18CharChecksum(id: string): boolean {
  let suffix = "";
  for (let chunk = 0; chunk < 3; chunk++) {
    let bits = 0;
    for (let i = 0; i < 5; i++) {
      const c = id[chunk * 5 + i];
      if (c >= "A" && c <= "Z") bits |= 1 << i;
    }
    suffix += CHECKSUM_ALPHABET[bits];
  }
  return id.slice(15).toUpperCase() === suffix;
}

/** Heuristic test for a Salesforce record ID literal (vs. an arbitrary token). */
function isSalesforceId(s: string): boolean {
  if (ID_18.test(s)) return valid18CharChecksum(s);
  // 15-char IDs have no checksum; require the zero-padding signature real IDs carry.
  if (ID_15.test(s)) return ZERO_RUN.test(s);
  return false;
}

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
        if (isSalesforceId(inner)) {
          ctx.report(node, `Hardcoded record ID "${inner}" — query or use Custom Metadata instead.`);
        }
      },
    };
  },
};
