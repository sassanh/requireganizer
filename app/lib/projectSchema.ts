import { InvalidJsonError, isRecord } from "./json";

/**
 * Version of a stored or exported project payload: the wrapper that holds
 * every module.
 */
export const PROJECT_SCHEMA_VERSION = 4 as const;

/**
 * Version of one module's workflow snapshot — the flat store shape
 * projects carried before modules existed. Schema 3 keeps that exact
 * shape, so pre-module data migrates by wrapping, never by rewriting.
 */
export const MODULE_SCHEMA_VERSION = 3 as const;

export function assertModuleSnapshotSchema(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Module snapshot must be a JSON object.");
  }
  if (value.schemaVersion !== MODULE_SCHEMA_VERSION) {
    throw new InvalidJsonError(
      `This import uses obsolete module schema ${JSON.stringify(value.schemaVersion)}. Requireganizer accepts schema ${MODULE_SCHEMA_VERSION} only; no compatibility migration is provided.`,
    );
  }
}
