import type { IJsonPatch } from "mobx-state-tree";

import type { ModuleRegistry } from "lib/moduleSchema";
import type { PersistenceAdapter } from "persistence";
import type { ProjectSessionSnapshot } from "project-session";
import type { ReplicatedVolatileState } from "store";
import type { WorkflowStage } from "store/constants";
import type {
  ChangeFocus,
  StepKind,
  TimelineMeta,
} from "store/timeline/controller";
import type { PersistedTimeline } from "store/timeline/serialize";

/**
 * The messages between a project host (the authority) and its clients
 * (replicas). Every message is plain JSON: the in-process link round-trips
 * each one through JSON so that nothing works here that a socket would break.
 */

/**
 * A root store action a replica forwards, addressed by the store image it
 * was called on and its node's path. The host refuses it once it shows
 * another store, so an action never lands on a module it was not meant for.
 */
export interface StoreActionCall {
  store: number;
  path: string;
  name: string;
  args: unknown[];
}

/** One call on the host's persistence adapter. */
export interface PersistenceCall {
  group: keyof PersistenceAdapter;
  method: string;
  args: unknown[];
}

/**
 * Every adapter method a client may call, per group. Typed so that a method
 * added to the adapter must be listed here, and the host refuses anything
 * that is not.
 */
export const PERSISTENCE_METHODS: {
  [Group in keyof PersistenceAdapter]: Record<keyof PersistenceAdapter[Group], true>;
} = {
  projects: {
    list: true,
    saveIndex: true,
    load: true,
    save: true,
    saveBundle: true,
    delete: true,
  },
  timelines: { load: true, save: true },
  revisions: { list: true, save: true, setPinned: true, delete: true },
  providerCalls: { load: true, replace: true },
};

/** What a host serves. A request names one member and passes its arguments. */
export interface HostApi {
  selectProject(
    id: string,
    name: string,
    options?: { overviewSeed?: string },
  ): Promise<void>;
  backToProjects(): void;
  clearPersistenceError(): void;
  enableModules(name: string): void;
  addModule(name: string): void;
  /** False when the id names no openable module. */
  switchModule(id: string): boolean;
  archiveModule(id: string): void;
  recordOpenStep(step: WorkflowStage): void;
  importProjectFile(data: unknown): Promise<void>;
  runStoreAction(call: StoreActionCall): unknown;
  undo(): void;
  redo(): void;
  /** False when the message is not bound to a timeline turn. */
  beginRewind(messageIndex: number): boolean;
  cancelRewind(): void;
  jumpToNode(nodeId: string): void;
  activateBranch(leafId: string): void;
  exportTimeline(): PersistedTimeline | null;
  runPersistence(call: PersistenceCall): unknown;
}

export type RequestName = keyof HostApi;

export interface RequestMessage {
  type: "request";
  id: number;
  name: RequestName;
  args: unknown[];
}

/** A failure as it crosses the link; the name keeps user-facing errors recognizable. */
export interface WireError {
  name: string;
  message: string;
}

export type ResponseMessage = { type: "response"; id: number } & (
  | { ok: true; value: unknown }
  | { ok: false; error: WireError }
);

type WithoutStoreAndRegistry<Snapshot> = Snapshot extends unknown
  ? Omit<Snapshot, "store" | "registry">
  : never;

/** The session as a client sees it; the registry and store travel separately. */
export type SessionView = WithoutStoreAndRegistry<ProjectSessionSnapshot>;

/**
 * A store the host started showing: its snapshot and replicated volatile
 * values, numbered so forwarded actions can name the store they meant.
 */
export interface StoreImage {
  id: number;
  snapshot: unknown;
  volatile: ReplicatedVolatileState;
}

export type StoreEvent = { name: "stepUpdate"; step: WorkflowStage };

/**
 * What the shown store and its timeline went through since the previous
 * update, sent as one message so a client applies a host change whole.
 * `stepKind` is the kind of timeline turn open when the change was flushed,
 * and `focus` the change focus the timeline emitted with it; presenters read
 * both the way they read the timeline next to a local store.
 */
export interface StoreUpdate {
  patches: IJsonPatch[];
  volatile: Partial<ReplicatedVolatileState>;
  stepKind: StepKind | null;
  focus: ChangeFocus | null;
  /** The timeline's history when it changed; null when unchanged. */
  timeline: TimelineMeta | null;
  /** Store events emitted during the change; replayed after its patches. */
  events: StoreEvent[];
}

export type HostEvent =
  | {
      type: "session";
      session: SessionView;
      /** Present when the registry changed. */
      registry?: ModuleRegistry | null;
      /** Present when the host shows another store. */
      store?: StoreImage;
    }
  | { type: "store-update"; update: StoreUpdate };

export interface EventMessage {
  type: "event";
  event: HostEvent;
}

export type ClientMessage = RequestMessage;
export type HostMessage = ResponseMessage | EventMessage;

/**
 * The client end of a link to a host. Messages arrive in the order the host
 * sent them; a response follows every event the host sent before it.
 */
export interface ClientConnection {
  send(message: ClientMessage): void;
  subscribe(listener: (message: HostMessage) => void): () => void;
  close(): void;
}

/** The host end of one client's link. */
export interface HostLink {
  receive(message: ClientMessage): void;
  close(): void;
}

/** A host that clients connect to; each connection gets its own link. */
export interface HostEndpoint {
  connect(send: (message: HostMessage) => void): HostLink;
}
