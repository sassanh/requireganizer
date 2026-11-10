export { type AuthorityClaim, type ProjectAuthority, webProjectAuthority } from "./authority";
export { serializeCanonical } from "./canonicalJson";
export { buildExport, DEFAULT_EXPORT_OPTIONS, type ExportOptions } from "./exportProject";
export {
  type ChangeKind,
  EMPTY_HISTORY,
  historyRoots,
  type HistoryStep,
  KEPT_STEPS,
  parseHistory,
  type ProjectHistory,
} from "./history";
export { parseProject } from "./parseProject";
export { type Address, addressOfBytes, type Piece, type PieceLevel, PieceStore } from "./pieces";
export {
  type ModuleContent,
  moduleContentOf,
  type ModuleRegistry,
  type ModuleState,
  PROJECT_SCHEMA_VERSION,
  type ProjectDocument,
  projectDocument,
  projectState,
  type ProjectState,
  serializeProject,
  type StageContent,
  type StoredItem,
} from "./projectState";
