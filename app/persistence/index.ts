export type {
  ClientPersistence,
  HistoryPersistence,
  OutsideChange,
  OutsideChanges,
  PersistenceAdapter,
  ProjectPersistence,
  ProjectWrite,
  StorageTraits,
} from "./adapter";
export { MemoryPersistenceAdapter } from "./memoryAdapter";
export { WebPersistenceAdapter, webPersistence } from "./webAdapter";
