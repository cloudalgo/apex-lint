// Engine
export { Linter } from "./engine/engine.js";
export type { LintOptions, LintFile, LintResult } from "./engine/engine.js";
export type {
  Rule,
  RuleContext,
  RuleListener,
  Violation,
  Severity,
  Category,
} from "./engine/types.js";

// Rules
export { allRules } from "./rules/index.js";
export * from "./rules/index.js";

// Metadata providers
export type {
  MetadataProvider,
  ObjectInfo,
  FieldInfo,
} from "./metadata/provider.js";
export { NullMetadataProvider } from "./metadata/provider.js";
export { FilesystemMetadataProvider } from "./metadata/filesystem-provider.js";
export { OrgMetadataProvider } from "./metadata/org-provider.js";
export type { JsforceLike } from "./metadata/org-provider.js";

// AST (for authoring custom rules)
export {
  walk,
  nodeType,
  lineOf,
  columnOf,
  endLineOf,
  textOf,
  isInsideLoop,
  ancestorOfType,
  enclosingMethod,
} from "./ast/walk.js";
export { parseApex } from "./ast/parser.js";
export type { ParsedUnit } from "./ast/parser.js";
