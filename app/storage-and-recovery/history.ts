import { UserFacingError } from "lib/errors";
import { InvalidJsonError, isRecord } from "lib/json";

import { isTimeZone } from "./calendar";
import { type Address, isAddress } from "./pieces";
import { AUTOMATIC_RESTORE_POINT_INTERVAL_MS, parseRestorePoint, type RestorePoint } from "./restorePoints";

/** What a change to the project was, as its step names it. */
export type ChangeKind =
  | "edit"
  | "signature"
  | "thread message"
  | "thread resolution"
  | "coding agent write"
  | "restore"
  | "import"
  | "opening a changed project"
  | "module change";

const CHANGE_KINDS: readonly ChangeKind[] = [
  "edit",
  "signature",
  "thread message",
  "thread resolution",
  "coding agent write",
  "restore",
  "import",
  "opening a changed project",
  "module change",
];

/**
 * One change to the project: the states before and after it, and where it
 * sits in the undo tree. A change made after an undo is a new child of the
 * step undo went back to, so the undone branch stays.
 */
export interface HistoryStep {
  id: string;
  /** Counts up across the project's history, so the newest step has the highest, and a child is newer than its parent. */
  sequence: number;
  /** The step the project was at when this one was made; null for none, or once that step gave way. */
  parent: string | null;
  /** The child undo last left this step from, which redo follows; null while undo never did. */
  redoChild: string | null;
  before: Address;
  after: Address;
  at: string;
  kind: ChangeKind;
}

/**
 * What a project keeps beside itself: its undo tree and the state it is at,
 * its restore points, the state storage last held for certain, and the
 * state being written while a write is under way.
 */
export interface ProjectHistory {
  /** Oldest first. */
  steps: HistoryStep[];
  /** The step the project is at; null when it is at the state before every kept step. */
  current: string | null;
  /** The step undo last left the start from, which redo follows from there; null while undo never did. */
  redoFromStart: string | null;
  /**
   * The state the project is at: set by every change, undo, redo and
   * opening, so it is the state shown even where a step's `before` differs
   * from its parent's `after`. Null before the project was first opened.
   */
  currentState: Address | null;
  /** Oldest first. */
  restorePoints: RestorePoint[];
  /** When the newest restore point was made, whether or not it is still kept; null while none was. */
  newestRestorePointAt: string | null;
  /** The IANA time zone the keeping rule reads calendar periods in; null until a page reported one. */
  timeZone: string | null;
  lastWritten: Address | null;
  writing: Address | null;
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
  lastWritten: null,
  writing: null,
};

/**
 * The states undo, redo and bringing back a step reach, and those storage
 * holds or is being given: a session holds their pieces in memory, so these
 * moves are synchronous.
 */
export function heldStates(history: ProjectHistory): Address[] {
  return [
    ...history.steps.flatMap(({ before, after }) => [before, after]),
    ...[history.currentState, history.lastWritten, history.writing].filter((address) => address != null),
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

/** Where undo or redo moves: the history after it, and the state it brings back. */
export interface HistoryMove {
  history: ProjectHistory;
  state: Address;
}

/** Undo the current step: back to its `before`, at its parent. Null with nothing to undo. */
export function undoMove(history: ProjectHistory): HistoryMove | null {
  const step = stepNamed(history, history.current);
  if (step == null) return null;
  return {
    history: {
      ...history,
      steps:
        step.parent == null
          ? history.steps
          : history.steps.map((entry) => (entry.id === step.parent ? { ...entry, redoChild: step.id } : entry)),
      current: step.parent,
      redoFromStart: step.parent == null ? step.id : history.redoFromStart,
      currentState: step.before,
    },
    state: step.before,
  };
}

/** The step redo would bring back: the child undo last left the current step, or the start, from. */
function redoTarget(history: ProjectHistory): HistoryStep | null {
  const from = history.current == null ? history.redoFromStart : stepNamed(history, history.current)?.redoChild;
  const step = stepNamed(history, from ?? null);
  return step != null && step.parent === history.current ? step : null;
}

/** Redo the step undo last left: forward to its `after`. Null with nothing to redo. */
export function redoMove(history: ProjectHistory): HistoryMove | null {
  const step = redoTarget(history);
  return step == null ? null : { history: { ...history, current: step.id, currentState: step.after }, state: step.after };
}

/** What the interface shows of where the project is in its history. */
export interface HistoryPosition {
  canUndo: boolean;
  canRedo: boolean;
  /** Changes whenever the listed steps do. */
  currentStep: string | null;
}

export function historyPosition(history: ProjectHistory): HistoryPosition {
  return { canUndo: history.current != null, canRedo: redoTarget(history) != null, currentStep: history.current };
}

/**
 * Where a step stands: the current one, one undo went back over (redo
 * brings these back, oldest first), one before the current step, or one on
 * another branch, which only bringing it back reaches.
 */
export type StepPlace = "current" | "done" | "undone" | "other branch";

export interface ListedStep {
  id: string;
  at: string;
  kind: ChangeKind;
  place: StepPlace;
}

/** Every kept step, newest first, with where it stands. */
export function listedSteps(history: ProjectHistory): ListedStep[] {
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
  return [...history.steps]
    .reverse()
    .map(({ id, at, kind }) => ({ id, at, kind, place: places.get(id) ?? "other branch" }));
}

/** The kept step with this id; throws when there is none, such as one that gave way. */
export function stepToBringBack(history: ProjectHistory, id: string): HistoryStep {
  const step = stepNamed(history, id);
  if (step == null) throw new UserFacingError("That step is no longer kept. Open the history again.");
  return step;
}

function isStepId(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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
    !CHANGE_KINDS.includes(value.kind as ChangeKind)
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
  const address = (key: "currentState" | "lastWritten" | "writing"): Address | null => {
    const entry = value[key];
    if (entry === null) return null;
    if (!isAddress(entry)) throw new InvalidJsonError(`The history's ${key} must be an address or null.`);
    return entry;
  };
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
    currentState: address("currentState"),
    restorePoints,
    newestRestorePointAt,
    timeZone,
    lastWritten: address("lastWritten"),
    writing: address("writing"),
  };
}
