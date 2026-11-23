export class UserFacingError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "UserFacingError";
  }
}

export function getUserFacingErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof UserFacingError ? error.message : fallback;
}

/**
 * Whether the failure is a request timeout. Timeouts arrive the same way
 * rate limits do: the status and body baked into plain error text across
 * the error and its wrapped causes.
 */
export function isTimeoutError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (
      (current as { status?: unknown }).status === 504 ||
      (current as { statusCode?: unknown }).statusCode === 504 ||
      /\(\s*504\s*\)/.test(current.message) ||
      /timeout/i.test(current.message) ||
      /timed\s*out/i.test(current.message)
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/**
 * Whether the failure is the provider's rate limit. The agent surfaces
 * provider failures as plain errors with the status and body baked into
 * the message text, so match the pi-ai rendering (`(429)`) and the body
 * code (`rate_limit_exceeded`) across the error and its wrapped causes.
 */
export function isRateLimitError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (
      (current as { status?: unknown }).status === 429 ||
      (current as { statusCode?: unknown }).statusCode === 429 ||
      /\(\s*429\s*\)/.test(current.message) ||
      /rate_limit_exceeded/i.test(current.message) ||
      /rate limit exceeded/i.test(current.message)
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
