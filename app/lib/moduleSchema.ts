import { WorkflowStage } from "store/constants";

import { InvalidJsonError, isRecord } from "./json";
import {
  assertModuleSnapshotSchema,
  MODULE_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
} from "./projectSchema";

/**
 * The one module every project holds before modules are enabled: its id
 * and its pre-enable name. Never shown to the user; enabling modules
 * renames it to the first real module name.
 */
export const LEGACY_MODULE_ID = "main";

export interface ModuleEntry {
  id: string;
  name: string;
  /** Set when archived: kept in storage for round trips, hidden from the interface. */
  archivedAt: string | null;
  /** The stage this module last showed; reopening restores it (module mode only). */
  openStep: WorkflowStage;
  snapshot: Record<string, unknown>;
}

/** The registry the provider holds while a project is open. */
export interface ModuleRegistry {
  modulesEnabled: boolean;
  activeModuleId: string;
  modules: ModuleEntry[];
}

/** A stored or exported project: the registry plus its schema marker. */
export interface ProjectPayload extends ModuleRegistry {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
}

/**
 * The storage scope of one module's side data (timeline, revisions,
 * provider calls). Every scoped key or row carries it, so per-module
 * history never bleeds between modules.
 */
export function moduleScopeId(projectId: string, moduleId: string): string {
  return `${projectId}::${moduleId}`;
}

/** The stored spelling of a name: whitespace collapsed to single spaces. */
function collapseWhitespace(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * The one form a name is compared in, so every uniqueness check agrees
 * on what "the same name" means.
 */
function moduleNameKey(name: string): string {
  return collapseWhitespace(name).toLowerCase();
}

export function normalizeModuleName(value: unknown): string {
  const name = typeof value === "string" ? collapseWhitespace(value) : "";
  if (name.length === 0) {
    throw new InvalidJsonError("Module name cannot be empty.");
  }
  if (name.length > 60) {
    throw new InvalidJsonError("Module name must be 60 characters or fewer.");
  }
  if (/[\\/]/.test(name)) {
    throw new InvalidJsonError("Module name cannot contain slashes.");
  }
  // A module name becomes a directory in code exports; "." and ".." would
  // walk the archive target's parent.
  if (name === "." || name === "..") {
    throw new InvalidJsonError('Module name cannot be "." or "..".');
  }
  return name;
}

/** Names are unique across every module, archived ones included. */
export function assertModuleNameAvailable(
  name: string,
  modules: readonly ModuleEntry[],
): void {
  const wanted = moduleNameKey(name);
  if (modules.some((module) => moduleNameKey(module.name) === wanted)) {
    throw new InvalidJsonError(`A module named “${name}” already exists.`);
  }
}

export function visibleModules(
  registry: Pick<ModuleRegistry, "modules">,
): ModuleEntry[] {
  return registry.modules.filter((module) => module.archivedAt == null);
}

/**
 * The modules a display reference may resolve into: every visible module
 * except the active one. Archived modules are removed into nowhere, so no
 * path may link into them — matching the switcher and the exports.
 */
export function siblingModuleEntries(
  registry: ModuleRegistry,
): ModuleEntry[] {
  return visibleModules(registry).filter(
    (module) => module.id !== registry.activeModuleId,
  );
}

/**
 * The module to open: the recorded active one while it is still visible,
 * else the first visible module.
 */
export function pickActiveModule(registry: ModuleRegistry): ModuleEntry {
  const active = registry.modules.find(
    (module) => module.id === registry.activeModuleId && module.archivedAt == null,
  );
  if (active != null) return active;
  const fallback = visibleModules(registry)[0] ?? registry.modules[0];
  if (fallback == null) {
    throw new InvalidJsonError("The project holds no modules.");
  }
  return fallback;
}

function parseOpenStep(value: unknown): WorkflowStage {
  if (
    typeof value === "string" &&
    (Object.values(WorkflowStage) as string[]).includes(value)
  ) {
    return value as WorkflowStage;
  }
  return WorkflowStage.ProductOverview;
}

function parseModuleEntry(value: unknown, index: number): ModuleEntry {
  const label = `Module ${index + 1}`;
  if (!isRecord(value)) {
    throw new InvalidJsonError(`${label} must be an object.`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new InvalidJsonError(`${label} has no id.`);
  }
  const name = normalizeModuleName(value.name);
  if (value.archivedAt != null && typeof value.archivedAt !== "string") {
    throw new InvalidJsonError(`Module “${name}” has an invalid archive marker.`);
  }
  if (!isRecord(value.snapshot)) {
    throw new InvalidJsonError(`Module “${name}” has no snapshot.`);
  }
  assertModuleSnapshotSchema(value.snapshot);
  return {
    id: value.id,
    name,
    archivedAt: typeof value.archivedAt === "string" ? value.archivedAt : null,
    openStep: parseOpenStep(value.openStep),
    snapshot: value.snapshot,
  };
}

function parseRegistry(value: Record<string, unknown>): ModuleRegistry {
  if (typeof value.modulesEnabled !== "boolean") {
    throw new InvalidJsonError("Project must declare whether modules are enabled.");
  }
  if (typeof value.activeModuleId !== "string" || value.activeModuleId.length === 0) {
    throw new InvalidJsonError("Project must name its active module.");
  }
  if (!Array.isArray(value.modules) || value.modules.length === 0) {
    throw new InvalidJsonError("Project must hold at least one module.");
  }
  const modules: ModuleEntry[] = [];
  value.modules.forEach((entry, index) => {
    const parsed = parseModuleEntry(entry, index);
    // Reuses the one name-uniqueness rule, so imports and the interface
    // reject exactly the same names.
    assertModuleNameAvailable(parsed.name, modules);
    const seen = modules.some((module) => module.id === parsed.id);
    if (seen) {
      throw new InvalidJsonError(`Duplicate module id ${parsed.id}.`);
    }
    modules.push(parsed);
  });
  const active = modules.find((module) => module.id === value.activeModuleId);
  if (active == null) {
    throw new InvalidJsonError(
      `Active module ${value.activeModuleId} is not in the project.`,
    );
  }
  if (active.archivedAt != null) {
    throw new InvalidJsonError(`Active module “${active.name}” is archived.`);
  }
  return {
    modulesEnabled: value.modulesEnabled,
    activeModuleId: value.activeModuleId,
    modules,
  };
}

/**
 * The one reader of stored project bytes: a schema 4 payload is
 * validated as a module registry, a schema 3 flat project wraps as the
 * single hidden legacy module, anything else fails with the accepted
 * versions named.
 */
export function parseProjectPayload(value: unknown): ProjectPayload {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Imported project must be a JSON object.");
  }
  if (value.schemaVersion === PROJECT_SCHEMA_VERSION) {
    return { schemaVersion: PROJECT_SCHEMA_VERSION, ...parseRegistry(value) };
  }
  if (value.schemaVersion === MODULE_SCHEMA_VERSION) {
    assertModuleSnapshotSchema(value);
    return {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      modulesEnabled: false,
      activeModuleId: LEGACY_MODULE_ID,
      modules: [
        {
          id: LEGACY_MODULE_ID,
          name: LEGACY_MODULE_ID,
          archivedAt: null,
          openStep: WorkflowStage.ProductOverview,
          snapshot: value,
        },
      ],
    };
  }
  throw new InvalidJsonError(
    `This import uses obsolete project schema ${JSON.stringify(value.schemaVersion)}. Requireganizer accepts schema ${MODULE_SCHEMA_VERSION} (single module) or ${PROJECT_SCHEMA_VERSION} (modular).`,
  );
}

/** The registry of a project with no stored data yet. */
export function createEmptyRegistry(): ModuleRegistry {
  return {
    modulesEnabled: false,
    activeModuleId: LEGACY_MODULE_ID,
    modules: [
      {
        id: LEGACY_MODULE_ID,
        name: LEGACY_MODULE_ID,
        archivedAt: null,
        openStep: WorkflowStage.ProductOverview,
        // Replaced from the live store at every save; a project with no
        // stored data never reads this.
        snapshot: {},
      },
    ],
  };
}

/**
 * The bytes to store: the registry with the live store's snapshot
 * folded into the active module's entry.
 */
export function buildProjectPayload(
  registry: ModuleRegistry,
  activeSnapshot: Record<string, unknown>,
): ProjectPayload {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    modulesEnabled: registry.modulesEnabled,
    activeModuleId: registry.activeModuleId,
    modules: registry.modules.map((module) =>
      module.id === registry.activeModuleId
        ? { ...module, snapshot: activeSnapshot }
        : module,
    ),
  };
}
