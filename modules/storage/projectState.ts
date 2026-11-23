import { getSnapshot } from "mobx-state-tree";

import type { Store } from "store";
import type {
  CoverageSignature,
  ImpactSignature,
  ItemContent,
  ItemSignature,
  ItemVersion,
  Removal,
  Thread,
} from "workflow";

import { serializeCanonical } from "./canonicalJson";

/**
 * Version of a stored or exported project. 7 holds each module's content
 * whole, with no view state and no description, thread resolutions and
 * times that may be null, each thread message with its id, and threads on
 * stages themselves.
 */
export const PROJECT_SCHEMA_VERSION = 7 as const;

/** One item as a module stores it. */
export interface StoredItem {
  id: string;
  kind: string;
  content: ItemContent;
  references: string[];
  dependencies: string[];
  basis: Record<string, string>;
  signature: ItemSignature | null;
  removal: Removal | null;
}

/** One stage of a module: its items and the signatures on its coverages and impacts. */
export interface StageContent {
  items: StoredItem[];
  intake: Record<string, ItemVersion>;
  coverages: Record<string, CoverageSignature>;
  impacts: Record<string, ImpactSignature>;
  /** When the stage last became complete; null when unknown, such as in a project imported without signature times. */
  completedAt: string | null;
}

/** Everything one module holds: its stages and its threads. */
export interface ModuleContent {
  stages: Record<string, StageContent>;
  threads: Thread[];
}

export interface ModuleState {
  id: string;
  name: string;
  /** Set when archived: kept for round trips, hidden from the interface. */
  archivedAt: string | null;
  content: ModuleContent;
}

/**
 * The project: what is stored, exported, compared and brought back. It
 * holds every module and nothing about where the spec owner is looking, and
 * not the project's name, which belongs to its identity.
 */
export interface ProjectState {
  modulesEnabled: boolean;
  modules: ModuleState[];
}

/** A project as written out: its state with the schema it is written in. */
export interface ProjectDocument extends ProjectState {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
}

/**
 * The modules a session holds while a project is open, the one it shows,
 * and the order the spec owner arranged them in. The shown module's content
 * here is the one it had when it was last shown; its store holds the
 * current one. The arrangement is no part of the project's state, so
 * history never records or brings it back.
 */
export interface ModuleRegistry extends ProjectState {
  activeModuleId: string;
  /** Module ids in the order the spec owner arranged them; a module it does not name follows those it names. */
  arrangement: readonly string[];
}

/** A module's content as its store holds it now. */
export function moduleContentOf(store: Store): ModuleContent {
  return getSnapshot(store) as unknown as ModuleContent;
}

/** The one derivation of the project's state, from the session's modules and the shown store. */
export function projectState(registry: ModuleRegistry, shown: Store): ProjectState {
  return {
    modulesEnabled: registry.modulesEnabled,
    modules: registry.modules.map((module) =>
      module.id === registry.activeModuleId ? { ...module, content: moduleContentOf(shown) } : module,
    ),
  };
}

export function projectDocument(state: ProjectState): ProjectDocument {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, modulesEnabled: state.modulesEnabled, modules: state.modules };
}

/** The bytes of a project as storage and exports hold it. */
export function serializeProject(state: ProjectState): string {
  return serializeCanonical(projectDocument(state));
}
