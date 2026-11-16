import { UserFacingError } from "lib/errors";
import { InvalidJsonError, isRecord } from "lib/json";
import { type Address, isAddress } from "storage";

import { isTimeZone } from "./calendar";
import { parseStateDifference, type StateDifference } from "./difference";
import { type FocusPlace, isFocusPlace } from "./focus";
import { AUTOMATIC_RESTORE_POINT_INTERVAL_MS, parseRestorePoint, type RestorePoint } from "./restorePoints";

/**
 * What a change to the project was, as its step names it. The first six
 * are made within a module; the rest on the whole project.
 */
export type ChangeKind =
  | "edit"
  | "signature"
  | "thread message"
  | "thread resolution"
  | "request to write a stage"
  | "write of items"
  | "restore"
  | "import"
  | "opening a changed project"
  | "module change";

const CHANGE_KINDS: readonly ChangeKind[] = [
  "edit",
  "signature",
  "thread message",
  "thread resolution",
  "request to write a stage",
  "write of items",
  "restore",
  "import",
  "opening a changed project",
  "module change",
];

const WHOLE_PROJECT_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>([
  "restore",
  "import",
  "opening a changed project",
  "module change",
]);

/** Whether a change of this kind is made on the whole project rather than on its items, coverages and impacts. */
export function changesWholeProject(kind: ChangeKind): boolean {
  return WHOLE_PROJECT_KINDS.has(kind);
}

/**
 * Who made a change, with where it sent the spec owner: the spec owner,
 * with where the change moved their focus, or null when it did not move
 * it; or the coding agent, with what it named for the spec owner's
 * attention, or null when it named nothing.
 */
export type StepAuthor =
  | { kind: "spec owner"; movedFocusTo: FocusPlace | null }
  | { kind: "coding agent"; named: FocusPlace | null };

/**
 * One change to the project: the states before and after it, who made it,
 * where the spec owner's focus was when it was made, and where it sits in
 * the undo tree. A change made after an undo, or after going to a step, is
 * a new child of the step the project is at, so the branch it left stays.
 */
export interface HistoryStep {
  id: string;
  /** Counts up across the project's history, so the newest step has the highest, and a child is newer than its parent. */
  sequence: number;
  /** The step the project was at when this one was made; null for none, or once that step gave way. */
  parent: string | null;
  /** The child toward the step after this one the project was most recently at, which redo follows; null while none is known. */
  redoChild: string | null;
  before: Address;
  after: Address;
  at: string;
  kind: ChangeKind;
  by: StepAuthor;
  /** Where the spec owner's focus was when the change was made; null when no page had reported it. */
  focus: FocusPlace | null;
  /**
   * What the step added, changed or removed, worked out once, as it is
   * recorded: its states never change. Null when they could not be compared then.
   */
  change: StateDifference | null;
}

/** What a project keeps of its past: its undo tree, the state it is at, and its restore points. */
export interface ProjectHistory {
  /** Oldest first. */
  steps: HistoryStep[];
  /** The step the project is at; null when it is at the state before every kept step. */
  current: string | null;
  /** The first step toward the step the project was most recently at, which redo follows from the start; null while none is known. */
  redoFromStart: string | null;
  /**
   * The state the project is at: set by every change, undo, redo, going
   * to a step and opening, so it is the state shown even where a step's `before` differs
   * from its parent's `after`. Null before the project was first opened.
   */
  currentState: Address | null;
  /** Oldest first. */
  restorePoints: RestorePoint[];
  /** When the newest restore point was made, whether or not it is still kept; null while none was. */
  newestRestorePointAt: string | null;
  /** The IANA time zone the keeping rule reads calendar periods in; null until a page reported one. */
  timeZone: string | null;
}

/** The newest steps kept; older ones give way. */
export const KEPT_STEPS = 200;

export const EMPTY_HISTORY: ProjectHistory = {
  steps: [],
  current: null,
  redoFromStart: null,
  currentState: null,
  restorePoints: [],
  newestRestorePointAt: null,
  timeZone: null,
};

/**
 * The states undo, redo and going to a step reach: a session holds
 * their pieces in memory, so these moves are synchronous.
 */
export function heldStates(history: ProjectHistory): Address[] {
  return [
    ...history.steps.flatMap(({ before, after }) => [before, after]),
    ...(history.currentState == null ? [] : [history.currentState]),
  ];
}

/** Every state the history keeps: the held ones and its restore points'. */
export function historyRoots(history: ProjectHistory): Address[] {
  return [...heldStates(history), ...history.restorePoints.map(({ state }) => state)];
}

/** Whether a change made now is preceded by an automatic restore point: none was made in the hour before it. */
export function automaticRestorePointDue(history: ProjectHistory, now: Date): boolean {
  return (
    history.newestRestorePointAt == null ||
    now.getTime() - Date.parse(history.newestRestorePointAt) >= AUTOMATIC_RESTORE_POINT_INTERVAL_MS
  );
}

export function withRestorePoint(history: ProjectHistory, point: RestorePoint): ProjectHistory {
  return { ...history, restorePoints: [...history.restorePoints, point], newestRestorePointAt: point.at };
}

/** The history without the named restore points; the same history when it has none of them. */
export function withoutRestorePoints(history: ProjectHistory, ids: ReadonlySet<string>): ProjectHistory {
  if (!history.restorePoints.some(({ id }) => ids.has(id))) return history;
  return { ...history, restorePoints: history.restorePoints.filter(({ id }) => !ids.has(id)) };
}

export function withRestorePointPinned(history: ProjectHistory, id: string, pinned: boolean): ProjectHistory {
  return {
    ...history,
    restorePoints: history.restorePoints.map((point) => (point.id === id ? { ...point, pinned } : point)),
  };
}

function stepNamed(history: ProjectHistory, id: string | null): HistoryStep | null {
  return id == null ? null : (history.steps.find((step) => step.id === id) ?? null);
}

/** Keep the newest steps; a step whose parent or redo child gave way names none. */
function pruned(history: ProjectHistory): ProjectHistory {
  if (history.steps.length <= KEPT_STEPS) return history;
  const kept = history.steps.slice(-KEPT_STEPS);
  const keptIds = new Set(kept.map(({ id }) => id));
  const keep = (id: string | null): string | null => (id != null && keptIds.has(id) ? id : null);
  const current = stepNamed(history, history.current);
  // A current step that gives way leaves the project at the start, from
  // where redo goes on as it went on from that step.
  const currentGone = current != null && !keptIds.has(current.id);
  return {
    ...history,
    steps: kept.map((step) => ({ ...step, parent: keep(step.parent), redoChild: keep(step.redoChild) })),
    current: keep(history.current),
    redoFromStart: keep(currentGone ? current.redoChild : history.redoFromStart),
  };
}

/** The history with a new step made at the current one, which it becomes. Older steps give way past the kept number. */
export function withStep(
  history: ProjectHistory,
  step: Omit<HistoryStep, "parent" | "redoChild">,
): ProjectHistory {
  return pruned({
    ...history,
    steps: [...history.steps, { ...step, parent: history.current, redoChild: null }],
    current: step.id,
    currentState: step.after,
  });
}

/**
 * Where undo, redo or going to a step moves: for undo and redo, the step it
 * takes back or makes again; the history after it, and the state it brings
 * back. None of them records a step.
 */
export type HistoryMove = { history: ProjectHistory; state: Address } & (
  | { direction: "undo" | "redo"; step: HistoryStep }
  | { direction: "go to" }
);

/**
 * A state the list of steps goes to: after a kept step, or at the start,
 * before the oldest kept step, which `id` names, so the start it names is
 * no longer kept once that step gives way.
 */
export type StepListTarget = { kind: "step"; id: string } | { kind: "start"; id: string };

/**
 * The history once the project was at a step: each step before it, and the
 * start, lead redo toward it, as the steps after them the project was most
 * recently at. The same history for none.
 */
function withVisited(history: ProjectHistory, id: string | null): ProjectHistory {
  const byId = new Map(history.steps.map((step) => [step.id, step]));
  const redoChildren = new Map<string, string>();
  let redoFromStart = history.redoFromStart;
  for (let step = id == null ? undefined : byId.get(id); step != null; step = step.parent == null ? undefined : byId.get(step.parent)) {
    if (step.parent == null) redoFromStart = step.id;
    else redoChildren.set(step.parent, step.id);
  }
  if (redoChildren.size === 0 && redoFromStart === history.redoFromStart) return history;
  return {
    ...history,
    steps: history.steps.map((step) => (redoChildren.has(step.id) ? { ...step, redoChild: redoChildren.get(step.id)! } : step)),
    redoFromStart,
  };
}

/** Undo the current step: back to its `before`, at its parent. Null with nothing to undo. */
export function undoMove(history: ProjectHistory): HistoryMove | null {
  const step = stepNamed(history, history.current);
  if (step == null) return null;
  return {
    direction: "undo",
    step,
    history: { ...withVisited(history, step.id), current: step.parent, currentState: step.before },
    state: step.before,
  };
}

/**
 * Go to a kept step, on any branch, to its `after`, at it; or to the start,
 * before the oldest kept step, at none. Redo then leads from each step
 * before it toward it, and from it toward where the project was before
 * going. Throws when that state is no longer kept.
 */
export function goToMove(history: ProjectHistory, target: StepListTarget): HistoryMove {
  const left = withVisited(history, history.current);
  if (target.kind === "start") {
    const state = startState(history, target.id);
    return { direction: "go to", history: { ...left, current: null, currentState: state }, state };
  }
  const step = keptStep(history, target.id);
  return { direction: "go to", history: { ...withVisited(left, step.id), current: step.id, currentState: step.after }, state: step.after };
}

/** The state before the oldest kept step, while `oldestStep` names it; throws once that step gave way. */
export function startState(history: ProjectHistory, oldestStep: string): Address {
  const oldest = history.steps[0];
  if (oldest?.id !== oldestStep) throw new UserFacingError("That earlier state is no longer kept. Open the history again.");
  return oldest.before;
}

/** The step redo would bring back: the child of the current step, or of the start, toward where the project was most recently. */
function redoTarget(history: ProjectHistory): HistoryStep | null {
  const from = history.current == null ? history.redoFromStart : stepNamed(history, history.current)?.redoChild;
  const step = stepNamed(history, from ?? null);
  return step != null && step.parent === history.current ? step : null;
}

/** Redo the step after the current one the project was most recently at: forward to its `after`. Null with nothing to redo. */
export function redoMove(history: ProjectHistory): HistoryMove | null {
  const step = redoTarget(history);
  return step == null
    ? null
    : { direction: "redo", step, history: { ...history, current: step.id, currentState: step.after }, state: step.after };
}

/** What the interface shows of where the project is in its history. */
export interface HistoryPosition {
  canUndo: boolean;
  canRedo: boolean;
  /** Changes whenever the listed steps do. */
  currentStep: string | null;
  /** The restore points kept, by id; changes whenever one is made or let go of. */
  restorePoints: string;
}

export function historyPosition(history: ProjectHistory): HistoryPosition {
  return {
    canUndo: history.current != null,
    canRedo: redoTarget(history) != null,
    currentStep: history.current,
    restorePoints: history.restorePoints.map(({ id }) => id).join(" "),
  };
}

/**
 * Where a step stands: the current one, one redo brings back (oldest
 * first), one before the current step, or one on another branch, which
 * only going to it reaches.
 */
export type StepPlace = "current" | "done" | "undone" | "other branch";

export interface ListedStep {
  id: string;
  at: string;
  kind: ChangeKind;
  by: StepAuthor["kind"];
  place: StepPlace;
  /** What the step added, changed or removed; null when its states cannot be read. */
  change: StateDifference | null;
}

/** The list of steps: every kept step, and after them the start, how the project was before the oldest of them. */
export interface ListedSteps {
  /** Newest first. */
  steps: ListedStep[];
  /** The oldest kept step's id, naming the start, and whether the project is there; null while no step is kept. */
  start: { id: string; current: boolean } | null;
}

/** Every kept step, newest first, with where it stands and what it changed, then the start. */
export function listedSteps(history: ProjectHistory): ListedSteps {
  const places = new Map<string, StepPlace>();
  for (let step = stepNamed(history, history.current); step != null; step = stepNamed(history, step.parent)) {
    places.set(step.id, step.id === history.current ? "current" : "done");
  }
  for (let moved = history; ; ) {
    const redo = redoMove(moved);
    if (redo == null) break;
    places.set(redo.history.current!, "undone");
    moved = redo.history;
  }
  const oldest = history.steps[0];
  return {
    steps: [...history.steps]
      .reverse()
      .map((step) => ({ id: step.id, at: step.at, kind: step.kind, by: step.by.kind, place: places.get(step.id) ?? "other branch", change: step.change })),
    start: oldest == null ? null : { id: oldest.id, current: history.current == null },
  };
}

/** The kept step with this id; throws when there is none, such as one that gave way. */
export function keptStep(history: ProjectHistory, id: string): HistoryStep {
  const step = stepNamed(history, id);
  if (step == null) throw new UserFacingError("That step is no longer kept. Open the history again.");
  return step;
}

function isStepId(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFocusPlaceOrNull(value: unknown): value is FocusPlace | null {
  return value === null || isFocusPlace(value);
}

function isStepAuthor(value: unknown): value is StepAuthor {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false;
  switch (value.kind) {
    case "spec owner":
      return isFocusPlaceOrNull(value.movedFocusTo);
    case "coding agent":
      return isFocusPlaceOrNull(value.named);
    default:
      return false;
  }
}

function parseStep(value: unknown, index: number): HistoryStep {
  const label = `Step ${index + 1}`;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sequence !== "number" ||
    !isStepId(value.parent) ||
    !isStepId(value.redoChild) ||
    !isAddress(value.before) ||
    !isAddress(value.after) ||
    typeof value.at !== "string" ||
    !CHANGE_KINDS.includes(value.kind as ChangeKind) ||
    !isStepAuthor(value.by) ||
    !isFocusPlaceOrNull(value.focus) ||
    !Object.hasOwn(value, "change")
  ) {
    throw new InvalidJsonError(`${label} of the history is not one Requireganizer records.`);
  }
  return {
    id: value.id,
    sequence: value.sequence,
    parent: value.parent,
    redoChild: value.redoChild,
    before: value.before,
    after: value.after,
    at: value.at,
    kind: value.kind as ChangeKind,
    by: value.by,
    focus: value.focus,
    change: value.change === null ? null : parseStateDifference(value.change, `${label} change`),
  };
}

/**
 * The history as stored, read into a tree whose links all hold: steps
 * oldest first, every parent an older kept step, every redo child a child
 * of its step, and the current step and the start's redo kept ones. Its
 * restore points each have their own id.
 */
export function parseHistory(value: unknown): ProjectHistory {
  if (!isRecord(value) || !Array.isArray(value.steps)) throw new InvalidJsonError("The history must list its steps.");
  if (!Array.isArray(value.restorePoints)) throw new InvalidJsonError("The history must list its restore points.");
  const { currentState } = value;
  if (!(currentState === null || isAddress(currentState))) throw new InvalidJsonError("The history's currentState must be an address or null.");
  const steps = value.steps.map(parseStep);
  const byId = new Map(steps.map((step) => [step.id, step]));
  if (byId.size !== steps.length) throw new InvalidJsonError("Two steps of the history have one id.");
  steps.forEach((step, index) => {
    const parent = step.parent == null ? null : byId.get(step.parent);
    const redoChild = step.redoChild == null ? null : byId.get(step.redoChild);
    if (
      (index > 0 && steps[index - 1]!.sequence >= step.sequence) ||
      parent === undefined ||
      (parent != null && parent.sequence >= step.sequence) ||
      redoChild === undefined ||
      (redoChild != null && redoChild.parent !== step.id)
    ) {
      throw new InvalidJsonError(`Step ${index + 1} of the history is not linked as Requireganizer links steps.`);
    }
  });
  const pointer = (key: "current" | "redoFromStart"): string | null => {
    const entry = value[key];
    if (entry === null) return null;
    if (typeof entry !== "string" || !byId.has(entry)) {
      throw new InvalidJsonError(`The history's ${key} must name a kept step or be null.`);
    }
    return entry;
  };
  const redoFromStart = pointer("redoFromStart");
  if (redoFromStart != null && byId.get(redoFromStart)!.parent != null) {
    throw new InvalidJsonError("The history's redoFromStart must name a step made at the start.");
  }
  const restorePoints = value.restorePoints.map(parseRestorePoint);
  if (new Set(restorePoints.map(({ id }) => id)).size !== restorePoints.length) {
    throw new InvalidJsonError("Two restore points of the history have one id.");
  }
  const { newestRestorePointAt, timeZone } = value;
  if (
    !(newestRestorePointAt === null || (typeof newestRestorePointAt === "string" && !Number.isNaN(Date.parse(newestRestorePointAt))))
  ) {
    throw new InvalidJsonError("The history's newestRestorePointAt must be a time or null.");
  }
  if (!(timeZone === null || (typeof timeZone === "string" && isTimeZone(timeZone)))) {
    throw new InvalidJsonError("The history's timeZone must be a time zone or null.");
  }
  return {
    steps,
    current: pointer("current"),
    redoFromStart,
    currentState,
    restorePoints,
    newestRestorePointAt,
    timeZone,
  };
}
