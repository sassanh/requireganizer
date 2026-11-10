import { InvalidJsonError, isRecord } from "lib/json";

import {
  calendarTimeOf,
  type CalendarTime,
  dayKey,
  daysBefore,
  isoWeekKey,
  monthKey,
  monthsBefore,
  yearKey,
} from "./calendar";
import { type Address, isAddress } from "./pieces";

/** A saved state of the project that it can be brought back to. */
export interface RestorePoint {
  id: string;
  state: Address;
  at: string;
  /** The name the spec owner gave it; null for one made automatically. */
  name: string | null;
  /** Kept whatever its age while pinned. */
  pinned: boolean;
}

/** A change is preceded by an automatic restore point when none was made this long before it. */
export const AUTOMATIC_RESTORE_POINT_INTERVAL_MS = 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

interface Candidate {
  id: string;
  instant: number;
  calendar: CalendarTime;
}

/**
 * The automatic, unpinned restore points the keeping rule lets go of. Of
 * those, it keeps every one made in the last 48 hours, and the newest of
 * each calendar day in the last 7 days, of each ISO week in the last 2
 * months, of each calendar month in the last 12 months and of each calendar
 * year. Windows count back from now, and periods are calendar periods in
 * the given time zone. Restore points the spec owner made or pinned are
 * never let go of.
 */
export function automaticRestorePointsToDelete(
  points: readonly RestorePoint[],
  now: Date,
  timeZone: string,
): Set<string> {
  const candidates: Candidate[] = points
    .filter(({ name, pinned }) => name == null && !pinned)
    .map(({ id, at }) => {
      const instant = Date.parse(at);
      return { id, instant, calendar: calendarTimeOf(instant, timeZone) };
    });
  const instant = now.getTime();
  const kept = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.instant >= instant - 48 * HOUR_MS) kept.add(candidate.id);
  }
  const keepNewestOfEach = (since: number, period: (time: CalendarTime) => string): void => {
    const newest = new Map<string, Candidate>();
    for (const candidate of candidates) {
      if (candidate.instant < since) continue;
      const key = period(candidate.calendar);
      const held = newest.get(key);
      if (held == null || candidate.instant > held.instant) newest.set(key, candidate);
    }
    for (const { id } of newest.values()) kept.add(id);
  };
  keepNewestOfEach(daysBefore(instant, 7, timeZone), dayKey);
  keepNewestOfEach(monthsBefore(instant, 2, timeZone), isoWeekKey);
  keepNewestOfEach(monthsBefore(instant, 12, timeZone), monthKey);
  keepNewestOfEach(-Infinity, yearKey);
  return new Set(candidates.filter(({ id }) => !kept.has(id)).map(({ id }) => id));
}

/** The restore points the keeping rule keeps now, so a list read between two runs of it never shows one it lets go of. */
export function keptRestorePoints(points: readonly RestorePoint[], now: Date, timeZone: string): RestorePoint[] {
  const deleted = automaticRestorePointsToDelete(points, now, timeZone);
  return points.filter(({ id }) => !deleted.has(id));
}

/** A restore point as the list shows it. */
export interface ListedRestorePoint {
  id: string;
  at: string;
  /** Null for one made automatically. */
  name: string | null;
  pinned: boolean;
}

/** The kept restore points, newest first. */
export function listedRestorePoints(points: readonly RestorePoint[], now: Date, timeZone: string): ListedRestorePoint[] {
  return keptRestorePoints(points, now, timeZone)
    .map(({ id, at, name, pinned }) => ({ id, at, name, pinned }))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

export function parseRestorePoint(value: unknown, index: number): RestorePoint {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isAddress(value.state) ||
    typeof value.at !== "string" ||
    Number.isNaN(Date.parse(value.at)) ||
    !(value.name === null || (typeof value.name === "string" && value.name.trim().length > 0)) ||
    typeof value.pinned !== "boolean"
  ) {
    throw new InvalidJsonError(`Restore point ${index + 1} of the history is not one Requireganizer records.`);
  }
  return { id: value.id, state: value.state, at: value.at, name: value.name, pinned: value.pinned };
}
