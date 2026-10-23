import type { ProjectIndexUpdate } from "../../app/lib/projectStorage";
import {
  MemoryPersistenceAdapter,
  type PersistenceAdapter,
  type ProjectPersistence,
} from "../../app/persistence";

interface PendingProjectWrite {
  projectId: string;
  data: unknown;
  indexUpdate: ProjectIndexUpdate | undefined;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * A project-write double whose results settle in the order a test chooses.
 * It deliberately does not serialize writes: the session's write-sequence
 * test needs an earlier write to fail after a later write succeeded, which a
 * well-behaved adapter never does on its own.
 */
export class ManualProjectWriteAdapter implements PersistenceAdapter {
  readonly inner = new MemoryPersistenceAdapter();
  readonly pending: PendingProjectWrite[] = [];

  get projects(): ProjectPersistence {
    const inner = this.inner.projects;
    return {
      list: () => inner.list(),
      saveIndex: (projects) => inner.saveIndex(projects),
      load: (projectId) => inner.load(projectId),
      save: (projectId, data, indexUpdate) =>
        new Promise<void>((resolve, reject) => {
          this.pending.push({
            projectId,
            data,
            indexUpdate,
            resolve,
            reject,
          });
        }),
      saveBundle: (projectId, data, projects) =>
        inner.saveBundle(projectId, data, projects),
      delete: (projectId) => inner.delete(projectId),
    };
  }

  get timelines() {
    return this.inner.timelines;
  }

  get revisions() {
    return this.inner.revisions;
  }

  get providerCalls() {
    return this.inner.providerCalls;
  }

  async settle(position: number, error?: unknown): Promise<void> {
    const [entry] = this.pending.splice(position, 1);
    if (entry == null) throw new Error("No pending project write at that position.");
    if (error != null) {
      entry.reject(error);
      return;
    }
    await this.inner.projects.save(
      entry.projectId,
      entry.data,
      entry.indexUpdate,
    );
    entry.resolve();
  }
}
