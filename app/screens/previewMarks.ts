import type { FocusPlace, StateDifference } from "history";
import { WORKFLOW } from "store";
import type { PreviewMarks, RemovedUnitMark, ThreadMark, UnitMark } from "workflow/ui";
export { shownWithRemoved } from "workflow/ui";

/** Where a stage's threads on units neither state holds come among its marks: after all its units. */
const THREAD_POSITION = 1_000_000;

/** A thread mark's place among its stage's marks, given its place among the stage's marked threads. */
export function threadMarkPosition(index: number): number {
  return THREAD_POSITION + index;
}

/** What a preview marks in one of its modules, from how its state differs from the project now. */
export function previewMarksOf(difference: StateDifference, moduleId: string): PreviewMarks {
  const units = difference.units.filter((unit) => unit.moduleId === moduleId);
  const marks = new Map<string, UnitMark>();
  const removed = new Map<string, RemovedUnitMark[]>();
  const threads = new Map<string, (ThreadMark & { threadId: string })[]>();
  const counts = new Map<string, number>();
  for (const thread of difference.threads.filter((entry) => entry.moduleId === moduleId)) {
    counts.set(thread.stage, (counts.get(thread.stage) ?? 0) + 1);
    threads.set(thread.stage, [
      ...(threads.get(thread.stage) ?? []),
      {
        threadId: thread.threadId,
        unitId: thread.unitId,
        label: thread.label,
        text: thread.text,
        messagesAdded: thread.messagesAdded,
        messagesRemoved: thread.messagesRemoved,
        resolutionDiffers: thread.resolutionDiffers,
        onlyNow: thread.onlyNow,
      },
    ]);
  }
  for (const unit of units) {
    counts.set(unit.stage, (counts.get(unit.stage) ?? 0) + 1);
    switch (unit.change) {
      case "add":
        marks.set(unit.unitId, { change: "add" });
        break;
      case "change":
        marks.set(unit.unitId, {
          change: "change",
          content: unit.content,
          signature: unit.signature,
          threads: unit.threads,
          place: unit.place,
          versionNow: unit.versionNow,
        });
        break;
      case "remove":
        removed.set(unit.stage, [
          ...(removed.get(unit.stage) ?? []),
          { unitId: unit.unitId, unitKind: unit.unitKind, itemKind: unit.itemKind, label: unit.label, textNow: unit.textNow, after: unit.after },
        ]);
        break;
    }
  }
  return {
    of: (unitId) => marks.get(unitId) ?? null,
    removed: (stage) => removed.get(stage) ?? [],
    threads: (stage) => threads.get(stage) ?? [],
    count: (stage) => counts.get(stage) ?? 0,
  };
}

/** Orders keys compared part by part, the first part first. */
function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

/** A place a preview marks: a unit, or a thread on a unit neither state holds, by the unit it was on. */
interface MarkedPlace {
  moduleId: string;
  stage: string;
  unitId: string;
  position: number;
}

/** Every place a preview marks, its units and then its threads on removed units, each at its position as `positionOf` gives it. */
function markedPlaces(difference: StateDifference, positionOf: (place: FocusPlace) => number): MarkedPlace[] {
  return [...difference.units, ...difference.threads].map(({ moduleId, stage, unitId }) => ({ moduleId, stage, unitId, position: positionOf({ moduleId, stage, unitId }) }));
}

/**
 * The mark of a preview after or before the place with the focus, across
 * stages and modules, wrapping around; null when nothing is marked.
 * `rankOf` gives a module's place in the order the modules show, and
 * `positionOf` the place's position among its stage's marks as the preview
 * shows them.
 */
export function adjacentMark(
  difference: StateDifference,
  focus: FocusPlace | null,
  direction: 1 | -1,
  rankOf: (moduleId: string) => number,
  positionOf: (place: FocusPlace) => number,
): MarkedPlace | null {
  const keyOf = (moduleId: string, stage: string, position: number) => [rankOf(moduleId), WORKFLOW.stageIds.indexOf(stage), position];
  const marks = markedPlaces(difference, positionOf).sort((left, right) =>
    compare(keyOf(left.moduleId, left.stage, left.position), keyOf(right.moduleId, right.stage, right.position)),
  );
  if (marks.length === 0) return null;
  if (focus == null) return direction === 1 ? marks[0]! : marks.at(-1)!;
  const current = keyOf(focus.moduleId, focus.stage, focus.unitId == null ? -1 : positionOf(focus));
  if (direction === 1) return marks.find((mark) => compare(keyOf(mark.moduleId, mark.stage, mark.position), current) > 0) ?? marks[0]!;
  return [...marks].reverse().find((mark) => compare(keyOf(mark.moduleId, mark.stage, mark.position), current) < 0) ?? marks.at(-1)!;
}
