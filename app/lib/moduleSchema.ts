import type { ModuleRegistry, ModuleState } from "storage-and-recovery";

import { InvalidJsonError } from "./json";

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
