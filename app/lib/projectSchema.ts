import { InvalidJsonError, isRecord } from "./json";

/**
 * Version of a stored or exported project payload: the wrapper that holds
 * every module.
 */
export const PROJECT_SCHEMA_VERSION = 4 as const;

/**
 * Version of one module's workflow snapshot. 7 holds each stage's items,
 * intake, coverage and impact signatures under `stages`, and the threads.
 */
export const MODULE_SCHEMA_VERSION = 7 as const;

export function assertModuleSnapshotSchema(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Module snapshot must be a JSON object.");
  }
  if (value.schemaVersion !== MODULE_SCHEMA_VERSION) {
    throw new InvalidJsonError(
      `This module uses schema ${JSON.stringify(value.schemaVersion)}. Requireganizer reads module schema ${MODULE_SCHEMA_VERSION}.`,
    );
  }
}
