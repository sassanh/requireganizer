import { createFakeIndexedDb, createFakeKeyRange } from "./fakeIndexedDb";

/** A Storage implementation backed by a map, for `window.localStorage`. */
export function createFakeLocalStorage(): Storage {
  const values = new Map<string, string>();
  const storage = {
    get length(): number {
      return values.size;
    },
    clear(): void {
      values.clear();
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      values.delete(key);
    },
    setItem(key: string, value: string): void {
      values.set(String(key), String(value));
    },
  };
  return storage as Storage;
}

export interface FakeWebEnvironment {
  localStorage: Storage;
  indexedDB: IDBFactory;
}

/**
 * Installs a fresh fake browser storage on the globals the storage modules
 * read. Call once per test so every adapter starts from empty storage.
 */
export function installFakeWebEnvironment(): FakeWebEnvironment {
  const localStorage = createFakeLocalStorage();
  const indexedDB = createFakeIndexedDb();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: indexedDB,
  });
  Object.defineProperty(globalThis, "IDBKeyRange", {
    configurable: true,
    value: createFakeKeyRange(),
  });

  return { localStorage, indexedDB };
}
