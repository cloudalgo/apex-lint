import type {
  FieldInfo,
  MetadataProvider,
  ObjectInfo,
} from "./provider.js";

/**
 * Minimal shape of the jsforce connection we depend on. Declared structurally so
 * apex-core does NOT take a hard dependency on jsforce — AlgoScope passes in its
 * already-authenticated connection. (Keeps the engine installable in CI without
 * dragging jsforce along.)
 */
export interface JsforceLike {
  describeGlobal(): Promise<{ sobjects: { name: string }[] }>;
  describe(sobject: string): Promise<{
    name: string;
    fields: { name: string; type: string }[];
  }>;
}

/**
 * Live-org provider. Because describes are async and the rule engine is sync,
 * call `await provider.preload(names)` once before linting to populate the cache,
 * then the synchronous getObject/hasObject the rules use will hit warm data.
 *
 * STATUS: wiring stub. The cache + sync interface are real; preload is the piece
 * AlgoScope finishes against its jsforce connection. Left unimplemented on
 * purpose so org auth is validated on your machine, not guessed here.
 */
export class OrgMetadataProvider implements MetadataProvider {
  private cache = new Map<string, ObjectInfo>();

  constructor(private readonly conn: JsforceLike) {}

  /** Warm the cache for the given objects (or all, if omitted — use sparingly). */
  async preload(objectNames?: string[]): Promise<void> {
    const names =
      objectNames ??
      (await this.conn.describeGlobal()).sobjects.map((s) => s.name);
    for (const name of names) {
      try {
        const d = await this.conn.describe(name);
        const fields = new Map<string, FieldInfo>();
        for (const f of d.fields) {
          fields.set(f.name.toLowerCase(), { name: f.name, type: f.type });
        }
        this.cache.set(d.name.toLowerCase(), { name: d.name, fields });
      } catch {
        /* skip objects we can't describe (perms, deprecated) */
      }
    }
  }

  getObject(name: string): ObjectInfo | undefined {
    return this.cache.get(name.toLowerCase());
  }
  hasObject(name: string): boolean {
    return this.cache.has(name.toLowerCase());
  }
  objectNames(): string[] {
    return [...this.cache.values()].map((o) => o.name);
  }
}
