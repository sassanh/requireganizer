import { InvalidJsonError, isRecord } from "./json";

/**
 * Version of a stored or exported project payload: the wrapper that holds
 * every module.
 */
export const PROJECT_SCHEMA_VERSION = 4 as const;

/**
 * Version of one module's workflow snapshot. Payload versions share one
 * sequence: 3 was the flat module, 4 the registry, 5 the module that
 * records approvals as signed records with per-item bases, and 6 the one
 * that names that record a signature. Schema 3 modules are migrated on load.
 */
export const MODULE_SCHEMA_VERSION = 6 as const;

/** The module schema still read: migrated to the current one on load. */
export const LEGACY_MODULE_SCHEMA_VERSION = 3 as const;

export function isModuleSchemaVersion(value: unknown): boolean {
  return value === MODULE_SCHEMA_VERSION || value === LEGACY_MODULE_SCHEMA_VERSION;
}

export function assertModuleSnapshotSchema(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Module snapshot must be a JSON object.");
  }
  if (!isModuleSchemaVersion(value.schemaVersion)) {
    throw new InvalidJsonError(
      `This import uses obsolete module schema ${JSON.stringify(value.schemaVersion)}. Requireganizer accepts module schema ${MODULE_SCHEMA_VERSION}, or ${LEGACY_MODULE_SCHEMA_VERSION} migrated on load.`,
    );
  }
}
