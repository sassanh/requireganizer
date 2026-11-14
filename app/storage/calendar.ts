/** A wall-clock time in one time zone, as its calendar shows it. Months count from 1. */
export interface CalendarTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter == null) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether the runtime knows an IANA time zone by this name. */
export function isTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The time zone of the machine this runs on. */
export function ownTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function calendarTimeOf(instant: number, timeZone: string): CalendarTime {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(instant)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** The wall-clock time read as if it were UTC, in milliseconds. */
function asUtc(time: CalendarTime): number {
  return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
}

/** How far the zone's wall clock is ahead of UTC at an instant. */
function offsetAt(instant: number, timeZone: string): number {
  return asUtc(calendarTimeOf(instant, timeZone)) - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a wall-clock time names in a zone. A time the clocks skip,
 * such as one inside a spring-forward hour, gives an instant next to it.
 */
function instantOf(time: CalendarTime, timeZone: string): number {
  const wall = asUtc(time);
  const guess = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(guess, timeZone);
}

/** The instant the same wall-clock time showed `days` calendar days earlier. */
export function daysBefore(instant: number, days: number, timeZone: string): number {
  const time = calendarTimeOf(instant, timeZone);
  const date = new Date(Date.UTC(time.year, time.month - 1, time.day - days));
  return instantOf(
    { ...time, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() },
    timeZone,
  );
}

/**
 * The instant the same wall-clock time showed `months` calendar months
 * earlier, on the last day of that month when it is shorter.
 */
export function monthsBefore(instant: number, months: number, timeZone: string): number {
  const time = calendarTimeOf(instant, timeZone);
  const first = new Date(Date.UTC(time.year, time.month - 1 - months, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth() + 1;
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return instantOf({ ...time, year, month, day: Math.min(time.day, length) }, timeZone);
}

export function dayKey(time: CalendarTime): string {
  return `${time.year}-${time.month}-${time.day}`;
}

/** The ISO week a day falls in: weeks start on Monday, and belong to the year their Thursday does. */
export function isoWeekKey(time: CalendarTime): string {
  const date = Date.UTC(time.year, time.month - 1, time.day);
  const weekday = (new Date(date).getUTCDay() + 6) % 7;
  const thursday = new Date(date + (3 - weekday) * 86_400_000);
  const weekYear = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(weekYear, 0, 1)) / (7 * 86_400_000)) + 1;
  return `${weekYear}-W${week}`;
}

export function monthKey(time: CalendarTime): string {
  return `${time.year}-${time.month}`;
}

export function yearKey(time: CalendarTime): string {
  return `${time.year}`;
}
