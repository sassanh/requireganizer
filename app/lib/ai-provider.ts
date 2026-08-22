import "server-only";

const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";
const ANONYMOUS_API_KEY = "public";

export const AI_BASE_URL =
  process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL;

export function resolveApiKey(
  environment: Record<string, string | undefined> = process.env,
): string {
  return (
    environment.AI_API_KEY?.trim() ||
    environment.OPENCODE_API_KEY?.trim() ||
    ANONYMOUS_API_KEY
  );
}

export const AUTHENTICATION_MODE =
  resolveApiKey() === ANONYMOUS_API_KEY ? "anonymous" : "configured";
