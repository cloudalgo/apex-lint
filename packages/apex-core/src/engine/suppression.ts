import { walk, nodeType, textOf, ancestorOfType } from "../ast/walk.js";

/** Find the MethodDeclarationContext member of a ClassBodyDeclarationContext, if any. */
function findMethodInDecl(classBodyDecl: any): any | undefined {
  for (let i = 0; i < (classBodyDecl.getChildCount?.() ?? 0); i++) {
    const member = classBodyDecl.getChild(i);
    if (nodeType(member) !== "MemberDeclarationContext") continue;
    for (let j = 0; j < (member.getChildCount?.() ?? 0); j++) {
      const child = member.getChild(j);
      if (nodeType(child) === "MethodDeclarationContext") return child;
    }
  }
  return undefined;
}

interface Suppression {
  ruleId: string | null; // null = wildcard (suppress all rules)
  startLine: number;
  endLine: number;
}

const NOPMD_RE = /\/\/\s*NOPMD(?:\s*:\s*(\w+))?\s*\r?$/i;
const SUPPRESS_WARN_RE = /suppresswarnings\(['"]([^'"]*)['"]\)/i;

export function buildSuppressions(source: string, tree: any): Suppression[] {
  const suppressions: Suppression[] = [];

  // Line-level: // NOPMD or // NOPMD: RuleId
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = NOPMD_RE.exec(lines[i]);
    if (m) {
      suppressions.push({ ruleId: m[1] ?? null, startLine: i + 1, endLine: i + 1 });
    }
  }

  // Annotation-level: @SuppressWarnings('PMD.RuleId') or @SuppressWarnings('PMD')
  walk(tree, (node) => {
    if (nodeType(node) !== "AnnotationContext") return;
    const m = SUPPRESS_WARN_RE.exec(textOf(node));
    if (!m) return;

    for (const val of m[1].split(",")) {
      const trimmed = val.trim();
      const lower = trimmed.toLowerCase();
      let ruleId: string | null;
      if (lower === "pmd") {
        ruleId = null;
      } else if (lower.startsWith("pmd.")) {
        ruleId = trimmed.slice(4).toLowerCase();
      } else {
        continue;
      }

      // AnnotationContext ancestor chain: Annotation → Modifier → ClassBodyDeclaration
      // → ClassBody → ClassDeclaration. MethodDeclarationContext is a sibling of
      // ModifierContext inside ClassBodyDeclaration, not an ancestor.
      const classBodyDecl = ancestorOfType(node, "ClassBodyDeclarationContext");
      const methodDecl = classBodyDecl ? findMethodInDecl(classBodyDecl) : undefined;
      const scope = methodDecl ?? ancestorOfType(node, "ClassDeclarationContext");
      if (!scope) continue;

      suppressions.push({
        ruleId,
        startLine: scope.start?.line ?? 1,
        endLine: scope.stop?.line ?? scope.start?.line ?? 1,
      });
    }
  });

  return suppressions;
}
