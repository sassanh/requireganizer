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
