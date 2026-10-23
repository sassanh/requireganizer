import {
  type ModuleEntry,
  type ModuleRegistry,
  siblingModuleEntries,
  visibleModules,
} from "lib/moduleSchema";
import {
  createModuleStore,
  type SiblingModuleReference,
  type Store,
} from "store";

/** The store a module export reads from. */
export interface ExportableModule {
  id: string;
  name: string | null;
  store: Store;
}

interface CacheEntry {
  snapshot: Record<string, unknown>;
  /** The snapshot's JSON: a registry that crossed a connection holds equal copies, not the same objects. */
  text: string;
  store: Store;
}

/**
 * Read-only stores for the open project's other modules, rebuilt only when a
 * module's stored snapshot changes. The authority's session and every replica
 * derive them from the registry they hold, so both resolve sibling
 * references the same way.
 */
export class SiblingModuleStores {
  private readonly cache = new Map<string, CacheEntry>();

  private storeFor(registry: ModuleRegistry, entry: ModuleEntry): Store | null {
    const hit = this.cache.get(entry.id);
    if (hit?.snapshot === entry.snapshot) return hit.store;
    const text = JSON.stringify(entry.snapshot);
    if (hit?.text === text) {
      hit.snapshot = entry.snapshot;
      return hit.store;
    }
    let created: Store;
    try {
      created = createModuleStore(entry.snapshot);
    } catch (error) {
      console.error(`Module “${entry.name}” could not be read.`, error);
      return null;
    }
    created.setModuleContext({ moduleMode: registry.modulesEnabled });
    this.cache.set(entry.id, { snapshot: entry.snapshot, text, store: created });
    return created;
  }

  private references(registry: ModuleRegistry): SiblingModuleReference[] {
    for (const id of [...this.cache.keys()]) {
      const entry = registry.modules.find((module) => module.id === id);
      if (entry == null || entry.archivedAt != null) this.cache.delete(id);
    }
    const references: SiblingModuleReference[] = [];
    for (const entry of siblingModuleEntries(registry)) {
      const sibling = this.storeFor(registry, entry);
      if (sibling != null) references.push({ id: entry.id, store: sibling });
    }
    return references;
  }

  /** Give the shown store its module mode and siblings; none without a registry. */
  applyModuleContext(store: Store, registry: ModuleRegistry | null): void {
    store.setModuleContext({ moduleMode: registry?.modulesEnabled ?? false });
    store.setSiblingModules(registry == null ? [] : this.references(registry));
  }

  /** Every visible module, backed by the shown store or a sibling store. */
  exportModules(registry: ModuleRegistry, shown: Store): ExportableModule[] {
    const modules: ExportableModule[] = [];
    for (const entry of visibleModules(registry)) {
      const name = registry.modulesEnabled ? entry.name : null;
      if (entry.id === registry.activeModuleId) {
        modules.push({ id: entry.id, name, store: shown });
        continue;
      }
      const sibling = this.storeFor(registry, entry);
      if (sibling != null) modules.push({ id: entry.id, name, store: sibling });
    }
    return modules;
  }
}
