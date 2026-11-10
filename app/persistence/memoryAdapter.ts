import { type Address, parseHistory, type ProjectHistory, serializeCanonical, serializeProject } from "storage-and-recovery";

import type { HistoryPersistence, PersistenceAdapter, ProjectPersistence, ProjectWrite } from "./adapter";
import { type ProjectMeta, ProjectStorageError } from "../lib/projectStorage";

interface MemoryProject {
  meta: ProjectMeta;
  source: string;
  history: string;
  pieces: Map<Address, string>;
}

/**
 * A `PersistenceAdapter` that keeps projects in memory, for steps that need
 * a storage without a browser or files. It stores the bytes the other
 * storages store, so what it returns is a copy, as theirs is, and a write
 * stores the project, its pieces and its history together, as browser
 * storage does.
 */
export class MemoryPersistenceAdapter implements PersistenceAdapter {
  readonly traits = { singleProject: false, name: "memory" };
  private readonly stored = new Map<string, MemoryProject>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  private store(write: ProjectWrite, existing: MemoryProject | undefined): void {
    const pieces = new Map(existing?.pieces);
    for (const [address, bytes] of write.pieces) pieces.set(address, bytes);
    this.stored.set(write.project.id, {
      meta: { ...write.project, updatedAt: this.now().toISOString() },
      source: serializeProject(write.state),
      history: serializeCanonical(write.written),
      pieces,
    });
  }

  readonly projects: ProjectPersistence = {
    list: async () => [...this.stored.values()].map(({ meta }) => ({ ...meta })),
    load: async (projectId) => {
      const project = this.stored.get(projectId);
      return project == null ? null : (JSON.parse(project.source) as unknown);
    },
    create: async (write) => {
      if (this.stored.has(write.project.id)) throw new ProjectStorageError("The project already exists.");
      this.store(write, undefined);
    },
    write: async (write) => {
      this.store(write, this.stored.get(write.project.id));
    },
    delete: async (projectId) => {
      this.stored.delete(projectId);
    },
  };

  readonly history: HistoryPersistence = {
    load: async (projectId): Promise<ProjectHistory | null> => {
      const project = this.stored.get(projectId);
      return project == null ? null : parseHistory(JSON.parse(project.history));
    },
    pieceAddresses: async (projectId) => [...(this.stored.get(projectId)?.pieces.keys() ?? [])],
    readPiece: async (projectId, address) => this.stored.get(projectId)?.pieces.get(address) ?? null,
    deletePieces: async (projectId, addresses) => {
      const pieces = this.stored.get(projectId)?.pieces;
      for (const address of addresses) pieces?.delete(address);
    },
  };
}
