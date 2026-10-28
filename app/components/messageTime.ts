/** When a message was written, as a person scans it: a time today, then days ago, then a date. */
export function formatMessageTime(createdAt: number): string {
  const diffMs = Date.now() - createdAt;
  const oneDay = 24 * 60 * 60 * 1000;
  const threeDays = 3 * oneDay;
  if (diffMs < oneDay) {
    return new Date(createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (diffMs < threeDays) {
    const days = Math.floor(diffMs / oneDay);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(diffMs > 365 * 24 * 60 * 60 * 1000 ? { year: "numeric" as const } : {}),
  });
}
