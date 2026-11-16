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

/**
 * The mark of a preview after or before the place with the focus, across
 * stages and modules, wrapping around; null when nothing is marked.
 * `rankOf` gives a module's place in the order the modules show, and
 * `positionOf` the place's position among its stage's marks as the preview
 * shows them. Marks are taken stage by stage from the focus on, and a
 * mark's position is read only in the stages reached.
 */
export function adjacentMark(
  difference: StateDifference,
  focus: FocusPlace | null,
  direction: 1 | -1,
  rankOf: (moduleId: string) => number,
  positionOf: (place: FocusPlace) => number,
): MarkedPlace | null {
  const keyOf = (moduleId: string, stage: string) => [rankOf(moduleId), WORKFLOW.stageIds.indexOf(stage)];
  // Each stage's marks, its units and then its threads on removed units, the stages in the order the page shows them, or the reverse.
  const stages = new Map<string, { key: number[]; places: FocusPlace[] }>();
  for (const { moduleId, stage, unitId } of [...difference.units, ...difference.threads]) {
    const name = `${moduleId} ${stage}`;
    let entry = stages.get(name);
    if (entry == null) stages.set(name, (entry = { key: keyOf(moduleId, stage), places: [] }));
    entry.places.push({ moduleId, stage, unitId });
  }
  const ordered = [...stages.values()].sort((left, right) => compare(left.key, right.key) * direction);
  if (ordered.length === 0) return null;
  /** A stage's marks with their positions, in the direction moved. */
  const positioned = (places: readonly FocusPlace[]): MarkedPlace[] =>
    places
      .map((place) => ({ ...place, unitId: place.unitId!, position: positionOf(place) }))
      .sort((left, right) => (left.position - right.position) * direction);
  if (focus != null) {
    const focusKey = keyOf(focus.moduleId, focus.stage);
    const focusPosition = focus.unitId == null ? -1 : positionOf(focus);
    for (const { key, places } of ordered) {
      const order = compare(key, focusKey) * direction;
      if (order < 0) continue;
      const marks = positioned(places);
      const next = order > 0 ? marks[0] : marks.find((mark) => (mark.position - focusPosition) * direction > 0);
      if (next != null) return next;
    }
  }
  return positioned(ordered[0]!.places)[0]!;
}
