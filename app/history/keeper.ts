import { UserFacingError } from "lib/errors";
import type { Address, PieceStore } from "storage";
import { uuid } from "utilities";
import { unitInPlaceOf } from "workflow";

import { ownTimeZone } from "./calendar";
import { type LiveStoreOf, StateComparer, type StateDifference } from "./difference";
import type { FocusPlace } from "./focus";
import {
  automaticRestorePointDue,
  changesWholeProject,
  type ChangeKind,
  EMPTY_HISTORY,
  heldStates,
  type HistoryMove,
  type HistoryPosition,
  historyPosition,
  historyRoots,
  type HistoryStep,
  goToMove,
  keptStep,
  listedSteps,
  type ListedSteps,
  type ProjectHistory,
  redoMove,
  startState,
  type StepAuthor,
  type StepListTarget,
  undoMove,
  withoutRestorePoints,
  withRestorePoint,
  withRestorePointPinned,
  withStep,
} from "./history";
import { automaticRestorePointsToDelete, keptRestorePoints, listedRestorePoints, type ListedRestorePoint, type RestorePoint } from "./restorePoints";

/** An earlier state of the project a page shows without bringing it back: one the list of steps goes to, or a restore point. */
export type PreviewTarget = StepListTarget | { kind: "restore point"; id: string };

/** A change as its step records it. */
export interface RecordedChange {
  kind: ChangeKind;
  by: StepAuthor;
  focus: FocusPlace | null;
  before: Address;
  after: Address;
  startedAt: Date;
}

/**
 * The history of one open project: its steps, the state it is at and its
 * restore points, over the pieces the session holds. Every change to the
 * history goes through here; the session writes `history` whenever it
 * changes, and cleans storage up once `takeGaveWay` says steps or restore
 * points gave way.
 */
export class HistoryKeeper {
  private current: ProjectHistory;
  private nextSequence: number;
  private gaveWay = false;
  private readonly comparer: StateComparer;
  /** What each kept step changed, by its id, once read: a step's states never change. */
  private readonly stepChanges = new Map<string, StateDifference>();

  constructor(
    pieces: PieceStore,
    history: ProjectHistory = EMPTY_HISTORY,
  ) {
    this.current = history;
    this.nextSequence = Math.max(0, ...history.steps.map(({ sequence }) => sequence)) + 1;
    this.comparer = new StateComparer(pieces);
  }

  /** The history as it is now; a new object whenever it changes. */
  get history(): ProjectHistory {
    return this.current;
  }

  get position(): HistoryPosition {
    return historyPosition(this.current);
  }

  /** The state the project is at; null before it was first opened. */
  get currentState(): Address | null {
    return this.current.currentState;
  }

  /** The states undo, redo and going to a step reach, whose pieces a session holds. */
  heldStates(): Address[] {
    return heldStates(this.current);
  }

  /** Every state the history keeps, restore points included. */
  roots(): Address[] {
    return historyRoots(this.current);
  }

  /** The restore points' states. */
  restorePointStates(): Address[] {
    return this.current.restorePoints.map(({ state }) => state);
  }

  /** Whether steps or restore points gave way since this was last asked. */
  takeGaveWay(): boolean {
    const gaveWay = this.gaveWay;
    this.gaveWay = false;
    return gaveWay;
  }

  /** The time zone the keeping rule reads calendar periods in: the one a page reported, else this machine's. */
  private timeZone(): string {
    return this.current.timeZone ?? ownTimeZone();
  }

  /** Take the time zone a page reported; false when the history already had it. */
  takeTimeZone(timeZone: string): boolean {
    if (this.current.timeZone === timeZone) return false;
    this.current = { ...this.current, timeZone };
    return true;
  }

  /** The project is shown at a state without a step, as on opening. */
  showsState(address: Address): void {
    this.current = { ...this.current, currentState: address };
  }

  /** Let go of the automatic restore points the keeping rule no longer keeps. */
  applyKeepingRule(): void {
    const deleted = automaticRestorePointsToDelete(this.current.restorePoints, new Date(), this.timeZone());
    if (deleted.size === 0) return;
    this.current = withoutRestorePoints(this.current, deleted);
    this.gaveWay = true;
  }

  /**
   * Record a change as one step, preceded by an automatic restore point of
   * the state before it when none was made in the hour before, and read
   * what it changed while `live` shows the state after it.
   */
  record(change: RecordedChange, live: LiveStoreOf): void {
    if (automaticRestorePointDue(this.current, change.startedAt)) {
      this.current = withRestorePoint(this.current, {
        id: uuid(),
        state: change.before,
        at: change.startedAt.toISOString(),
        name: null,
        pinned: false,
      });
      this.applyKeepingRule();
    }
    const steps = this.current.steps.length;
    const id = uuid();
    this.current = withStep(this.current, {
      id,
      sequence: this.nextSequence,
      before: change.before,
      after: change.after,
      at: new Date().toISOString(),
      kind: change.kind,
      by: change.by,
      focus: change.focus,
    });
    this.nextSequence += 1;
    if (this.current.steps.length <= steps) {
      this.gaveWay = true;
      const kept = new Set(this.current.steps.map((step) => step.id));
      for (const stepId of this.stepChanges.keys()) if (!kept.has(stepId)) this.stepChanges.delete(stepId);
    }
    this.changeOf(this.current.steps.at(-1)!, live);
  }

  undo(): HistoryMove | null {
    return undoMove(this.current);
  }

  redo(): HistoryMove | null {
    return redoMove(this.current);
  }

  /** Go to a kept step, on any branch, or to the start; throws when that state is no longer kept. */
  goTo(target: StepListTarget): HistoryMove {
    return goToMove(this.current, target);
  }

  /**
   * Read, from the models shown now, what a move from the state the
   * project is at needs of it, before the move replaces them.
   */
  prepareMove(move: HistoryMove, live: LiveStoreOf): void {
    const from = this.current.currentState;
    if (from != null) this.comparer.prepare(from, move.state, live);
  }

  /**
   * Make a move undo, redo or going to a step found, and say where it puts
   * the focus, read from the models shown once the move is made. Going to
   * a step leaves the focus where it is. For undo and redo, one rule for
   * every kind of change:
   * - undo: the first unit the change was made on that exists after it,
   *   else where the focus was when the change was made;
   * - redo of the spec owner's change: where it moved the focus, else the
   *   first unit it was made on, else the focus stays;
   * - redo of the coding agent's: what it named, else the first unit it
   *   made wait for a signature, else the first it was made on.
   * A unit that does not exist after the move gives way to the one in its
   * place, else to its stage. Null leaves the focus where it is.
   */
  commitMove(move: HistoryMove, live: LiveStoreOf): FocusPlace | null {
    const left = this.current.currentState;
    this.current = move.history;
    if (move.direction === "go to") return null;
    const { step } = move;
    const { madeOn, madeWait } = changesWholeProject(step.kind)
      ? { madeOn: [], madeWait: [] }
      : this.comparer.unitsChanged(step.before, step.after, live);
    const exists = (place: FocusPlace) =>
      place.unitId == null || this.comparer.shownUnits(move.state, place.moduleId, place.stage, live)?.includes(place.unitId) === true;
    const asPlace = (unit: (typeof madeOn)[number] | undefined): FocusPlace | null => (unit == null ? null : { ...unit });
    let target: FocusPlace | null;
    if (move.direction === "undo") {
      target = asPlace(madeOn.find((unit) => exists({ ...unit }))) ?? step.focus;
    } else if (step.by.kind === "spec owner") {
      target = step.by.movedFocusTo ?? asPlace(madeOn[0]);
    } else {
      target = step.by.named ?? asPlace(madeWait[0]) ?? asPlace(madeOn[0]);
    }
    if (target == null || target.unitId == null || exists(target)) return target;
    const shownBefore = left == null ? null : this.comparer.shownUnits(left, target.moduleId, target.stage, live);
    if (this.comparer.shownUnits(move.state, target.moduleId, target.stage, live) == null) return null;
    return { ...target, unitId: unitInPlaceOf(target.unitId, shownBefore ?? [], (unitId) => exists({ ...target, unitId })) };
  }

  /** Every kept step, newest first, with where each stands and what it changed, then the start. */
  listSteps(live: LiveStoreOf): ListedSteps {
    if (this.current.currentState == null) return { steps: [], start: null };
    return listedSteps(this.current, (step) => this.changeOf(step, live));
  }

  /** What a step added, changed or removed, read once, as it is recorded or, after reopening, as it is first listed; null when its states cannot be read. */
  private changeOf(step: HistoryStep, live: LiveStoreOf): StateDifference | null {
    const known = this.stepChanges.get(step.id);
    if (known != null) return known;
    const change = this.compared(step.before, step.after, live);
    if (change != null) this.stepChanges.set(step.id, change);
    return change;
  }

  /** How a kept state differs from the project now; null when its state cannot be read. */
  differenceFromNow(there: Address, live: LiveStoreOf): StateDifference | null {
    const here = this.current.currentState;
    return here == null ? null : this.compared(here, there, live);
  }

  /** How the state at `there` differs from the one at `here`; null when either cannot be read. */
  private compared(here: Address, there: Address, live: LiveStoreOf): StateDifference | null {
    try {
      return this.comparer.difference(here, there, live);
    } catch (error) {
      console.error(`The states ${here} and ${there} of the project's history cannot be compared.`, error);
      return null;
    }
  }

  /** The kept step with this id; throws when there is none, such as one that gave way. */
  step(id: string) {
    return keptStep(this.current, id);
  }

  /** The restore points the keeping rule keeps now, newest first. */
  listRestorePoints(): ListedRestorePoint[] {
    return listedRestorePoints(this.current.restorePoints, new Date(), this.timeZone());
  }

  /** A restore point the keeping rule keeps now; throws when there is none, such as one deleted meanwhile. */
  restorePoint(id: string): RestorePoint {
    const point = keptRestorePoints(this.current.restorePoints, new Date(), this.timeZone()).find((entry) => entry.id === id);
    if (point == null) throw new UserFacingError("That restore point is no longer kept. Open the list again.");
    return point;
  }

  /** The state a preview shows; throws when the step or restore point is no longer kept. */
  previewState(target: PreviewTarget): Address {
    switch (target.kind) {
      case "step":
        return this.step(target.id).after;
      case "start":
        return startState(this.current, target.id);
      case "restore point":
        return this.restorePoint(target.id).state;
    }
  }

  makeRestorePoint(point: RestorePoint): void {
    this.current = withRestorePoint(this.current, point);
  }

  pinRestorePoint(id: string): void {
    this.restorePoint(id);
    this.current = withRestorePointPinned(this.current, id, true);
  }

  /** Unpinned, an automatic restore point is kept by the keeping rule again, which may let go of it at once. */
  unpinRestorePoint(id: string): void {
    this.restorePoint(id);
    this.current = withRestorePointPinned(this.current, id, false);
    this.applyKeepingRule();
  }

  deleteRestorePoint(id: string): void {
    this.restorePoint(id);
    this.current = withoutRestorePoints(this.current, new Set([id]));
    this.gaveWay = true;
  }
}
