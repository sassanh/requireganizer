import { isRecord } from "./json";

/**
 * Where the spec owner was looking in a project, as this page remembers it:
 * the module it showed, and the stage and the unit with the focus each
 * module showed. It lives in the page's own storage, not in the project, so
 * looking around changes nothing stored, and another machine opens the
 * project at its first module.
 */
interface ProjectView {
  moduleId: string | null;
  stages: Record<string, string>;
  units: Record<string, string>;
}

const NO_VIEW: ProjectView = { moduleId: null, stages: {}, units: {} };

/** The entries of a record whose values are text. */
function texts(value: unknown): Record<string, string> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
}

function storageKey(projectId: string): string {
  return `requireganizer:view:${projectId}`;
}

function readView(projectId: string): ProjectView {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey(projectId)) ?? "null");
    if (!isRecord(value)) return NO_VIEW;
    return { moduleId: typeof value.moduleId === "string" ? value.moduleId : null, stages: texts(value.stages), units: texts(value.units) };
  } catch {
    // No storage, as while rendering on a server, or nothing readable in it.
    return NO_VIEW;
  }
}

function writeView(projectId: string, change: (view: ProjectView) => ProjectView): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(change(readView(projectId))));
  } catch {
    // Forgetting where the page was costs nothing but a click.
  }
}

/** The module this page last showed in the project. */
export function rememberedModule(projectId: string): string | null {
  return readView(projectId).moduleId;
}

export function rememberModule(projectId: string, moduleId: string): void {
  if (rememberedModule(projectId) === moduleId) return;
  writeView(projectId, (view) => ({ ...view, moduleId }));
}

/** The stage this page last showed in a module of the project. */
export function rememberedStage(projectId: string, moduleId: string): string | null {
  return readView(projectId).stages[moduleId] ?? null;
}

export function rememberStage(projectId: string, moduleId: string, stage: string): void {
  if (rememberedStage(projectId, moduleId) === stage) return;
  writeView(projectId, (view) => ({ ...view, stages: { ...view.stages, [moduleId]: stage } }));
}

/** The unit that last had the focus in a module of the project, on the stage it showed; null for none. */
export function rememberedUnit(projectId: string, moduleId: string): string | null {
  return readView(projectId).units[moduleId] ?? null;
}

export function rememberUnit(projectId: string, moduleId: string, unitId: string | null): void {
  if (rememberedUnit(projectId, moduleId) === unitId) return;
  writeView(projectId, (view) => {
    const { [moduleId]: _left, ...others } = view.units;
    return { ...view, units: unitId == null ? others : { ...others, [moduleId]: unitId } };
  });
}
