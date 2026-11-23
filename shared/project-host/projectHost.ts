import {
  getMembers,
  getSnapshot,
  type IJsonPatch,
  onPatch,
  onSnapshot,
} from "mobx-state-tree";

import { AgentsHost, type TemplatesSource } from "agents";
import {
  type ClientMessage,
  type HostApi,
  type HostEndpoint,
  type HostEvent,
  type HostInfo,
  type HostLink,
  type HostMessage,
  PERSISTENCE_METHODS,
  type PersistenceCall,
  type RequestMessage,
  resolveAddress,
  type ResponseMessage,
  type SentRegistry,
  type StoreActionCall,
  type StoreImage,
  type WireError,
} from "connection";
import { ConfirmationNeededError, DelegationHost } from "delegation";
import type { ChangeKind, FocusPlace } from "history";
import { UserFacingError } from "lib/errors";
import { activeModule, visibleModuleNamed, visibleModules } from "modules";
import type { ProjectSession, ProjectSessionSnapshot } from "project-session";
import type { ModuleContent, ModuleRegistry } from "storage";
import type { StorageTraits } from "storage/persistence";
import type { Store } from "store";
import { uuid } from "utilities";

function wireError(error: unknown): WireError {
  if (error instanceof ConfirmationNeededError) return { name: error.name, message: error.message, confirmation: { threads: error.threads, notes: error.notes } };
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

function hostInfo(storage: StorageTraits): HostInfo {
  return { storage };
}

function contentsOf(registry: ModuleRegistry | null): Map<string, ModuleContent> {
  return new Map((registry?.modules ?? []).map((entry) => [entry.id, entry.content]));
}

/**
 * The store actions the page may take, each with the kind of change its
 * step names. The page takes no other: one missing here is refused, so
 * none is recorded under a kind it was not given.
 */
const PAGE_ACTION_KINDS = {
  writeItems: "edit",
  restoreSigned: "edit",
  sign: "signature",
  messageUnit: "thread message",
  openStageThread: "thread message",
  replyAsSpecOwner: "thread message",
  resolveThread: "thread resolution",
} as const satisfies { readonly [Name in keyof Store]?: ChangeKind };

function pageActionKind(name: string): ChangeKind {
  if (!Object.hasOwn(PAGE_ACTION_KINDS, name)) throw new Error(`${name} is not an action the page takes.`);
  return PAGE_ACTION_KINDS[name as keyof typeof PAGE_ACTION_KINDS];
}

function sessionView(snapshot: ProjectSessionSnapshot) {
  const { store: _store, registry: _registry, ...view } = snapshot;
  return view;
}

/**
 * The project authority: it owns the session, the only writable store,
 * and the agent tools that act on it. Clients see the session and the
 * shown store through the events it sends and change them only through
 * requests; every connected client receives the same events in the same
 * order.
 */
export class ProjectHost implements HostEndpoint {
  readonly session: ProjectSession;
  private readonly api: HostApi;
  private readonly links = new Set<(message: HostMessage) => void>();
  private readonly disposers: (() => void)[] = [];

  private shown: { id: string; store: Store; stopObserving: () => void } | null =
    null;
  private sentHostInfo: HostInfo;
  private sentRegistry: ModuleRegistry | null = null;
  /** The module contents every client holds, by module id. */
  private sentContents = new Map<string, ModuleContent>();
  private pendingPatches: IJsonPatch[] = [];
  private flushScheduled = false;
  /** The agents of the project and the agent interface. */
  readonly agents: AgentsHost;
  /** The threads assigned to agents and the work agents do on the spec. */
  readonly delegation: DelegationHost;

  constructor(session: ProjectSession, templates: TemplatesSource) {
    this.session = session;
    this.sentHostInfo = hostInfo(session.persistence.traits);
    const agentsSession = {
      openProjectId: () => {
        const snapshot = session.getSnapshot();
        return snapshot.status === "ready" ? snapshot.activeProject.id : null;
      },
      keptBeside: (key: "agents") => session.keptBeside(key),
      keepBeside: (key: "agents", value: unknown) => session.keepBeside(key, value),
    };
    this.agents = new AgentsHost(agentsSession, templates, (view) => {
      if (this.links.size > 0) this.broadcast({ type: "agents", view });
    });
    this.delegation = new DelegationHost(session, this.agents, (view) => {
      if (this.links.size > 0) this.broadcast({ type: "delegation", view });
    });
    const replacing = this.delegation.clearReplacing.bind(this.delegation);
    const moduleChange = <Result>(run: () => Result): Result => session.change("module change", run);
    this.api = {
      selectProject: (id, name, options) =>
        session.selectProject(id, name, options),
      backToProjects: () => session.backToProjects(),
      clearPersistenceError: () => session.clearPersistenceError(),
      enableModules: (name) => moduleChange(() => session.enableModules(name)),
      addModule: (name) => moduleChange(() => session.addModule(name)),
      switchModule: (id) => moduleChange(() => session.switchModule(id)),
      archiveModule: (id) => moduleChange(() => session.archiveModule(id)),
      bringBackModule: (id) => moduleChange(() => session.bringBackModule(id)),
      renameModule: (id, name) => moduleChange(() => session.renameModule(id, name)),
      renameProject: (name) => session.renameProject(name),
      createProject: (name) => session.createProject(name),
      importNewProject: (text, fileName) => session.importNewProject(text, fileName),
      takeOverProject: () => session.takeOverProject(),
      importProjectFile: async (text, fileName, confirmed) => {
        await replacing({ kind: "import", text, fileName }, confirmed);
        session.change("import", () => session.importProjectFile(text, fileName));
      },
      exportProject: (options, restorePointId) => session.exportProject(options, restorePointId),
      openChangedProject: async (confirmed) => {
        await replacing({ kind: "open changed" }, confirmed);
        await session.openChangedProject();
      },
      keepShownProject: () => session.keepShownProject(),
      leaveProjectRemoved: () => session.leaveProjectRemoved(),
      undo: async (confirmed) => {
        await replacing({ kind: "undo" }, confirmed);
        return session.undo();
      },
      redo: async (confirmed) => {
        await replacing({ kind: "redo" }, confirmed);
        return session.redo();
      },
      listSteps: () => session.listSteps(),
      goTo: async (target, confirmed) => {
        await replacing({ kind: "go to", target }, confirmed);
        session.goTo(target);
      },
      listRestorePoints: () => session.listRestorePoints(),
      differenceFromNow: (target) => session.differenceFromNow(target),
      preview: async (target) => {
        const { state, difference, heldNow } = await session.preview(target);
        // The client holds the content of every module the project now shares with that state, as the changes before this answer reach it first.
        const modules = state.modules.map((entry) => {
          if (!heldNow.has(entry.id)) return entry;
          const { content: _held, ...rest } = entry;
          return rest;
        });
        return { state: { ...state, modules }, difference };
      },
      reportFocus: (place) => session.reportFocus(place),
      dismissOffer: (offerId) => session.dismissOffer(offerId),
      makeRestorePoint: (name) => session.makeRestorePoint(name),
      restoreToRestorePoint: async (restorePointId, confirmed) => {
        await replacing({ kind: "restore", restorePointId }, confirmed);
        await session.restoreToRestorePoint(restorePointId);
      },
      pinRestorePoint: (restorePointId) => session.pinRestorePoint(restorePointId),
      unpinRestorePoint: (restorePointId) => session.unpinRestorePoint(restorePointId),
      deleteRestorePoint: (restorePointId) => session.deleteRestorePoint(restorePointId),
      reportTimeZone: (timeZone) => session.reportTimeZone(timeZone),
      deleteProject: (projectId) => session.deleteProject(projectId),
      runStoreAction: (call) => {
        const assignTo = call.assignTo ?? null;
        if (this.shown != null) this.delegation.clearStoreAction(this.shown.store, call.name, call.args, call.confirmed ?? [], assignTo);
        // The stage is read before the action, which may remove the unit it starts from, such as a signed removal.
        const stage = call.focusMove == null ? null : (this.shown?.store.unitState(call.focusMove.from)?.stage ?? null);
        let focusMovedTo: FocusPlace | null = null;
        const result = session.change(pageActionKind(call.name), () => this.runStoreAction(call), "spec owner", () => {
          focusMovedTo = this.focusAfter(call, stage);
          return focusMovedTo;
        });
        if (this.shown != null) this.delegation.storeActionDone(this.shown.store, call.name, call.args, result, assignTo);
        return { result, focusMovedTo };
      },
      runPersistence: (call) => this.runPersistence(call),
      // Answered for the connection they come through.
      listAgentTools: () => Promise.reject(new Error("listAgentTools is answered for its connection.")),
      callAgentTool: () => Promise.reject(new Error("callAgentTool is answered for its connection.")),
      registerAgent: () => {
        throw new Error("registerAgent is answered for its connection.");
      },
      ...this.agents.api,
      ...this.delegation.api,
    };
  }

  /**
   * Observe the session and the shown store. Only while a
   * client is connected: a host nobody connected to holds no subscriptions.
   */
  private startObserving(): void {
    const initial = this.session.getSnapshot();
    this.sentHostInfo = hostInfo(this.session.persistence.traits);
    this.sentRegistry = initial.registry;
    this.sentContents = contentsOf(initial.registry);
    this.showStore(initial.store);
    // The modules learn which project is open now, which may have opened before anyone was connected.
    this.agents.sessionChanged();
    this.delegation.sessionChanged();
    this.disposers.push(this.session.subscribe(() => this.sessionChanged()));
  }

  private stopObserving(): void {
    this.shown?.stopObserving();
    this.shown = null;
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  connect(send: (message: HostMessage) => void): HostLink {
    if (this.links.size === 0) this.startObserving();
    // Changes the existing clients have not seen yet are already part of the
    // image the new client starts from, so they go out first.
    this.flushUpdate();
    this.links.add(send);
    // Names this client to what it takes up, so that it ends with the connection.
    const connection = uuid();
    const snapshot = this.session.getSnapshot();
    send({ type: "event", event: { type: "host", info: this.sentHostInfo } });
    send({
      type: "event",
      event: {
        type: "session",
        session: sessionView(snapshot),
        // A new client holds nothing yet, so it gets every module's content.
        registry: snapshot.registry,
        store: this.storeImage(),
      },
    });
    send({ type: "event", event: { type: "agents", view: this.agents.view() } });
    send({ type: "event", event: { type: "delegation", view: this.delegation.view() } });
    return {
      receive: (message: ClientMessage) => this.receive(send, message, connection),
      close: () => {
        if (!this.links.delete(send)) return;
        this.agents.connectionEnded(connection);
        if (this.links.size === 0) this.stopObserving();
      },
    };
  }

  private broadcast(event: HostEvent): void {
    for (const send of this.links) send({ type: "event", event });
  }

  private receive(send: (message: HostMessage) => void, message: ClientMessage, connection: string): void {
    if (message.type !== "request") return;
    void this.respond(send, message, connection);
  }

  private async respond(
    send: (message: HostMessage) => void,
    message: RequestMessage,
    connection: string,
  ): Promise<void> {
    let response: ResponseMessage;
    try {
      const value = await this.dispatch(send, message, connection);
      response = { type: "response", id: message.id, ok: true, value };
    } catch (error) {
      response = { type: "response", id: message.id, ok: false, error: wireError(error) };
    }
    // A request's own changes always reach the client before its answer.
    this.flushUpdate();
    if (!this.links.has(send)) return;
    try {
      send(response);
    } catch (error) {
      // The answer itself could not be sent; the request still settles.
      send({ type: "response", id: message.id, ok: false, error: wireError(error) });
    }
  }

  private dispatch(send: (message: HostMessage) => void, message: RequestMessage, connection: string): unknown {
    if (!Object.hasOwn(this.api, message.name)) {
      throw new Error(`The project host has no request named ${String(message.name)}.`);
    }
    if (message.name === "registerAgent") {
      const [registration] = message.args as Parameters<HostApi["registerAgent"]>;
      return this.agents.register(connection, registration, (notice) => send({ type: "event", event: { type: "agent-notice", notice } }));
    }
    if (message.name === "listAgentTools") return this.agents.listTools(connection);
    if (message.name === "callAgentTool") {
      const [name, args] = message.args as Parameters<HostApi["callAgentTool"]>;
      return this.agents.callTool(name, args, { connection });
    }
    const handler = this.api[message.name] as (...args: unknown[]) => unknown;
    return handler(...message.args);
  }

  private runStoreAction(call: StoreActionCall): unknown {
    const shown = this.shown;
    if (shown == null || shown.id !== call.store) {
      throw new Error("The module changed before the action reached it.");
    }
    const target = resolveAddress(shown.store, call.address);
    if (target == null) {
      throw new Error("The item the action was meant for no longer exists.");
    }
    if (!getMembers(target).actions.includes(call.name)) {
      throw new Error(`${call.name} is not a store action.`);
    }
    const action = (target as unknown as Record<string, (...args: unknown[]) => unknown>)[
      call.name
    ];
    return action(...call.args);
  }

  /** Where a store action that moves the focus within `stage` moved it, read once it ran; null for one that does not. */
  private focusAfter(call: StoreActionCall, stage: string | null): FocusPlace | null {
    const { focusMove } = call;
    const shown = this.shown;
    const { registry } = this.session.getSnapshot();
    if (focusMove == null || shown == null || registry == null) return null;
    const unitId = shown.store.unitAfterSigning(focusMove);
    return stage == null || unitId == null ? null : { moduleId: registry.activeModuleId, stage, unitId };
  }

  private runPersistence(call: PersistenceCall): unknown {
    const methods: Record<string, true> | undefined = Object.hasOwn(
      PERSISTENCE_METHODS,
      call.group,
    )
      ? PERSISTENCE_METHODS[call.group]
      : undefined;
    if (methods == null || !Object.hasOwn(methods, call.method)) {
      throw new Error(`Storage has no operation ${call.group}.${call.method}.`);
    }
    const group = this.session.persistence[call.group] as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    return group[call.method](...call.args);
  }

  private sessionChanged(): void {
    const snapshot = this.session.getSnapshot();
    this.agents.sessionChanged();
    this.delegation.sessionChanged();
    const event: Extract<HostEvent, { type: "session" }> = {
      type: "session",
      session: sessionView(snapshot),
    };
    if (snapshot.registry !== this.sentRegistry) {
      this.sentRegistry = snapshot.registry;
      event.registry = this.registryToSend(snapshot.registry);
    }
    if (snapshot.store !== this.shown?.store) {
      this.showStore(snapshot.store);
      event.store = this.storeImage();
    }
    this.broadcast(event);
  }

  /** The registry with every module's content left out that all clients already hold. */
  private registryToSend(registry: ModuleRegistry | null): SentRegistry | null {
    const held = this.sentContents;
    this.sentContents = contentsOf(registry);
    if (registry == null) return null;
    return {
      ...registry,
      modules: registry.modules.map((entry) => {
        if (held.get(entry.id) !== entry.content) return entry;
        const { content: _held, ...rest } = entry;
        return rest;
      }),
    };
  }

  /** Observe another store; what the previous one still had pending goes with it. */
  private showStore(store: Store): void {
    this.shown?.stopObserving();
    this.pendingPatches = [];

    const stopPatches = onPatch(store, (patch) => {
      this.pendingPatches.push(patch);
    });
    // Flushed when the change finishes; what waits may have changed with it.
    const stopSnapshots = onSnapshot(store, () => {
      this.flushUpdate();
      this.delegation.storeChanged();
    });

    this.shown = {
      id: uuid(),
      store,
      stopObserving: () => {
        stopPatches();
        stopSnapshots();
      },
    };
  }

  private storeImage(): StoreImage {
    const shown = this.shown!;
    return {
      id: shown.id,
      snapshot: getSnapshot(shown.store),
    };
  }

  /** A store event or history change made outside any store change still reaches clients. */
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flushUpdate();
    });
  }

  /**
   * Send what the shown store went through since the last
   * update.
   */
  private flushUpdate(): void {
    const shown = this.shown;
    if (shown == null) return;
    if (this.pendingPatches.length === 0) return;
    const patches = this.pendingPatches;
    this.pendingPatches = [];
    this.broadcast({ type: "store-update", update: { patches } });
  }
}
