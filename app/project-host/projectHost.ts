import { reaction } from "mobx";
import {
  getMembers,
  getSnapshot,
  type IJsonPatch,
  onPatch,
  onSnapshot,
} from "mobx-state-tree";

import { setAgentSessionId } from "ai-agent/agent";
import { agentToolDescriptions, callAgentTool } from "ai-agent/agent-access";
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
  type StoreEvent,
  type StoreImage,
  type VolatileTextKey,
  type WireError,
} from "connection";
import { UserFacingError } from "lib/errors";
import type { ModuleRegistry } from "lib/moduleSchema";
import type { StorageTraits } from "persistence";
import type { ProjectSession, ProjectSessionSnapshot } from "project-session";
import {
  replicatedVolatileState,
  type ReplicatedVolatileState,
  type Store,
} from "store";
import type { WorkflowStage } from "store/constants";
import {
  activateBranch,
  beginRewind,
  cancelRewind,
  type ChangeFocus,
  getCurrentStepKind,
  getTimelineMeta,
  getTimelineSnapshot,
  jumpToNode,
  onChangeFocus,
  onTimelineChange,
  redo,
  undo,
} from "store/timeline/controller";
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

function snapshotsOf(registry: ModuleRegistry | null): Map<string, Record<string, unknown>> {
  return new Map((registry?.modules ?? []).map((entry) => [entry.id, entry.snapshot]));
}

function sessionView(snapshot: ProjectSessionSnapshot) {
  const { store: _store, registry: _registry, ...view } = snapshot;
  return view;
}

/**
 * The project authority: it owns the session, the only writable store, its
 * timeline, and the AI flows that run on it. Clients see the session and the
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
  /** The module snapshots every client holds, by module id. */
  private sentSnapshots = new Map<string, Record<string, unknown>>();
  private sentVolatile: ReplicatedVolatileState | null = null;
  private pendingPatches: IJsonPatch[] = [];
  private pendingEvents: StoreEvent[] = [];
  private timelineChanged = false;
  private flushScheduled = false;
  private agentProjectId: string | null = null;

  constructor(session: ProjectSession) {
    this.session = session;
    this.sentHostInfo = hostInfo(session.persistence.traits);
    this.api = {
      selectProject: (id, name, options) =>
        session.selectProject(id, name, options),
      backToProjects: () => session.backToProjects(),
      clearPersistenceError: () => session.clearPersistenceError(),
      enableModules: (name) => session.enableModules(name),
      addModule: (name) => session.addModule(name),
      switchModule: (id) => session.switchModule(id),
      archiveModule: (id) => session.archiveModule(id),
      recordOpenStep: (step) => session.recordOpenStep(step),
      importProjectFile: (data) => session.importProjectFile(data),
      openChangedProject: () => session.openChangedProject(),
      keepShownProject: () => session.keepShownProject(),
      runStoreAction: (call) => this.runStoreAction(call),
      undo,
      redo,
      beginRewind,
      cancelRewind,
      jumpToNode,
      activateBranch,
      exportTimeline: getTimelineSnapshot,
      runPersistence: (call) => this.runPersistence(call),
      listAgentTools: async () => agentToolDescriptions(await this.openStore()),
      callAgentTool: async (name, args) => {
        const store = await this.openStore();
        // Whatever the call changed would be replaced with the imported project.
        if (session.importing) {
          throw new UserFacingError(
            "A project import is replacing this project in Requireganizer. Call get_workflow_state once it finishes.",
          );
        }
        // Either version may be the one kept, so neither is read or changed meanwhile.
        if (session.getSnapshot().outsideChange != null) {
          throw new UserFacingError(
            `${session.persistence.traits.name} changed outside Requireganizer. Ask the person to choose in Requireganizer which version to keep, then call get_workflow_state.`,
          );
        }
        return callAgentTool(store, name, args);
      },
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
      case "idle":
        throw new UserFacingError(
          this.session.persistence.traits.singleProject
            ? `${this.session.persistence.traits.name} holds no project yet. Create it in Requireganizer first.`
            : "Open a project in Requireganizer first.",
        );
    }
  }

  /**
   * Observe the session, the shown store, and the timeline. Only while a
   * client is connected: a host nobody connected to holds no subscriptions.
   */
  private startObserving(): void {
    const initial = this.session.getSnapshot();
    this.sentHostInfo = hostInfo(this.session.persistence.traits);
    this.sentRegistry = initial.registry;
    this.sentSnapshots = snapshotsOf(initial.registry);
    this.showStore(initial.store);
    this.disposers.push(
      aiSettings().subscribe(() => this.hostInfoChanged()),
      this.session.subscribe(() => this.sessionChanged()),
      onTimelineChange(() => {
        // Sent with the change that moved the timeline, or on its own.
        this.timelineChanged = true;
        this.scheduleFlush();
      }),
      onChangeFocus((focus) => this.flushUpdate(focus)),
    );
    this.followAgentSession(initial.activeProject?.id ?? null);
    if (initial.status === "ready") queueMicrotask(() => this.draftPendingOverview());
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
    const snapshot = this.session.getSnapshot();
    send({ type: "event", event: { type: "host", info: this.sentHostInfo } });
    send({
      type: "event",
      event: {
        type: "session",
        session: sessionView(snapshot),
        // A new client holds nothing yet, so it gets every snapshot.
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
          appended: {},
          stepKind: null,
          focus: null,
          timeline: getTimelineMeta(),
          events: [],
        },
      },
    });
    return {
      receive: (message: ClientMessage) => this.receive(send, message),
      close: () => {
        if (!this.links.delete(send)) return;
        if (this.links.size === 0) this.stopObserving();
      },
    };
  }

  private broadcast(event: HostEvent): void {
    for (const send of this.links) send({ type: "event", event });
  }

  private receive(send: (message: HostMessage) => void, message: ClientMessage): void {
    if (message.type !== "request") return;
    void this.respond(send, message);
  }

  private async respond(
    send: (message: HostMessage) => void,
    message: RequestMessage,
  ): Promise<void> {
    let response: ResponseMessage;
    try {
      const value = await this.dispatch(message);
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

  private dispatch(message: RequestMessage): unknown {
    if (!Object.hasOwn(this.api, message.name)) {
      throw new Error(`The project host has no request named ${String(message.name)}.`);
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
    this.followAgentSession(snapshot.activeProject?.id ?? null);
    if (snapshot.status === "ready") {
      queueMicrotask(() => this.draftPendingOverview());
    }
  }

  /** The registry with every snapshot left out that all clients already hold. */
  private registryToSend(registry: ModuleRegistry | null): SentRegistry | null {
    const held = this.sentSnapshots;
    this.sentSnapshots = snapshotsOf(registry);
    if (registry == null) return null;
    return {
      ...registry,
      modules: registry.modules.map((entry) => {
        if (held.get(entry.id) !== entry.snapshot) return entry;
        const { snapshot: _held, ...rest } = entry;
        return rest;
      }),
    };
  }

  // A stable per-project session id gives the provider's prompt cache a
  // consistent affinity key for every LLM request of this project.
  private followAgentSession(projectId: string | null): void {
    if (projectId === this.agentProjectId) return;
    this.agentProjectId = projectId;
    setAgentSessionId(projectId);
  }

  /** A project created with a starting intent drafts its overview once it opens. */
  private draftPendingOverview(): void {
    const snapshot = this.session.getSnapshot();
    if (snapshot.status !== "ready") return;
    const seed = this.session.consumeOverviewSeed(snapshot.activeProject.id);
    if (seed != null) void snapshot.store.generateProductOverview(seed);
  }

  /** Observe another store; what the previous one still had pending goes with it. */
  private showStore(store: Store): void {
    this.shown?.stopObserving();
    this.pendingPatches = [];
    this.pendingEvents = [];
    this.sentVolatile = replicatedVolatileState(store);

    const stopPatches = onPatch(store, (patch) => {
      this.pendingPatches.push(patch);
    });
    // Flushed when the change finishes, while the timeline still reports the
    // turn it belongs to.
    const stopSnapshots = onSnapshot(store, () => this.flushUpdate());
    const stopVolatile = reaction(
      () => replicatedVolatileState(store),
      () => this.flushUpdate(),
    );
    const onStepUpdate = (step: WorkflowStage) => {
      this.pendingEvents.push({ name: "stepUpdate", step });
      this.scheduleFlush();
    };
    store.eventTarget.on("stepUpdate", onStepUpdate);

    this.shown = {
      id: uuid(),
      store,
      stopObserving: () => {
        stopPatches();
        stopSnapshots();
        stopVolatile();
        store.eventTarget.off("stepUpdate", onStepUpdate);
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
   * Send what the shown store and the timeline went through since the last
   * update, together with the change focus being emitted, if any.
   */
  private flushUpdate(focus: ChangeFocus | null = null): void {
    const shown = this.shown;
    if (shown == null) return;
    const current = replicatedVolatileState(shown.store);
    const volatile: Partial<Record<keyof ReplicatedVolatileState, unknown>> = {};
    const appended: Partial<Record<VolatileTextKey, string>> = {};
    let volatileChanged = false;
    for (const key of Object.keys(current) as (keyof ReplicatedVolatileState)[]) {
      const value = current[key];
      const sent = this.sentVolatile?.[key];
      if (value === sent) continue;
      volatileChanged = true;
      // Streamed text grows at its end; only the new part is sent.
      if (typeof value === "string" && typeof sent === "string" && sent.length > 0 && value.startsWith(sent)) {
        appended[key as VolatileTextKey] = value.slice(sent.length);
      } else {
        volatile[key] = value;
      }
    }
    if (
      this.pendingPatches.length === 0 &&
      this.pendingEvents.length === 0 &&
      !volatileChanged &&
      !this.timelineChanged &&
      focus == null
    ) {
      return;
    }
    this.sentVolatile = current;
    const patches = this.pendingPatches;
    const events = this.pendingEvents;
    const timeline = this.timelineChanged ? getTimelineMeta() : null;
    this.pendingPatches = [];
    this.pendingEvents = [];
    this.timelineChanged = false;
    this.broadcast({
      type: "store-update",
      update: {
        patches,
        volatile: volatile as Partial<ReplicatedVolatileState>,
        appended,
        stepKind: getCurrentStepKind(),
        focus,
        timeline,
        events,
      },
    });
  }
}
