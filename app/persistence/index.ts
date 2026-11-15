export type {
  ClientPersistence,
  OutsideChanges,
  PersistenceAdapter,
  ProjectPersistence,
  ProjectWrite,
  RecordPersistence,
  StorageTraits,
} from "./adapter";
export { MemoryPersistenceAdapter } from "./memoryAdapter";
export { WebPersistenceAdapter, webPersistence } from "./webAdapter";
