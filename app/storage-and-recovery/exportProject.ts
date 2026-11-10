import { type ProjectState, serializeProject } from "./projectState";

/** What an export holds besides every module and its items. */
export interface ExportOptions {
  threads: "all" | "open" | "none";
  /** Whether the threads it holds keep the times of their messages and resolutions. */
  threadTimes: boolean;
  signatures: "with times" | "without times" | "none";
}

/** The whole project, as an export holds it unless asked otherwise. */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { threads: "all", threadTimes: true, signatures: "with times" };

function isDefault(options: ExportOptions): boolean {
  return (
    options.threads === DEFAULT_EXPORT_OPTIONS.threads &&
    options.threadTimes === DEFAULT_EXPORT_OPTIONS.threadTimes &&
    options.signatures === DEFAULT_EXPORT_OPTIONS.signatures
  );
}

/**
 * The bytes of an export of a state: the project's own bytes, through the
 * one serializer, so two exports differ only where the project did. It
 * never holds the history or restore points, which are not part of a state.
 */
export function buildExport(state: ProjectState, options: ExportOptions): string {
  if (!isDefault(options)) throw new Error("Only the default export options are available yet.");
  return serializeProject(state);
}
