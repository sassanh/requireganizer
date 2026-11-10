export type {
  ClientPersistence,
  HistoryPersistence,
  OutsideChanges,
  PersistenceAdapter,
  ProjectPersistence,
  ProjectWrite,
  StorageTraits,
} from "./adapter";
export { MemoryPersistenceAdapter } from "./memoryAdapter";
export { WebPersistenceAdapter, webPersistence } from "./webAdapter";
