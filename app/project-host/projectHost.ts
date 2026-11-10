import { reaction } from "mobx";
import {
  getMembers,
  getSnapshot,
  type IJsonPatch,
  onPatch,
  onSnapshot,
} from "mobx-state-tree";

import { agentToolDescriptions, callAgentTool, type OpenModule, readToolDescriptions } from "ai-agent/agent-access";
import { aiSettings } from "ai-agent/settings";
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
import { UserFacingError } from "lib/errors";
import { activeModule, visibleModuleNamed, visibleModules } from "lib/moduleSchema";
import type { StorageTraits } from "persistence";
import type { ProjectSession, ProjectSessionSnapshot } from "project-session";
import type { ChangeKind, ModuleContent, ModuleRegistry } from "storage-and-recovery";
import {
  replicatedVolatileState,
  type ReplicatedVolatileState,
  type Store,
} from "store";
import { uuid } from "utilities";

function wireError(error: unknown): WireError {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

function hostInfo(storage: StorageTraits): HostInfo {
  const settings = aiSettings();
  return {
    reviewerModel: settings.read().reviewerModel,
    missingReviewerModelMessage: settings.missingReviewerModelMessage,
    storage,
  };
}

function sameHostInfo(left: HostInfo, right: HostInfo): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function contentsOf(registry: ModuleRegistry | null): Map<string, ModuleContent> {
  return new Map((registry?.modules ?? []).map((entry) => [entry.id, entry.content]));
}

/** The store actions that are not edits, by the kind of change they make. */
const STORE_ACTION_KINDS: Readonly<Record<string, ChangeKind>> = {
  sign: "signature",
  requestChange: "thread message",
  replyAsSpecOwner: "thread message",
  answerThreads: "thread message",
  resolveThread: "thread resolution",
};

function storeActionKind(name: string): ChangeKind {
  return Object.hasOwn(STORE_ACTION_KINDS, name) ? STORE_ACTION_KINDS[name]! : "edit";
}

/** The agent tools that change the project's modules rather than write its spec. */
const MODULE_TOOLS: ReadonlySet<string> = new Set(["create_module", "switch_module"]);

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
  private sentVolatile: ReplicatedVolatileState | null = null;
  private pendingPatches: IJsonPatch[] = [];
  private flushScheduled = false;

  constructor(session: ProjectSession) {
    this.session = session;
    this.sentHostInfo = hostInfo(session.persistence.traits);
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
      renameModule: (id, name) => moduleChange(() => session.renameModule(id, name)),
      renameProject: (name) => session.renameProject(name),
      createProject: (name) => session.createProject(name),
      importNewProject: (data, fileName) => session.importNewProject(data, fileName),
      takeOverProject: () => session.takeOverProject(),
      importProjectFile: (data) => session.change("import", () => session.importProjectFile(data)),
      exportProject: (options, restorePointId) => session.exportProject(options, restorePointId),
      openChangedProject: () => session.openChangedProject(),
      keepShownProject: () => session.keepShownProject(),
      runStoreAction: (call) => session.change(storeActionKind(call.name), () => this.runStoreAction(call)),
      runPersistence: (call) => this.runPersistence(call),
      listAgentTools: async () => {
        // Without an open project the read tools are still listed: calling
        // one tells the agent what stands in the way.
        const store = await this.openStore().catch(() => null);
        return store == null ? readToolDescriptions() : agentToolDescriptions(this.openModule());
      },
      callAgentTool: async (name, args, caller) => {
        const store = await this.openStore();
        // One call is one change, though a write with answers takes two store
        // actions. Reading goes through the gate too: while an outside change
        // waits, either version may be the one kept, so neither is read.
        return session.change(MODULE_TOOLS.has(name) ? "module change" : "coding agent write", () =>
          callAgentTool(store, name, args, this.openModule(), caller),
        );
      },
    };
  }

  /** The module an outside agent works on: the one the page shows. */
  private openModule(): OpenModule {
    const { registry } = this.session.getSnapshot();
    if (registry == null || !registry.modulesEnabled) return {};
    const moduleName = activeModule(registry)?.name;
    if (moduleName == null) return {};
    const modules = visibleModules(registry);
    return {
      moduleName,
      ...(modules.length > 1
        ? {
            switchModule: (name: string) => {
              const target = visibleModuleNamed(registry, name);
              if (target == null) {
                const names = modules.map((entry) => `“${entry.name}”`).join(", ");
                throw new UserFacingError(`There is no module named “${name}”. The modules are ${names}.`);
              }
              if (!this.session.switchModule(target.id)) {
                throw new UserFacingError(`“${target.name}” could not be opened.`);
              }
              return target.name;
            },
          }
        : {}),
      addModule: (name) => this.session.addModule(name),
    };
  }

  /** The open project's shown store, opening the only project a single-project storage holds. */
  private async openStore(): Promise<Store> {
    await this.session.openOnlyProject();
    const snapshot = this.session.getSnapshot();
    switch (snapshot.status) {
      case "ready":
        return snapshot.store;
      case "failed":
        throw new UserFacingError(snapshot.persistenceError);
      case "loading":
        throw new UserFacingError("The project is still opening. Try again in a moment.");
      case "elsewhere":
        throw new UserFacingError("The project is open in another tab. Ask the person to take it over in Requireganizer.");
      case "idle":
        throw new UserFacingError(
          this.session.persistence.traits.singleProject
            ? `${this.session.persistence.traits.name} holds no project yet. Ask the person to create it in Requireganizer, then call get_workflow_state.`
            : "Ask the person to open a project in Requireganizer, then call get_workflow_state.",
        );
    }
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
    this.disposers.push(
      aiSettings().subscribe(() => this.hostInfoChanged()),
      this.session.subscribe(() => this.sessionChanged()),
    );
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
    send({
      type: "event",
      event: {
        type: "store-update",
        update: {
          patches: [],
          volatile: {},
        },
      },
    });
    return {
      receive: (message: ClientMessage) => this.receive(send, message, connection),
      close: () => {
        if (!this.links.delete(send)) return;
        this.shown?.store.releaseThreads(connection);
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
      const value = await this.dispatch(message, connection);
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

  private dispatch(message: RequestMessage, connection: string): unknown {
    if (!Object.hasOwn(this.api, message.name)) {
      throw new Error(`The project host has no request named ${String(message.name)}.`);
    }
    if (message.name === "callAgentTool") {
      const [name, args, caller] = message.args as Parameters<HostApi["callAgentTool"]>;
      return this.api.callAgentTool(name, args, { ...caller, connection });
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

  private hostInfoChanged(): void {
    const info = hostInfo(this.session.persistence.traits);
    if (sameHostInfo(info, this.sentHostInfo)) return;
    this.sentHostInfo = info;
    this.broadcast({ type: "host", info });
  }

  private sessionChanged(): void {
    const snapshot = this.session.getSnapshot();
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
    this.sentVolatile = replicatedVolatileState(store);

    const stopPatches = onPatch(store, (patch) => {
      this.pendingPatches.push(patch);
    });
    // Flushed when the change finishes.
    const stopSnapshots = onSnapshot(store, () => this.flushUpdate());
    const stopVolatile = reaction(
      () => replicatedVolatileState(store),
      () => this.flushUpdate(),
    );

    this.shown = {
      id: uuid(),
      store,
      stopObserving: () => {
        stopPatches();
        stopSnapshots();
        stopVolatile();
      },
    };
  }

  private storeImage(): StoreImage {
    const shown = this.shown!;
    return {
      id: shown.id,
      snapshot: getSnapshot(shown.store),
      volatile: replicatedVolatileState(shown.store),
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
    const current = replicatedVolatileState(shown.store);
    const volatile: Partial<Record<keyof ReplicatedVolatileState, unknown>> = {};
    let volatileChanged = false;
    for (const key of Object.keys(current) as (keyof ReplicatedVolatileState)[]) {
      const value = current[key];
      if (value === this.sentVolatile?.[key]) continue;
      volatileChanged = true;
      volatile[key] = value;
    }
    if (
      this.pendingPatches.length === 0 &&
      !volatileChanged
    ) {
      return;
    }
    this.sentVolatile = current;
    const patches = this.pendingPatches;
    this.pendingPatches = [];
    this.broadcast({
      type: "store-update",
      update: {
        patches,
        volatile: volatile as Partial<ReplicatedVolatileState>,
      },
    });
  }
}
