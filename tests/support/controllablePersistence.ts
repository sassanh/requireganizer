import type {
  ProjectIndexUpdate,
  ProjectMeta,
} from "../../app/lib/projectStorage";
import {
  MemoryPersistenceAdapter,
  type MemoryPersistenceFailure,
  type PersistenceAdapter,
  type ProjectDeleteResult,
  type ProjectPersistence,
  type ProviderCallPersistence,
  type RevisionPersistence,
  type TimelinePersistence,
} from "../../app/persistence";

interface Gate {
  promise: Promise<void>;
  resolve: (error?: unknown) => void;
  error: unknown;
}

export interface ProjectWriteRecord {
  id: string;
  data: unknown;
  indexUpdate: ProjectIndexUpdate | undefined;
}

export interface ProjectLoadRecord {
  id: string;
  data: Record<string, unknown> | null;
  completed: boolean;
}

export interface TimelineWriteRecord {
  projectId: string;
  moduleId: string;
  data: unknown;
  result: boolean;
  completed: boolean;
}

export interface TimelineLoadRecord {
  projectId: string;
  moduleId: string;
  data: Record<string, unknown> | null;
  completed: boolean;
}

/**
 * A `MemoryPersistenceAdapter` wrapper for session tests. It records writes
 * as they are issued and can hold any load or write at a named gate, so
 * races and stale results can be released in a chosen order.
 *
 * Writes are serialized and later reads of the same key wait for them. A held
 * write therefore also holds the reads issued after it, matching the adapter
 * contract's read-after-write guarantee.
 */
export class ControllablePersistenceAdapter implements PersistenceAdapter {
  readonly inner: MemoryPersistenceAdapter;
  readonly projectWrites: ProjectWriteRecord[] = [];
  readonly projectLoads: ProjectLoadRecord[] = [];
  readonly timelineWrites: TimelineWriteRecord[] = [];
  readonly timelineLoads: TimelineLoadRecord[] = [];
  readonly indexWrites: ProjectMeta[][] = [];
  readonly bundleWrites: Array<{
    projectId: string;
    data: unknown;
    projects: ProjectMeta[];
  }> = [];

  private readonly gates = new Map<string, Gate>();
  private readonly projectWriteTails = new Map<string, Promise<void>>();
  private readonly timelineWriteTails = new Map<string, Promise<void>>();

  constructor(inner = new MemoryPersistenceAdapter()) {
    this.inner = inner;
  }

  failNext(operation: MemoryPersistenceFailure): void {
    this.inner.failNext(operation);
  }

  /** Hold every operation for a key until the matching release. */
  hold(key: string): void {
    if (this.gates.has(key)) return;
    let resolve!: (error?: unknown) => void;
    const promise = new Promise<void>((settle) => {
      resolve = (error?: unknown) => {
        const gate = this.gates.get(key);
        if (gate != null) gate.error = error;
        settle();
      };
    });
    this.gates.set(key, { promise, resolve, error: undefined });
  }

  release(key: string, error?: unknown): void {
    const gate = this.gates.get(key);
    if (gate == null) return;
    gate.resolve(error);
    // Keep the released gate until the next operation passes it, so a test
    // may release before the queued operation reaches its gate.
  }

  private async pass(key: string): Promise<void> {
    const gate = this.gates.get(key);
    if (gate == null) return;
    await gate.promise;
    if (this.gates.get(key) === gate) this.gates.delete(key);
    if (gate.error != null) throw gate.error;
  }

  private enqueueProjectWrite(
    keys: string[],
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = Promise.all(
      keys.map(
        (key) => this.projectWriteTails.get(key) ?? Promise.resolve(),
      ),
    );
    const run = previous.then(operation);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    keys.forEach((key) => this.projectWriteTails.set(key, tail));
    return run;
  }

  private async waitForProjectWrite(key: string): Promise<void> {
    await (this.projectWriteTails.get(key) ?? Promise.resolve());
  }

  private enqueueTimelineWrite(
    key: string,
    operation: () => Promise<boolean>,
  ): Promise<boolean> {
    const previous = this.timelineWriteTails.get(key) ?? Promise.resolve();
    const run = previous.then(operation);
    this.timelineWriteTails.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async waitForTimelineWrites(key: string): Promise<void> {
    await (this.timelineWriteTails.get(key) ?? Promise.resolve());
  }

  get projects(): ProjectPersistence {
    return {
      list: async () => {
        await this.waitForProjectWrite("projects-index");
        await this.pass("projects-list");
        return this.inner.projects.list();
      },
      saveIndex: async (projects) => {
        this.indexWrites.push(projects);
        await this.enqueueProjectWrite(["projects-index"], async () => {
          await this.pass("projects-index-save");
          await this.inner.projects.saveIndex(projects);
        });
      },
      load: async (projectId) => {
        await this.waitForProjectWrite(`project:${projectId}`);
        await this.pass(`project-load:${projectId}`);
        const record: ProjectLoadRecord = {
          id: projectId,
          data: null,
          completed: false,
        };
        this.projectLoads.push(record);
        try {
          record.data = await this.inner.projects.load(projectId);
          return record.data;
        } finally {
          record.completed = true;
        }
      },
      save: async (projectId, data, indexUpdate) => {
        this.projectWrites.push({ id: projectId, data, indexUpdate });
        const keys = [`project:${projectId}`];
        if (indexUpdate != null) keys.push("projects-index");
        await this.enqueueProjectWrite(keys, async () => {
          await this.pass(`project-save:${projectId}`);
          await this.inner.projects.save(projectId, data, indexUpdate);
        });
      },
      saveBundle: async (projectId, data, projects) => {
        this.bundleWrites.push({ projectId, data, projects });
        await this.enqueueProjectWrite(
          [`project:${projectId}`, "projects-index"],
          async () => {
            await this.pass(`project-bundle:${projectId}`);
            await this.inner.projects.saveBundle(projectId, data, projects);
          },
        );
      },
      delete: async (projectId): Promise<ProjectDeleteResult> => {
        let result: ProjectDeleteResult = { unremoved: [] };
        await this.enqueueProjectWrite(
          [`project:${projectId}`, "projects-index"],
          async () => {
            result = await this.inner.projects.delete(projectId);
          },
        );
        return result;
      },
    };
  }

  get timelines(): TimelinePersistence {
    return {
      load: async (projectId, moduleId) => {
        const key = `timeline-load:${projectId}::${moduleId}`;
        await this.waitForTimelineWrites(
          `timeline-save:${projectId}::${moduleId}`,
        );
        await this.pass(key);
        const record: TimelineLoadRecord = {
          projectId,
          moduleId,
          data: null,
          completed: false,
        };
        this.timelineLoads.push(record);
        try {
          record.data = await this.inner.timelines.load(projectId, moduleId);
          return record.data;
        } finally {
          record.completed = true;
        }
      },
      save: async (projectId, moduleId, data) => {
        const record: TimelineWriteRecord = {
          projectId,
          moduleId,
          data,
          result: false,
          completed: false,
        };
        this.timelineWrites.push(record);
        const key = `timeline-save:${projectId}::${moduleId}`;
        return this.enqueueTimelineWrite(key, async () => {
          try {
            await this.pass(key);
            const result = await this.inner.timelines.save(
              projectId,
              moduleId,
              data,
            );
            record.result = result;
            return result;
          } finally {
            record.completed = true;
          }
        });
      },
    };
  }

  get revisions(): RevisionPersistence {
    return this.inner.revisions;
  }

  get providerCalls(): ProviderCallPersistence {
    return this.inner.providerCalls;
  }
}
