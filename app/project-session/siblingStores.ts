import {
  type ModuleEntry,
  type ModuleRegistry,
  siblingModuleEntries,
  visibleModules,
} from "lib/moduleSchema";
import { createModuleStore, type Store } from "store";
import type { LinkedModule } from "workflow";

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
 * derive them from the registry they hold, so both resolve dependencies on
 * other modules' items the same way.
 */
export class SiblingModuleStores {
  private readonly cache = new Map<string, CacheEntry>();

  private storeFor(entry: ModuleEntry): Store | null {
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
    this.cache.set(entry.id, { snapshot: entry.snapshot, text, store: created });
    return created;
  }

  /**
   * Link the shown store and every sibling store to the other modules of the
   * project, so a dependency on another module's item resolves, and judges
   * it out of date, the same way from every module.
   */
  applyModuleContext(store: Store, registry: ModuleRegistry | null): void {
    if (registry == null || !registry.modulesEnabled) {
      store.setLinkedModules([]);
      return;
    }
    for (const id of [...this.cache.keys()]) {
      const entry = registry.modules.find((module) => module.id === id);
      if (entry == null || entry.archivedAt != null) this.cache.delete(id);
    }
    const shownEntry = registry.modules.find((module) => module.id === registry.activeModuleId);
    const all: { id: string; name: string; store: Store }[] = shownEntry == null ? [] : [{ id: shownEntry.id, name: shownEntry.name, store }];
    for (const entry of siblingModuleEntries(registry)) {
      const sibling = this.storeFor(entry);
      if (sibling != null) all.push({ id: entry.id, name: entry.name, store: sibling });
    }
    for (const entry of all) {
      const linked: LinkedModule[] = all
        .filter((other) => other !== entry)
        .map((other) => ({ id: other.id, name: other.name, lookup: other.store.lookup }));
      entry.store.setLinkedModules(linked);
    }
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
      const sibling = this.storeFor(entry);
      if (sibling != null) modules.push({ id: entry.id, name, store: sibling });
    }
    return modules;
  }
}
