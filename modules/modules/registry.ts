import { InvalidJsonError } from "lib/json";
import type { ModuleContent, ModuleRegistry, ModuleState } from "storage";


/**
 * The one module every project holds before modules are enabled: its id
 * and its pre-enable name. Never shown to the user; enabling modules
 * renames it to the first real module name.
 */
export const LEGACY_MODULE_ID = "main";

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
  modules: readonly ModuleState[],
): void {
  const wanted = moduleNameKey(name);
  if (modules.some((module) => moduleNameKey(module.name) === wanted)) {
    throw new InvalidJsonError(`A module named “${name}” already exists.`);
  }
}

/** The module the registry shows. */
export function activeModule(registry: ModuleRegistry): ModuleState | null {
  return registry.modules.find((module) => module.id === registry.activeModuleId) ?? null;
}

export function visibleModules(
  registry: Pick<ModuleRegistry, "modules">,
): ModuleState[] {
  return registry.modules.filter((module) => module.archivedAt == null);
}

/** The visible module a name names, compared as names are compared for uniqueness. */
export function visibleModuleNamed(
  registry: Pick<ModuleRegistry, "modules">,
  name: string,
): ModuleState | null {
  const wanted = moduleNameKey(name);
  return visibleModules(registry).find(
    (module) => moduleNameKey(module.name) === wanted,
  ) ?? null;
}

/**
 * The modules a display reference may resolve into: every visible module
 * except the active one. Archived modules are removed into nowhere, so no
 * path may link into them — matching the switcher and the exports.
 */
export function siblingModuleEntries(
  registry: ModuleRegistry,
): ModuleState[] {
  return visibleModules(registry).filter(
    (module) => module.id !== registry.activeModuleId,
  );
}

/** The visible module an id names; null for an unknown or archived one. */
export function visibleModuleWithId(registry: Pick<ModuleRegistry, "modules">, id: string): ModuleState | null {
  return visibleModules(registry).find((module) => module.id === id) ?? null;
}

/** The registry with modules enabled and the shown module named `name`; null when they are enabled already. Throws when the name is refused. */
export function withModulesEnabled(registry: ModuleRegistry, name: string): ModuleRegistry | null {
  if (registry.modulesEnabled) return null;
  const trimmed = normalizeModuleName(name);
  assertModuleNameAvailable(trimmed, registry.modules);
  return {
    ...registry,
    modulesEnabled: true,
    modules: registry.modules.map((module) => (module.id === registry.activeModuleId ? { ...module, name: trimmed } : module)),
  };
}

/** A new module named `name` holding `content`, to add to the registry's modules. Throws when the name is refused. */
export function newModule(registry: Pick<ModuleRegistry, "modules">, name: string, content: ModuleContent): ModuleState {
  const trimmed = normalizeModuleName(name);
  assertModuleNameAvailable(trimmed, registry.modules);
  return { id: crypto.randomUUID(), name: trimmed, archivedAt: null, content };
}

/** The registry with a module renamed; null when modules are not enabled or no module has the id. Throws when the name is refused. */
export function withModuleRenamed(registry: ModuleRegistry, id: string, name: string): ModuleRegistry | null {
  if (!registry.modulesEnabled) return null;
  if (!registry.modules.some((module) => module.id === id)) return null;
  const trimmed = normalizeModuleName(name);
  assertModuleNameAvailable(trimmed, registry.modules.filter((module) => module.id !== id));
  return { ...registry, modules: registry.modules.map((module) => (module.id === id ? { ...module, name: trimmed } : module)) };
}

/** The registry with a module archived at `at`; null for the shown module, the last visible one, or one not visible. */
export function withModuleArchived(registry: ModuleRegistry, id: string, at: string): ModuleRegistry | null {
  if (id === registry.activeModuleId) return null;
  if (visibleModuleWithId(registry, id) == null) return null;
  if (visibleModules(registry).length <= 1) return null;
  return { ...registry, modules: registry.modules.map((module) => (module.id === id ? { ...module, archivedAt: at } : module)) };
}

/** The registry with an archived module back in the list, as it was when it was archived; null for one not archived. */
export function withModuleBroughtBack(registry: ModuleRegistry, id: string): ModuleRegistry | null {
  if (!registry.modules.some((module) => module.id === id && module.archivedAt != null)) return null;
  return { ...registry, modules: registry.modules.map((module) => (module.id === id ? { ...module, archivedAt: null } : module)) };
}

/** One module as the interface lists it. */
export interface ModuleSummary {
  id: string;
  name: string;
  active: boolean;
}

/** The visible modules of a registry as the interface lists them. */
export function moduleSummaries(registry: ModuleRegistry | null): ModuleSummary[] {
  if (registry == null) return [];
  return visibleModules(registry).map((module) => ({ id: module.id, name: module.name, active: module.id === registry.activeModuleId }));
}

/** The archived modules of a registry, most recently archived first. */
export function archivedModuleSummaries(registry: ModuleRegistry | null): ModuleSummary[] {
  if (registry == null) return [];
  return registry.modules
    .filter((module) => module.archivedAt != null)
    .sort((first, second) => second.archivedAt!.localeCompare(first.archivedAt!))
    .map((module) => ({ id: module.id, name: module.name, active: false }));
}
