import type { IJsonPatch } from "mobx-state-tree";

import type { AgentsHostApi, AgentsHostEvent } from "agents";
import type { AssignTarget, ConfirmationNote, DelegationHostApi, DelegationHostEvent, WaitingThreadState } from "delegation";
import type { FocusPlace, ListedRestorePoint, ListedSteps, PreviewTarget, StateDifference, StepListTarget } from "history";
import type { ProjectIdentity } from "lib/projectStorage";
import type { ClientPersistence, StorageTraits } from "persistence";
import type { ProjectSessionSnapshot } from "project-session";
import type { ExportOptions, ModuleContent, ModuleRegistry, ModuleState, ProjectState } from "storage";
import type { SignatureFocusMove } from "workflow";

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
export const PROTOCOL_VERSION = 18;

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
  /** Where the action moves the spec owner's focus, for one that does, such as a signature. */
  focusMove?: SignatureFocusMove;
  /** What the spec owner confirmed to carry the action out, such as the threads whose agents it stops. */
  confirmed?: string[];
  /** For a message of the spec owner's in a thread: whom the thread is assigned to as it is sent. */
  assignTo?: AssignTarget;
}

/** What a store action returned, and where it moved the spec owner's focus, as the step records it. */
export interface StoreActionOutcome {
  result: unknown;
  focusMovedTo: FocusPlace | null;
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

/** What a host serves, the Agents and Delegation modules' parts included. A request names one member and passes its arguments. */
export interface HostApi extends AgentsHostApi, DelegationHostApi {
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
  /** Bring an archived module back into the list of modules. */
  bringBackModule(id: string): void;
  renameModule(id: string, name: string): void;
  renameProject(name: string): Promise<void>;
  /** Create an empty project; resolves to its identity. */
  createProject(name: string): Promise<ProjectIdentity>;
  /** Store the project an exported file's text holds as a new one, named after the file; resolves to its identity. */
  importNewProject(text: string, fileName: string): Promise<ProjectIdentity>;
  /** Open here the project another session holds, once it has written what it had. */
  takeOverProject(): Promise<void>;
  /** Replace the open project with the one an exported file's text holds, as a step of kind import; refused as undo is while it concerns threads agents have. */
  importProjectFile(text: string, fileName: string, confirmed?: string[]): Promise<void>;
  /** The export of the open project, or of one of its restore points, as the bytes of its file. */
  exportProject(options: ExportOptions, restorePointId?: string): Promise<string>;
  /** Open the project as storage now holds it, after it changed outside the host. */
  openChangedProject(confirmed?: string[]): Promise<void>;
  /** Write the shown project over the stored one that changed or was removed outside the host. */
  keepShownProject(): void;
  /** Leave the stored project removed outside the host: close it and forget its history, writing nothing where it was. */
  leaveProjectRemoved(): Promise<void>;
  /**
   * Undo the current step; not itself a step. Resolves to where the focus
   * goes, or null to leave it. Refused while it concerns threads agents
   * have that `confirmed` does not name; this holds for redo and goTo too.
   */
  undo(confirmed?: string[]): Promise<FocusPlace | null>;
  /** Redo the step undo last left; resolves as undo does. */
  redo(confirmed?: string[]): Promise<FocusPlace | null>;
  /** Every kept step, newest first, with what it added, changed or removed, then the start, before the oldest of them. */
  listSteps(): ListedSteps;
  /** Go to how the project was after a kept step or before the oldest of them, as undo and redo move, recording no step. */
  goTo(target: StepListTarget, confirmed?: string[]): Promise<void>;
  /** The kept restore points, newest first. */
  listRestorePoints(): ListedRestorePoint[];
  /** What bringing back the project as it was after a kept step or at a restore point would add, change or remove; changes nothing. */
  differenceFromNow(target: PreviewTarget): Promise<StateDifference>;
  /** The project as it was after a kept step or at a restore point, with how it differs from now; changes nothing. */
  preview(target: PreviewTarget): Promise<{ state: SentPreviewState; difference: StateDifference }>;
  /** Where the spec owner's focus is now. */
  reportFocus(place: FocusPlace | null): void;
  /** Take away an offer to go to what an agent pointed to, once dismissed. */
  dismissOffer(offerId: string): void;
  /** Make a restore point of the shown project under a name. */
  makeRestorePoint(name: string): void;
  /** Restore the project to a restore point, as a step of kind restore. */
  restoreToRestorePoint(restorePointId: string, confirmed?: string[]): Promise<void>;
  pinRestorePoint(restorePointId: string): void;
  unpinRestorePoint(restorePointId: string): void;
  deleteRestorePoint(restorePointId: string): void;
  /** The page's IANA time zone, whose calendar the keeping rule of restore points reads. */
  reportTimeZone(timeZone: string): void;
  /** Remove a project that is not open; refused while another tab holds it. */
  deleteProject(projectId: string): Promise<void>;
  runStoreAction(call: StoreActionCall): StoreActionOutcome;
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
  /** For an action refused until the spec owner confirms what it concerns: what that is. */
  confirmation?: { threads: readonly WaitingThreadState[]; notes: readonly ConfirmationNote[] };
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
 * A store the host started showing: its snapshot, with an id no other image
 * of any host shares, so forwarded actions name the store they meant even
 * across a host restart.
 */
export interface StoreImage {
  id: string;
  snapshot: unknown;
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

/**
 * An earlier state as sent. A module's content is left out when it is the
 * content the client holds of that module now, the host's changes before the
 * answer included.
 */
export interface SentPreviewState extends Omit<ProjectState, "modules"> {
  modules: SentModuleEntry[];
}

/** What clients know about the host itself rather than the project it shows. */
export interface HostInfo {
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
  | { type: "store-update"; update: StoreUpdate }
  | AgentsHostEvent
  | DelegationHostEvent;

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
