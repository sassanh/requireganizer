/** How long it is since a time, as the spec owner reads it at a glance, such as "3 minutes"; null for under a minute or an unknown time. */
function elapsed(at: string | null, now: number): string | null {
  if (at == null) return null;
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  const units: [number, string][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, unit] of units) {
    const count = Math.floor(seconds / size);
    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"}`;
  }
  return null;
}

/** How long ago a time was, such as "3 minutes ago". */
export function howLongAgo(at: string | null, now: number = Date.now()): string {
  if (at == null) return "at an unknown time";
  const span = elapsed(at, now);
  return span == null ? "just now" : `${span} ago`;
}

/** How long something has lasted since a time, such as "for 3 minutes". */
export function howLongSince(at: string | null, now: number = Date.now()): string {
  if (at == null) return "for an unknown time";
  const span = elapsed(at, now);
  return span == null ? "for under a minute" : `for ${span}`;
}
