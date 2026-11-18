/** How long ago a time was, as the spec owner reads it at a glance, such as "3 minutes ago". */
export function howLongAgo(at: string | null, now: number = Date.now()): string {
  if (at == null) return "at an unknown time";
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  const units: [number, string][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, unit] of units) {
    const count = Math.floor(seconds / size);
    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
