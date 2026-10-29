import { runInAction } from "mobx";
import {
  addMiddleware,
  applyPatch,
  type IAnyStateTreeNode,
  type SnapshotIn,
} from "mobx-state-tree";

import type { AgentCaller, AgentToolDescription } from "ai-agent/agent-access";
import {
  addressOf,
  type ClientConnection,
  type HostApi,
  type HostEvent,
  type HostInfo,
  type HostMessage,
  type LinkClosed,
  PERSISTENCE_METHODS,
  type PersistenceCall,
  type RequestMessage,
  type RequestName,
  type ResponseMessage,
  type SentRegistry,
  type SessionView,
  type StoreUpdate,
  type VolatileTextKey,
  type WireError,
  wireArguments,
} from "connection";
import { UserFacingError } from "lib/errors";
import type { ModuleEntry, ModuleRegistry } from "lib/moduleSchema";
import type { PersistenceAdapter } from "persistence";
import {
  type ExportableModule,
  type ProjectSessionSnapshot,
  SiblingModuleStores,
} from "project-session";
import { type ReplicatedVolatileState, Store } from "store";
import type { WorkflowStage } from "store/constants";
import type {
  ChangeFocus,
  ChangeSource,
  TimelineMeta,
  TurnPresentation,
} from "store/timeline/controller";
import type { PersistedTimeline } from "store/timeline/serialize";

type Result<Name extends RequestName> = Awaited<ReturnType<HostApi[Name]>>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface QueuedRequest extends PendingRequest {
  message: RequestMessage;
}

/** The first wait before connecting again after a lost connection; it doubles up to the maximum. */
const FIRST_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 8000;

const EMPTY_TIMELINE: TimelineMeta = {
  entries: [],
  canUndo: false,
  canRedo: false,
  isRewinding: false,
};

function errorFromWire(error: WireError): Error {
  if (error.name === "UserFacingError") return new UserFacingError(error.message);
  const rebuilt = new Error(error.message);
  rebuilt.name = error.name;
  return rebuilt;
}

/**
 * Whether the client reaches its host. A lost connection is retried; a
 * failed one cannot be, and every request fails with its message.
 */
export type ConnectionStatus =
  | { state: "connecting" }
  | { state: "open" }
  | { state: "reconnecting"; message: string }
  | { state: "failed"; message: string };

/** The registry a sent one describes, with left-out snapshots taken from the one held before. */
function receivedRegistry(
  sent: SentRegistry | null,
  held: ModuleRegistry | null,
): ModuleRegistry | null {
  if (sent == null) return null;
  return {
    ...sent,
    modules: sent.modules.map((entry): ModuleEntry => {
      if (entry.snapshot != null) return { ...entry, snapshot: entry.snapshot };
      const snapshot = held?.modules.find((module) => module.id === entry.id)?.snapshot;
      if (snapshot == null) {
        throw new Error(`The project host left out module ${entry.id}, which this client never received.`);
      }
      return { ...entry, snapshot };
    }),
  };
}

/** What the timeline offers a client: its history and the moves through it. */
export interface TimelineClient {
  subscribe(listener: () => void): () => void;
  getMeta(): TimelineMeta;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** False when the message is not bound to a timeline turn. */
  beginRewind(messageIndex: number): Promise<boolean>;
  cancelRewind(): Promise<void>;
  jumpToNode(nodeId: string): Promise<void>;
  activateBranch(leafId: string): Promise<void>;
  exportSnapshot(): Promise<PersistedTimeline | null>;
}

function snapshotFrom(
  view: SessionView,
  registry: ModuleRegistry | null,
  store: Store,
): ProjectSessionSnapshot {
  if (view.status !== "ready") return { ...view, registry: null, store };
  if (registry == null) {
    throw new Error("The project host reported a ready project without its modules.");
  }
  return { ...view, registry, store };
}

/**
 * A request whose answer was lost with the connection: the host may or may
 * not have carried it out.
 */
export class ConnectionLostError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionLostError";
  }
}

/**
 * A replica of the project a host serves. It shows the host's session and
 * store and never changes them itself: root store actions called on the
 * replica are forwarded and return a promise that settles once the host has
 * applied them and the replica has caught up; session and timeline
 * operations are requests with the same guarantee. A request made while
 * disconnected waits for the connection, so callers never depend on when
 * the connection opens.
 */
export class ProjectClient {
  readonly persistence: PersistenceAdapter;
  readonly timeline: TimelineClient;
  readonly changeSource: ChangeSource;

  private readonly connect: () => ClientConnection;
  private connection: { link: ClientConnection; stopListening: () => void } | null = null;
  private opened = false;
  private connectionStatus: ConnectionStatus = { state: "connecting" };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = FIRST_RECONNECT_DELAY_MS;
  /** Sent requests waiting for their answer. */
  private readonly pending = new Map<number, PendingRequest>();
  /** Requests made before a connection opened; sent in order once one has. */
  private readonly queued: QueuedRequest[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly timelineListeners = new Set<() => void>();
  private readonly focusListeners = new Set<(focus: ChangeFocus) => void>();
  private readonly siblingStores = new SiblingModuleStores();

  private nextRequestId = 0;
  private view: SessionView = {
    status: "idle",
    activeProject: null,
    persistenceError: null,
    outsideChange: null,
  };
  private hostInfo: HostInfo = {
    reviewerModel: null,
    missingReviewerModelMessage: "",
    storage: { singleProject: false, name: "storage" },
  };
  private registry: ModuleRegistry | null = null;
  private replica: Store;
  private snapshot: ProjectSessionSnapshot;
  private timelineMeta: TimelineMeta = EMPTY_TIMELINE;
  /** The turn kind of the update being applied; null between updates. */
  private applyingTurn: TurnPresentation | null = null;
  private applyingLocally = false;

  constructor(connect: () => ClientConnection) {
    this.connect = connect;
    // Until the host's first event arrives, actions on this blank replica
    // name a store the host never shows, so they are refused.
    this.replica = this.createReplica("", { productOverview: {} }, null);
    this.snapshot = snapshotFrom(this.view, this.registry, this.replica);
    this.persistence = this.remotePersistence();
    this.timeline = {
      subscribe: (listener) => {
        this.timelineListeners.add(listener);
        return () => {
          this.timelineListeners.delete(listener);
        };
      },
      getMeta: () => this.timelineMeta,
      undo: () => this.request("undo"),
      redo: () => this.request("redo"),
      beginRewind: (messageIndex) => this.request("beginRewind", messageIndex),
      cancelRewind: () => this.request("cancelRewind"),
      jumpToNode: (nodeId) => this.request("jumpToNode", nodeId),
      activateBranch: (leafId) => this.request("activateBranch", leafId),
      exportSnapshot: () => this.request("exportTimeline"),
    };
    this.changeSource = {
      onChangeFocus: (listener) => {
        this.focusListeners.add(listener);
        return () => {
          this.focusListeners.delete(listener);
        };
      },
      currentTurnPresentation: () => this.applyingTurn,
    };
  }

  /**
   * Connect to the host and send the requests made meanwhile. The host
   * answers with its current session and store, which replace whatever this
   * replica showed before. A connection the host side loses is opened again
   * until it opens or fails for good. Returns the disconnect.
   *
   * Requests sent and not yet answered fail whenever a connection ends,
   * since their answers can no longer arrive. Requests made while no
   * connection is open wait until one opens: a connection counts as open
   * once the host's first message arrives on it, so an attempt that fails
   * before that never takes them with it.
   */
  open(): () => void {
    if (this.opened) throw new Error("The project client is already connected.");
    this.opened = true;
    this.attach();
    return () => {
      if (!this.opened) return;
      this.opened = false;
      this.clearReconnect();
      this.detach(new Error("The connection to the project host is closed."));
      this.reconnectDelay = FIRST_RECONNECT_DELAY_MS;
      this.setConnectionStatus({ state: "connecting" });
    };
  }

  /** Whether the host is reachable; notified through `subscribe`. */
  getConnectionStatus = (): ConnectionStatus => this.connectionStatus;

  private attach(): void {
    let link: ClientConnection;
    try {
      link = this.connect();
    } catch (error) {
      this.linkClosed({
        retry: false,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const stopListening = link.subscribe({
      message: (message) => {
        if (this.connection?.link !== link) return;
        if (this.connectionStatus.state !== "open") {
          this.reconnectDelay = FIRST_RECONNECT_DELAY_MS;
          this.setConnectionStatus({ state: "open" });
          for (const request of this.queued.splice(0)) this.send(link, request);
        }
        this.receive(message);
      },
      closed: (reason) => {
        if (this.connection?.link !== link) return;
        this.detach(new ConnectionLostError(reason.message), { closeLink: false });
        this.linkClosed(reason);
      },
    });
    this.connection = { link, stopListening };
  }

  /** End the current connection; requests waiting for its answers fail with `error`. */
  private detach(error: Error, options: { closeLink: boolean } = { closeLink: true }): void {
    const connection = this.connection;
    if (connection == null) return;
    this.connection = null;
    connection.stopListening();
    if (options.closeLink) connection.link.close();
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private linkClosed(reason: LinkClosed): void {
    if (!reason.retry) {
      this.setConnectionStatus({ state: "failed", message: reason.message });
      const failure = new UserFacingError(reason.message);
      for (const request of this.queued.splice(0)) request.reject(failure);
      return;
    }
    this.setConnectionStatus({ state: "reconnecting", message: reason.message });
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.opened && this.connection == null) this.attach();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer == null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    for (const listener of this.listeners) listener();
  }

  // Public operations are arrow properties: React context passes them to
  // consumers as bare callbacks, where prototype methods would lose `this`.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ProjectSessionSnapshot => this.snapshot;

  /** What the host reported about itself; notified through `subscribe`. */
  getHostInfo = (): HostInfo => this.hostInfo;

  selectProject = (
    id: string,
    name: string,
    options?: { overviewSeed?: string },
  ): Promise<void> => this.request("selectProject", id, name, options);

  backToProjects = (): Promise<void> => this.request("backToProjects");

  clearPersistenceError = (): Promise<void> =>
    this.request("clearPersistenceError");

  enableModules = (name: string): Promise<void> =>
    this.request("enableModules", name);

  addModule = (name: string): Promise<void> => this.request("addModule", name);

  switchModule = (id: string): Promise<boolean> =>
    this.request("switchModule", id);

  archiveModule = (id: string): Promise<void> =>
    this.request("archiveModule", id);

  renameModule = (id: string, name: string): Promise<void> =>
    this.request("renameModule", id, name);

  renameProject = (name: string): Promise<void> =>
    this.request("renameProject", name);

  recordOpenStep = (step: WorkflowStage): Promise<void> =>
    this.request("recordOpenStep", step);

  importProjectFile = (data: unknown): Promise<void> =>
    this.request("importProjectFile", data);

  openChangedProject = (): Promise<void> => this.request("openChangedProject");

  keepShownProject = (): Promise<void> => this.request("keepShownProject");

  /** The tools an outside agent can call on the open project now. */
  listAgentTools = (): Promise<AgentToolDescription[]> => this.request("listAgentTools");

  /** Run one of those tools for the named agent; resolves to its text result. */
  callAgentTool = (name: string, args: Record<string, unknown>, caller: AgentCaller): Promise<string> =>
    this.request("callAgentTool", name, args, caller);

  /** Every visible module, backed by the replica or a sibling store. */
  getExportModules = (): ExportableModule[] => {
    if (this.snapshot.status !== "ready") return [];
    return this.siblingStores.exportModules(this.snapshot.registry, this.replica);
  };

  private request<Name extends RequestName>(
    name: Name,
    ...args: Parameters<HostApi[Name]>
  ): Promise<Result<Name>> {
    let sent: unknown[];
    try {
      sent = wireArguments(name, args);
    } catch (error) {
      return Promise.reject(error);
    }
    const message: RequestMessage = {
      type: "request",
      id: (this.nextRequestId += 1),
      name,
      args: sent,
    };
    if (this.connectionStatus.state === "failed") {
      return Promise.reject(new UserFacingError(this.connectionStatus.message));
    }
    return new Promise<Result<Name>>((resolve, reject) => {
      const request: QueuedRequest = {
        message,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (this.connection == null || this.connectionStatus.state !== "open") {
        this.queued.push(request);
      } else {
        this.send(this.connection.link, request);
      }
    });
  }

  private send(connection: ClientConnection, request: QueuedRequest): void {
    const { message, resolve, reject } = request;
    this.pending.set(message.id, { resolve, reject });
    try {
      connection.send(message);
    } catch (error) {
      this.pending.delete(message.id);
      reject(error);
    }
  }

  /** Forward a root action called on the replica showing store image `store`. */
  private forwardAction(
    store: string,
    call: { context: IAnyStateTreeNode; name: string; args: unknown[] },
  ): Promise<unknown> {
    let args: unknown[];
    try {
      args = wireArguments(call.name, call.args);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.request("runStoreAction", {
      store,
      address: addressOf(call.context),
      name: call.name,
      args,
    });
  }

  private remotePersistence(): PersistenceAdapter {
    const adapter: Record<string, Record<string, (...args: unknown[]) => unknown>> = {};
    for (const [group, methods] of Object.entries(PERSISTENCE_METHODS)) {
      const calls: Record<string, (...args: unknown[]) => unknown> = {};
      for (const method of Object.keys(methods)) {
        calls[method] = (...args: unknown[]) => {
          let sent: unknown[];
          try {
            sent = wireArguments(`${group}.${method}`, args);
          } catch (error) {
            return Promise.reject(error);
          }
          const call: PersistenceCall = {
            group: group as PersistenceCall["group"],
            method,
            args: sent,
          };
          return this.request("runPersistence", call);
        };
      }
      adapter[group] = calls;
    }
    // The host describes its storage when the connection opens.
    Object.defineProperty(adapter, "traits", {
      enumerable: true,
      get: () => this.hostInfo.storage,
    });
    return adapter as unknown as PersistenceAdapter;
  }

  /** Run replica-side bookkeeping that must not be forwarded to the host. */
  private local(change: () => void): void {
    const previous = this.applyingLocally;
    this.applyingLocally = true;
    try {
      change();
    } finally {
      this.applyingLocally = previous;
    }
  }

  private createReplica(
    id: string,
    snapshot: unknown,
    volatile: ReplicatedVolatileState | null,
  ): Store {
    const replica = Store.create(snapshot as SnapshotIn<typeof Store>);
    addMiddleware(
      replica,
      (call, next, abort) => {
        if (this.applyingLocally) {
          next(call);
          return;
        }
        abort(this.forwardAction(id, call));
      },
      // Lifecycle hooks run on the replica itself and are never forwarded.
      false,
    );
    this.local(() => {
      if (volatile != null) replica.mirrorVolatileState(volatile);
      this.siblingStores.applyModuleContext(replica, this.registry);
    });
    return replica;
  }

  private receive(message: HostMessage): void {
    if (message.type === "response") {
      this.settle(message);
      return;
    }
    this.applyEvent(message.event);
  }

  private settle(response: ResponseMessage): void {
    const request = this.pending.get(response.id);
    if (request == null) return;
    this.pending.delete(response.id);
    if (response.ok) request.resolve(response.value);
    else request.reject(errorFromWire(response.error));
  }

  private applyEvent(event: HostEvent): void {
    switch (event.type) {
      case "host":
        this.hostInfo = event.info;
        for (const listener of this.listeners) listener();
        return;
      case "session":
        this.applySession(event);
        return;
      case "store-update":
        this.applyUpdate(event.update);
        return;
    }
  }

  private applySession(event: Extract<HostEvent, { type: "session" }>): void {
    const registryChanged = "registry" in event;
    if (registryChanged) this.registry = receivedRegistry(event.registry ?? null, this.registry);
    if (event.store != null) {
      const { id, snapshot, volatile } = event.store;
      this.replica = this.createReplica(id, snapshot, volatile);
    } else if (registryChanged) {
      this.local(() => this.siblingStores.applyModuleContext(this.replica, this.registry));
    }
    this.view = event.session;
    this.snapshot = snapshotFrom(this.view, this.registry, this.replica);
    for (const listener of this.listeners) listener();
  }

  /**
   * Apply one host update. The patches land and the change focus is handed
   * to presenters inside one batch, so store observers run after both, while
   * the update's turn kind is current: the same order a presenter sees next
   * to the authority's own store.
   */
  private applyUpdate(update: StoreUpdate): void {
    const replica = this.replica;
    this.applyingTurn = update.turn;
    try {
      runInAction(() => {
        this.local(() => {
          if (update.patches.length > 0) applyPatch(replica, update.patches);
          const volatile: Partial<ReplicatedVolatileState> = { ...update.volatile };
          for (const [key, text] of Object.entries(update.appended) as [VolatileTextKey, string][]) {
            volatile[key] = replica[key] + text;
          }
          if (Object.keys(volatile).length > 0) replica.mirrorVolatileState(volatile);
        });
        if (update.focus != null) {
          for (const listener of this.focusListeners) listener(update.focus);
        }
      });
    } finally {
      this.applyingTurn = null;
    }
    if (update.timeline != null) {
      this.timelineMeta = update.timeline;
      for (const listener of this.timelineListeners) listener();
    }
    for (const event of update.events) {
      replica.eventTarget.emit(event.name, event.step);
    }
  }
}
