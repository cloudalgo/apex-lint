import { readdirSync, readFileSync, existsSync, statSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type {
  FieldInfo,
  MetadataProvider,
  ObjectInfo,
} from "./provider.js";

/**
 * Reads SObject + field metadata from an sfdx project on disk. This is the CLI /
 * CI provider — no org connection required. It scans every objects directory,
 * registering each "<Name>/" folder as an SObject and reading its
 * "fields/<Field>.field-meta.xml" files. Standard objects that appear in the
 * project (e.g. Account/) and custom objects (Invoice__c/) are both picked up.
 *
 * Parsing is intentionally regex-based and dependency-free: we only need the
 * object name and field api names/types, not a full XML tree.
 */
export class FilesystemMetadataProvider implements MetadataProvider {
  private objects = new Map<string, ObjectInfo>(); // key = lowercased name

  constructor(projectRoots: string[]) {
    for (const root of projectRoots) this.scan(root);
  }

  static fromProject(root: string): FilesystemMetadataProvider {
    return new FilesystemMetadataProvider([root]);
  }

  getObject(name: string): ObjectInfo | undefined {
    return this.objects.get(name.toLowerCase());
  }
  hasObject(name: string): boolean {
    return this.objects.has(name.toLowerCase());
  }
  objectNames(): string[] {
    return [...this.objects.values()].map((o) => o.name);
  }

  private scan(root: string): void {
    if (!existsSync(root)) return;
    for (const objectsDir of this.findObjectsDirs(root)) {
      for (const entry of readdirSync(objectsDir)) {
        const objDir = join(objectsDir, entry);
        if (!isDir(objDir)) continue;
        const meta = join(objDir, `${entry}.object-meta.xml`);
        // An object folder qualifies even without the -meta.xml (standard objects
        // often ship only field files), so we register on the folder name.
        const info: ObjectInfo = {
          name: entry,
          fields: this.readFields(join(objDir, "fields")),
        };
        this.objects.set(entry.toLowerCase(), info);
        void meta;
      }
    }
  }

  private readFields(fieldsDir: string): Map<string, FieldInfo> {
    const fields = new Map<string, FieldInfo>();
    if (!existsSync(fieldsDir)) return fields;
    for (const f of readdirSync(fieldsDir)) {
      if (!f.endsWith(".field-meta.xml")) continue;
      const apiName = f.replace(/\.field-meta\.xml$/, "");
      let type = "Unknown";
      try {
        const xml = readFileSync(join(fieldsDir, f), "utf8");
        const m = xml.match(/<type>([^<]+)<\/type>/i);
        if (m) type = m[1];
      } catch {
        /* unreadable field file — keep Unknown */
      }
      fields.set(apiName.toLowerCase(), { name: apiName, type });
    }
    return fields;
  }

  /**
   * Recursively locate every directory literally named "objects". Symlinks are
   * skipped (not followed) and a visited real-path set guards against cycles, so
   * a looping or self-referential project tree can't trigger unbounded recursion.
   */
  private findObjectsDirs(root: string, acc: string[] = [], seen: Set<string> = new Set()): string[] {
    let real: string;
    try {
      real = realpathSync(root);
    } catch {
      return acc;
    }
    if (seen.has(real)) return acc;
    seen.add(real);

    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      return acc;
    }
    for (const e of entries) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const p = join(root, e);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink() || !st.isDirectory()) continue; // don't follow symlinks
      if (e === "objects") acc.push(p);
      else this.findObjectsDirs(p, acc, seen);
    }
    return acc;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
