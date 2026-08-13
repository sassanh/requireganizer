import { InvalidJsonError, isRecord } from "./json";

export const PROJECT_SCHEMA_VERSION = 2 as const;

export function assertCurrentProjectSchema(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Imported project must be a JSON object.");
  }
  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new InvalidJsonError(
      `This import uses obsolete project schema ${JSON.stringify(value.schemaVersion)}. Requireganizer accepts schema ${PROJECT_SCHEMA_VERSION} only; no compatibility migration is provided.`,
    );
  }
}
