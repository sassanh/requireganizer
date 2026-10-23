/**
 * A small in-memory IndexedDB implementation for tests. It covers only the
 * features `revisionStorage.ts` and `providerCallStorage.ts` use: versioned
 * open with an upgrade transaction, object stores with string or array key
 * paths, indexes, `get`, `getAll`, `put`, `delete`, and value/key cursors.
 *
 * Requests complete asynchronously and transactions complete after the last
 * request, as in a browser, so code that awaits a request and then queues
 * another request in the same transaction keeps working.
 */

type FakeKey = string | number | Date | readonly FakeKey[];

interface StoredRow {
  key: FakeKey;
  value: unknown;
}

interface FakeIndexRecord {
  keyPath: string | readonly string[];
}

interface FakeStoreRecord {
  keyPath: string | readonly string[];
  rows: Map<string, StoredRow>;
  indexes: Map<string, FakeIndexRecord>;
}

interface FakeDatabaseRecord {
  version: number;
  stores: Map<string, FakeStoreRecord>;
}

interface IndexEntry {
  key: FakeKey;
  primaryKey: FakeKey;
  value: unknown;
}

class FakeRequest<Result> {
  result: Result | undefined = undefined;
  error: unknown = null;
  transaction: FakeTransaction | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: unknown = null;

  private readonly record: FakeDatabaseRecord;
  private readonly queue: Array<{
    request: FakeRequest<unknown>;
    run: () => unknown;
  }> = [];
  private draining = false;
  private finished = false;

  constructor(record: FakeDatabaseRecord) {
    this.record = record;
    // An IndexedDB transaction with no requests completes on its own. The
    // timer also gives synchronous callers a chance to queue their first
    // request before the transaction commits.
    setTimeout(() => this.finishWhenIdle(), 0);
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.record.stores.get(name);
    if (store == null) {
      throw new Error(`The object store "${name}" does not exist.`);
    }
    return new FakeObjectStore(store, this);
  }

  enqueue<Result>(run: () => Result): FakeRequest<Result> {
    const request = new FakeRequest<Result>();
    this.queue.push({ request, run });
    this.schedule();
    return request;
  }

  private schedule(): void {
    if (this.draining || this.finished) return;
    this.draining = true;
    setTimeout(() => {
      this.draining = false;
      this.drain();
    }, 0);
  }

  private drain(): void {
    if (this.finished) return;

    const operation = this.queue.shift();
    if (operation == null) {
      // Wait one more turn so a promise continuation after a request success
      // can queue the transaction's next request before it commits.
      setTimeout(() => this.finishWhenIdle(), 0);
      return;
    }

    try {
      operation.request.result = operation.run();
      operation.request.onsuccess?.();
      this.schedule();
    } catch (error) {
      operation.request.error = error;
      operation.request.onerror?.();
      this.abort(error);
    }
  }

  private finishWhenIdle(): void {
    if (this.finished) return;
    if (this.queue.length > 0) {
      this.schedule();
      return;
    }
    this.finished = true;
    this.oncomplete?.();
  }

  private abort(error: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.error = error;
    this.onerror?.();
    this.onabort?.();
  }
}

class FakeNameList {
  private readonly names: () => Iterable<string>;

  constructor(names: () => Iterable<string>) {
    this.names = names;
  }

  contains(name: string): boolean {
    for (const candidate of this.names()) {
      if (candidate === name) return true;
    }
    return false;
  }

  get length(): number {
    return [...this.names()].length;
  }

  item(index: number): string | null {
    return [...this.names()][index] ?? null;
  }
}

class FakeObjectStore {
  private readonly record: FakeStoreRecord;
  private readonly transaction: FakeTransaction;

  constructor(record: FakeStoreRecord, transaction: FakeTransaction) {
    this.record = record;
    this.transaction = transaction;
  }

  get indexNames(): FakeNameList {
    return new FakeNameList(() => this.record.indexes.keys());
  }

  createIndex(
    name: string,
    keyPath: string | readonly string[],
  ): FakeIndex {
    const index: FakeIndexRecord = { keyPath };
    this.record.indexes.set(name, index);
    return new FakeIndex(this.record, index, this.transaction);
  }

  index(name: string): FakeIndex {
    const index = this.record.indexes.get(name);
    if (index == null) {
      throw new Error(`The index "${name}" does not exist.`);
    }
    return new FakeIndex(this.record, index, this.transaction);
  }

  put(value: unknown): FakeRequest<FakeKey> {
    const key = extractKey(this.record.keyPath, value);
    if (key === undefined) {
      throw new Error("A value with a key is required.");
    }
    // IndexedDB clones the value when put is called, so a value that cannot
    // be cloned throws here, before the request is queued.
    const storedValue = structuredClone(value);
    return this.transaction.enqueue(() => {
      this.record.rows.set(keyString(key), { key, value: storedValue });
      return key;
    });
  }

  get(key: FakeKey): FakeRequest<unknown> {
    return this.transaction.enqueue(() => {
      const row = this.record.rows.get(keyString(key));
      return row == null ? undefined : structuredClone(row.value);
    });
  }

  delete(key: FakeKey): FakeRequest<undefined> {
    return this.transaction.enqueue(() => {
      this.record.rows.delete(keyString(key));
      return undefined;
    });
  }

  openCursor(): FakeRequest<FakeCursor | null> {
    return this.cursorRequest(
      () =>
        [...this.record.rows.values()]
          .sort((left, right) => compareKeys(left.key, right.key))
          .map((row) => ({
            key: row.key,
            primaryKey: row.key,
            value: row.value,
          })),
      true,
    );
  }

  private cursorRequest(
    entries: () => IndexEntry[],
    withValue: boolean,
  ): FakeRequest<FakeCursor | null> {
    const request = new FakeRequest<FakeCursor | null>();
    let position = 0;
    let currentEntries: IndexEntry[] | null = null;

    const advance = (): void => {
      const stepRequest = this.transaction.enqueue<FakeCursor | null>(() => {
        if (currentEntries == null) currentEntries = entries();
        if (position >= currentEntries.length) return null;
        const entry = currentEntries[position];
        position += 1;
        return new FakeCursor(
          entry,
          withValue,
          advance,
          (value) => {
            this.put(value);
          },
          () => {
            this.delete(entry.primaryKey);
          },
        );
      });
      stepRequest.onsuccess = () => {
        request.result = stepRequest.result;
        request.onsuccess?.();
      };
      stepRequest.onerror = () => {
        request.error = stepRequest.error;
        request.onerror?.();
      };
    };

    advance();
    return request;
  }
}

class FakeIndex {
  private readonly store: FakeStoreRecord;
  private readonly index: FakeIndexRecord;
  private readonly transaction: FakeTransaction;

  constructor(
    store: FakeStoreRecord,
    index: FakeIndexRecord,
    transaction: FakeTransaction,
  ) {
    this.store = store;
    this.index = index;
    this.transaction = transaction;
  }

  getAll(range?: unknown): FakeRequest<unknown[]> {
    return this.transaction.enqueue(() =>
      this.entries(range).map((entry) => structuredClone(entry.value)),
    );
  }

  openKeyCursor(range?: unknown): FakeRequest<FakeCursor | null> {
    const request = new FakeRequest<FakeCursor | null>();
    let position = 0;
    let currentEntries: IndexEntry[] | null = null;

    const advance = (): void => {
      const stepRequest = this.transaction.enqueue<FakeCursor | null>(() => {
        if (currentEntries == null) currentEntries = this.entries(range);
        if (position >= currentEntries.length) return null;
        const entry = currentEntries[position];
        position += 1;
        return new FakeCursor(
          entry,
          false,
          advance,
          () => undefined,
          () => {
            this.store.rows.delete(keyString(entry.primaryKey));
          },
        );
      });
      stepRequest.onsuccess = () => {
        request.result = stepRequest.result;
        request.onsuccess?.();
      };
      stepRequest.onerror = () => {
        request.error = stepRequest.error;
        request.onerror?.();
      };
    };

    advance();
    return request;
  }

  private entries(range?: unknown): IndexEntry[] {
    const only = keyRangeOnly(range);
    return [...this.store.rows.values()]
      .flatMap((row) => {
        const indexKey = extractKey(this.index.keyPath, row.value);
        if (indexKey === undefined) return [];
        if (only !== undefined && compareKeys(indexKey, only) !== 0) return [];
        return [{ key: indexKey, primaryKey: row.key, value: row.value }];
      })
      .sort(
        (left, right) =>
          compareKeys(left.key, right.key) ||
          compareKeys(left.primaryKey, right.primaryKey),
      );
  }
}

class FakeCursor {
  private readonly entry: IndexEntry;
  private readonly withValue: boolean;
  private readonly advanceCursor: () => void;
  private readonly updateRow: (value: unknown) => void;
  private readonly deleteRow: () => void;

  constructor(
    entry: IndexEntry,
    withValue: boolean,
    advance: () => void,
    updateRow: (value: unknown) => void,
    deleteRow: () => void,
  ) {
    this.entry = entry;
    this.withValue = withValue;
    this.advanceCursor = advance;
    this.updateRow = updateRow;
    this.deleteRow = deleteRow;
  }

  get key(): FakeKey {
    return this.entry.key;
  }

  get primaryKey(): FakeKey {
    return this.entry.primaryKey;
  }

  get value(): unknown {
    return this.withValue ? structuredClone(this.entry.value) : undefined;
  }

  update(value: unknown): void {
    this.updateRow(value);
  }

  delete(): void {
    this.deleteRow();
  }

  continue(): void {
    this.advanceCursor();
  }
}

class FakeDatabase {
  readonly upgradeTransaction: FakeTransaction;
  private readonly record: FakeDatabaseRecord;

  constructor(record: FakeDatabaseRecord) {
    this.record = record;
    this.upgradeTransaction = new FakeTransaction(record);
  }

  get objectStoreNames(): FakeNameList {
    return new FakeNameList(() => this.record.stores.keys());
  }

  createObjectStore(
    name: string,
    options?: { keyPath?: string | readonly string[] },
  ): FakeObjectStore {
    const record: FakeStoreRecord = {
      keyPath: options?.keyPath ?? "id",
      rows: new Map(),
      indexes: new Map(),
    };
    this.record.stores.set(name, record);
    return new FakeObjectStore(record, this.upgradeTransaction);
  }

  transaction(name: string): FakeTransaction {
    if (!this.record.stores.has(name)) {
      throw new Error(`The object store "${name}" does not exist.`);
    }
    return new FakeTransaction(this.record);
  }

  close(): void {
    // Connections do not need to be released by this fake.
  }
}

function readProperty(value: unknown, name: string): FakeKey | undefined {
  if (value == null || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[name];
  return isFakeKey(candidate) ? candidate : undefined;
}

function extractKey(
  keyPath: string | readonly string[],
  value: unknown,
): FakeKey | undefined {
  if (Array.isArray(keyPath)) {
    const parts = keyPath.map((part) => readProperty(value, part));
    return parts.some((part) => part === undefined)
      ? undefined
      : (parts as FakeKey[]);
  }
  return readProperty(value, keyPath as string);
}

function isFakeKey(value: unknown): value is FakeKey {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof Date
  ) {
    return true;
  }
  return Array.isArray(value) && value.every(isFakeKey);
}

function keyString(key: FakeKey): string {
  if (typeof key === "number") return `number:${key}`;
  if (key instanceof Date) return `date:${key.getTime()}`;
  if (typeof key === "string") return `string:${key}`;
  return `array:${JSON.stringify(key)}`;
}

function keyRank(key: FakeKey): number {
  if (typeof key === "number") return 0;
  if (key instanceof Date) return 1;
  if (typeof key === "string") return 2;
  return 3;
}

/** IndexedDB key order: numbers, dates, strings, then arrays element by element. */
function compareKeys(left: FakeKey, right: FakeKey): number {
  const rankDifference = keyRank(left) - keyRank(right);
  if (rankDifference !== 0) return rankDifference;

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  if (typeof left === "string" && typeof right === "string") {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const sharedLength = Math.min(left.length, right.length);
    for (let index = 0; index < sharedLength; index += 1) {
      const difference = compareKeys(left[index], right[index]);
      if (difference !== 0) return difference;
    }
    return left.length - right.length;
  }
  return 0;
}

class FakeKeyRange {
  readonly only: FakeKey;

  constructor(only: FakeKey) {
    this.only = only;
  }
}

function keyRangeOnly(range: unknown): FakeKey | undefined {
  return range instanceof FakeKeyRange ? range.only : undefined;
}

export function createFakeKeyRange(): typeof IDBKeyRange {
  const keyRange = {
    only: (value: FakeKey) => new FakeKeyRange(value),
  };
  return keyRange as unknown as typeof IDBKeyRange;
}

export function createFakeIndexedDb(): IDBFactory {
  const databases = new Map<string, FakeDatabaseRecord>();

  const factory = {
    open(name: string, version?: number): FakeRequest<FakeDatabase> {
      const request = new FakeRequest<FakeDatabase>();
      setTimeout(() => {
        let record = databases.get(name);
        if (record == null) {
          record = { version: 0, stores: new Map() };
          databases.set(name, record);
        }

        const database = new FakeDatabase(record);
        request.result = database;

        const requestedVersion = version ?? 1;
        if (requestedVersion > record.version) {
          request.transaction = database.upgradeTransaction;
          request.onupgradeneeded?.();
          record.version = requestedVersion;
        }
        request.onsuccess?.();
      }, 0);
      return request;
    },

    deleteDatabase(name: string): FakeRequest<undefined> {
      const request = new FakeRequest<undefined>();
      setTimeout(() => {
        databases.delete(name);
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };

  return factory as unknown as IDBFactory;
}
