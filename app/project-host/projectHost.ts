import { reaction } from "mobx";
import {
  getMembers,
  getSnapshot,
  type IJsonPatch,
  isStateTreeNode,
  onPatch,
  onSnapshot,
  tryResolve,
} from "mobx-state-tree";

import { setAgentSessionId } from "ai-agent/agent";
import {
  type ClientMessage,
  type HostApi,
  type HostEndpoint,
  type HostEvent,
  type HostLink,
  type HostMessage,
  PERSISTENCE_METHODS,
  type PersistenceCall,
  type RequestMessage,
  type ResponseMessage,
  type StoreActionCall,
  type StoreEvent,
  type StoreImage,
  type WireError,
} from "connection";
import type { ModuleRegistry } from "lib/moduleSchema";
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

function wireError(error: unknown): WireError {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
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

  private shown: { id: number; store: Store; stopObserving: () => void } | null =
    null;
  private nextStoreId = 0;
  private sentRegistry: ModuleRegistry | null = null;
  private sentVolatile: ReplicatedVolatileState | null = null;
  private pendingPatches: IJsonPatch[] = [];
  private pendingEvents: StoreEvent[] = [];
  private timelineChanged = false;
  private flushScheduled = false;
  private agentProjectId: string | null = null;

  constructor(session: ProjectSession) {
    this.session = session;
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
      runStoreAction: (call) => this.runStoreAction(call),
      undo,
      redo,
      beginRewind,
      cancelRewind,
      jumpToNode,
      activateBranch,
      exportTimeline: getTimelineSnapshot,
      runPersistence: (call) => this.runPersistence(call),
    };

  }

  /**
   * Observe the session, the shown store, and the timeline. Only while a
   * client is connected: a host nobody connected to holds no subscriptions.
   */
  private startObserving(): void {
    const initial = this.session.getSnapshot();
    this.sentRegistry = initial.registry;
    this.showStore(initial.store);
    this.disposers.push(
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
    send({
      type: "event",
      event: {
        type: "session",
        session: sessionView(snapshot),
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
    const target: unknown = tryResolve(shown.store, call.path);
    if (target == null || !isStateTreeNode(target)) {
      throw new Error(`No store node is at ${call.path === "" ? "the root" : call.path}.`);
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

  private sessionChanged(): void {
    const snapshot = this.session.getSnapshot();
    const event: Extract<HostEvent, { type: "session" }> = {
      type: "session",
      session: sessionView(snapshot),
    };
    if (snapshot.registry !== this.sentRegistry) {
      this.sentRegistry = snapshot.registry;
      event.registry = snapshot.registry;
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

    this.nextStoreId += 1;
    this.shown = {
      id: this.nextStoreId,
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
    let volatileChanged = false;
    for (const key of Object.keys(current) as (keyof ReplicatedVolatileState)[]) {
      if (current[key] !== this.sentVolatile?.[key]) {
        volatile[key] = current[key];
        volatileChanged = true;
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
        stepKind: getCurrentStepKind(),
        focus,
        timeline,
        events,
      },
    });
  }
}
