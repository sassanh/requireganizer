import { whenIdle } from "lib/idle";
import { siblingModuleEntries, visibleModules } from "lib/moduleSchema";
import type { ModuleContent, ModuleRegistry, ModuleState, ProjectState } from "storage";
import type { LinkedModule } from "workflow";

import { createModuleStore, type Store } from "./store";

/** The longest a module's store waits for an idle moment to build its items. */
const ITEMS_WAIT_MS = 1_000;

/** A module's store as linking reads it. */
interface LinkedStore {
  id: string;
  name: string;
  store: Store;
}

interface CacheEntry {
  content: ModuleContent;
  /** The content's JSON: a registry that crossed a connection holds equal copies, not the same objects. */
  text: string;
  store: Store;
}

/**
 * Read-only stores for the open project's other modules, rebuilt only when a
 * module's content changes. The authority's session and every replica
 * derive them from the registry they hold, so both resolve dependencies on
 * other modules' items the same way.
 */
export class SiblingModuleStores {
  private readonly cache = new Map<string, CacheEntry>();

  private storeFor(entry: ModuleState): Store | null {
    const hit = this.cache.get(entry.id);
    if (hit?.content === entry.content) return hit.store;
    const text = JSON.stringify(entry.content);
    if (hit?.text === text) {
      hit.content = entry.content;
      return hit.store;
    }
    let created: Store;
    try {
      created = createModuleStore(entry.content);
    } catch (error) {
      console.error(`Module “${entry.name}” could not be read.`, error);
      return null;
    }
    this.cache.set(entry.id, { content: entry.content, text, store: created });
    // A store builds its items, their index and their codes on first use, tens of milliseconds for a module of a thousand; while idle, so no request waits for it.
    whenIdle(() => {
      if (this.cache.get(entry.id)?.store === created) created.lookup.listItems();
    }, ITEMS_WAIT_MS);
    return created;
  }

  /** The read-only store of another module of the open project, as last linked; null for one it holds none of. */
  storeOf(moduleId: string): Store | null {
    return this.cache.get(moduleId)?.store ?? null;
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
    const shownEntry = registry.modules.find((module) => module.id === registry.activeModuleId);
    this.link(shownEntry == null ? [] : [{ id: shownEntry.id, name: shownEntry.name, store }], siblingModuleEntries(registry), registry.modules);
  }

  /**
   * Hold a store of every module of a state of the project, none of them
   * shown, such as a state its history keeps, each linked to the others as
   * `applyModuleContext` links the project's; `storeOf` then gives each.
   */
  linkState(state: ProjectState): void {
    if (state.modulesEnabled) {
      this.link([], visibleModules(state), state.modules);
      return;
    }
    for (const entry of visibleModules(state)) this.storeFor(entry)?.setLinkedModules([]);
  }

  /** Link the shown stores and the stores of `entries` to each other, forgetting the stores of modules `modules` no longer shows. */
  private link(shown: readonly LinkedStore[], entries: readonly ModuleState[], modules: readonly ModuleState[]): void {
    for (const id of [...this.cache.keys()]) {
      const entry = modules.find((module) => module.id === id);
      if (entry == null || entry.archivedAt != null) this.cache.delete(id);
    }
    const all = [...shown];
    for (const entry of entries) {
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
}
