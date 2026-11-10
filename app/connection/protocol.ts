import type { IJsonPatch } from "mobx-state-tree";

import type { AgentCaller, AgentToolDescription } from "ai-agent/agent-access";
import type { ProjectIdentity } from "lib/projectStorage";
import type { ClientPersistence, StorageTraits } from "persistence";
import type { ProjectSessionSnapshot } from "project-session";
import type {
  ExportOptions,
  ListedRestorePoint,
  ListedStep,
  ModuleContent,
  ModuleRegistry,
  ModuleState,
} from "storage-and-recovery";
import type { ReplicatedVolatileState } from "store";

/**
 * The messages between a project host (the authority) and its clients
 * (replicas). Every message is plain JSON: the in-process link round-trips
 * each one through JSON so that nothing works here that a socket would break.
 */

/**
 * The version of these messages. A link between processes that may run
 * different builds checks it before any message is exchanged; change it
 * whenever a message changes shape.
 */
export const PROTOCOL_VERSION = 11;

/**
 * WebSocket close codes a host server ends a connection with when connecting
 * again cannot help. Any other close is a lost connection, worth retrying.
 */
export const LINK_CLOSE_CODES = {
  /** The page and the server speak different protocol versions. */
  outdated: 4001,
  /** The server does not accept this page, such as after a token change. */
  refused: 4003,
} as const;

/** The path a host server accepts WebSocket connections on. */
export const LINK_PATH = "/connect";

/**
 * One step from a store node to a child: a property name or array index,
 * or the identifier of an array item that has one, so the address keeps
 * naming the same item while other items are inserted or removed.
 */
export type AddressStep = string | { id: string };

/**
 * A root store action a replica forwards, addressed by the store image it
 * was called on and its node's address. The host refuses it once it shows
 * another store, so an action never lands on a module it was not meant for.
 */
export interface StoreActionCall {
  store: string;
  address: AddressStep[];
  name: string;
  args: unknown[];
}

/** The groups of storage operations a client may call. */
export type PersistenceGroup = Exclude<keyof ClientPersistence, "traits">;

/** One call on the host's persistence adapter. */
export interface PersistenceCall {
  group: PersistenceGroup;
  method: string;
  args: unknown[];
}

/**
 * Every adapter method a client may call, per group. Typed so that it lists
 * exactly what `ClientPersistence` offers, and the host refuses anything
 * that is not listed. Nothing a client calls writes a project: the host
 * does, through its session.
 */
export const PERSISTENCE_METHODS: {
  [Group in PersistenceGroup]: Record<keyof ClientPersistence[Group], true>;
} = {
  projects: { list: true },
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
  renameModule(id: string, name: string): void;
  renameProject(name: string): Promise<void>;
  /** Create an empty project; resolves to its identity. */
  createProject(name: string): Promise<ProjectIdentity>;
  /** Store the project an exported file's text holds as a new one, named after the file; resolves to its identity. */
  importNewProject(text: string, fileName: string): Promise<ProjectIdentity>;
  /** Open here the project another session holds, once it has written what it had. */
  takeOverProject(): Promise<void>;
  /** Replace the open project with the one an exported file's text holds, as a step of kind import. */
  importProjectFile(text: string, fileName: string): void;
  /** The export of the open project, or of one of its restore points, as the bytes of its file. */
  exportProject(options: ExportOptions, restorePointId?: string): Promise<string>;
  /** Open the project as storage now holds it, after it changed outside the host. */
  openChangedProject(): Promise<void>;
  /** Write the shown project over the stored one that changed or was removed outside the host. */
  keepShownProject(): void;
  /** Leave the stored project removed outside the host: close it and forget its history, writing nothing where it was. */
  leaveProjectRemoved(): Promise<void>;
  /** Undo the current step; not itself a step. */
  undo(): void;
  /** Redo the step undo last left. */
  redo(): void;
  /** Every kept step, newest first. */
  listSteps(): ListedStep[];
  /** Bring the project back as it was after a kept step, as a step of kind restore. */
  bringBackStep(stepId: string): void;
  /** The kept restore points, newest first. */
  listRestorePoints(): ListedRestorePoint[];
  /** Make a restore point of the shown project under a name. */
  makeRestorePoint(name: string): void;
  /** Restore the project to a restore point, as a step of kind restore. */
  restoreToRestorePoint(restorePointId: string): Promise<void>;
  pinRestorePoint(restorePointId: string): void;
  unpinRestorePoint(restorePointId: string): void;
  deleteRestorePoint(restorePointId: string): void;
  /** The page's IANA time zone, whose calendar the keeping rule of restore points reads. */
  reportTimeZone(timeZone: string): void;
  /** Remove a project that is not open; refused while another tab holds it. */
  deleteProject(projectId: string): Promise<void>;
  runStoreAction(call: StoreActionCall): unknown;
  runPersistence(call: PersistenceCall): unknown;
  /** The tools an outside agent can call on the open project now. */
  listAgentTools(): Promise<AgentToolDescription[]>;
  /** Run one of those tools for the named agent; resolves to its text result. */
  callAgentTool(name: string, args: Record<string, unknown>, caller: AgentCaller): Promise<string>;
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
 * values, with an id no other image of any host shares, so forwarded actions
 * name the store they meant even across a host restart.
 */
export interface StoreImage {
  id: string;
  snapshot: unknown;
  volatile: ReplicatedVolatileState;
}

/**
 * A module as sent. Its content is left out when every client already holds
 * that exact content from an earlier event.
 */
export type SentModuleEntry = Omit<ModuleState, "content"> & {
  content?: ModuleContent;
};

export interface SentRegistry extends Omit<ModuleRegistry, "modules"> {
  modules: SentModuleEntry[];
}

/** What clients know about the host itself rather than the project it shows. */
export interface HostInfo {
  /** The reviewer model the host's AI uses; null when auto review is unavailable. */
  reviewerModel: string | null;
  /** How to configure a reviewer model where the host runs. */
  missingReviewerModelMessage: string;
  /** The storage behind the host. */
  storage: StorageTraits;
}

/**
 * What the shown store and its timeline went through since the previous
 * update, sent as one message so a client applies a host change whole.
 * `turn` is how the timeline turn open when the change was flushed is
 * presented, and `focus` the change focus the timeline emitted with it;
 * presenters read both the way they read the timeline next to a local store.
 */
export interface StoreUpdate {
  patches: IJsonPatch[];
  /** Replicated volatile values that changed, whole. */
  volatile: Partial<ReplicatedVolatileState>;
}

export type HostEvent =
  | { type: "host"; info: HostInfo }
  | {
      type: "session";
      session: SessionView;
      /** Present when the registry changed. */
      registry?: SentRegistry | null;
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

/** Why a link ended without the client closing it. */
export interface LinkClosed {
  /** False when connecting again cannot help, such as for an outdated page. */
  retry: boolean;
  /** What happened and what to do, for the person using the page. */
  message: string;
}

export interface ClientConnectionListener {
  message(message: HostMessage): void;
  /** Called at most once; no message follows it. */
  closed(reason: LinkClosed): void;
}

/**
 * The client end of a link to a host. Messages arrive in the order the host
 * sent them; a response follows every event the host sent before it.
 */
export interface ClientConnection {
  send(message: ClientMessage): void;
  subscribe(listener: ClientConnectionListener): () => void;
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
