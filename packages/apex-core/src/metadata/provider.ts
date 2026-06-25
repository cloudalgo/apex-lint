/**
 * The metadata seam. Type-aware rules (CRUD/FLS, injection) ask the provider to
 * resolve SObject and field information. Two implementations ship:
 *   - FilesystemMetadataProvider: reads an sfdx project's objects/ folder (CLI, CI)
 *   - OrgMetadataProvider:        describes a live org via jsforce (AlgoScope)
 * Rules depend only on this interface, so neither knows which is in play.
 */

export interface FieldInfo {
  name: string;
  type: string; // e.g. "Text", "Lookup", "Checkbox" — provider-specific
}

export interface ObjectInfo {
  /** Canonical API name, e.g. "Account" or "Invoice__c". */
  name: string;
  fields: Map<string, FieldInfo>;
}

export interface MetadataProvider {
  /** Case-insensitive lookup. Returns undefined for unknown objects. */
  getObject(name: string): ObjectInfo | undefined;
  hasObject(name: string): boolean;
  /** All known object API names (for diagnostics / completeness checks). */
  objectNames(): string[];
}

/**
 * Used when no metadata source is available. Type-aware rules should degrade
 * gracefully: with a null provider they either skip or fall back to a heuristic,
 * never crash.
 */
export class NullMetadataProvider implements MetadataProvider {
  getObject(): undefined {
    return undefined;
  }
  hasObject(): boolean {
    return false;
  }
  objectNames(): string[] {
    return [];
  }
}
