import { applySnapshot, getSnapshot, onSnapshot } from "mobx-state-tree";

import {
  type ChangeKind,
  EMPTY_HISTORY,
  type FocusPlace,
  HistoryKeeper,
  isFocusPlace,
  type HistoryMove,
  type HistoryPosition,
  isTimeZone,
  type ListedRestorePoint,
  type ListedSteps,
  type LiveStoreOf,
  type ModelNowOf,
  parseHistory,
  type PreviewTarget,
  type ProjectHistory,
  type StateDifference,
  type StepListTarget,
} from "history";
import { getUserFacingErrorMessage, UserFacingError } from "lib/errors";
import { InvalidJsonError, parseJson } from "lib/json";
import {
  assertModuleNameAvailable,
  LEGACY_MODULE_ID,
  normalizeModuleName,
  visibleModules,
} from "lib/moduleSchema";
import { hasProjectName, type ProjectIdentity } from "lib/projectStorage";
import type { OutsideChanges, PersistenceAdapter } from "persistence";
import {
  type Address,
  addressOfBytes,
  type AuthorityClaim,
  type ProjectAuthority,
  buildExport,
  childrenOf,
  type ExportOptions,
  moduleContentOf,
  type ModuleRegistry,
  type ModuleState,
  type Opening,
  openingOf,
  type OutsideChange,
  parseProject,
  type PieceLevel,
  PieceStore,
  type ProjectRecord,
  projectState,
  type ProjectState,
  sharedWith,
  type StoredProject,
  storedProjectChange,
} from "storage";
import { createModuleStore, SiblingModuleStores, Store } from "store";
import { uuid } from "utilities";


/** Streaming mutates the store every ~80ms; coalesce writes behind this delay. */
export const PROJECT_SAVE_DEBOUNCE_MS = 800;

/**
 * An item, coverage or impact the coding agent named for the spec owner's
 * attention, with the text it gave, offered until the spec owner takes or
 * dismisses it.
 */
export interface AttentionOffer {
  id: string;
  place: FocusPlace & { unitId: string };
  text: string;
  /** The name the coding agent gave. */
  from: string;
}

/** One visible module as the interface sees it. */
export interface ModuleSummary {
  id: string;
  name: string;
  active: boolean;
}

export type ProjectSessionStatus = "idle" | "loading" | "failed" | "elsewhere" | "ready";

/**
 * The session's observable state. The status and the fields it allows move
 * together: an idle session has no project, a loading session has a named
 * project but no registry yet, a failed session names the project it could
 * not load and why, a session whose project another tab holds names it, and
 * a ready session has both a registry and a store to render, and where the
 * project is in its history. A ready project whose stored project changed
 * outside the session names that change until the spec owner chooses which
 * of the two to keep.
 */
export type ProjectSessionSnapshot =
  | {
      status: "idle";
      activeProject: null;
      persistenceError: null;
      outsideChange: null;
      registry: null;
      store: Store;
    }
  | {
      status: "loading" | "elsewhere";
      activeProject: ProjectIdentity;
      persistenceError: null;
      outsideChange: null;
      registry: null;
      store: Store;
    }
  | {
      status: "failed";
      activeProject: ProjectIdentity;
      persistenceError: string;
      outsideChange: null;
      registry: null;
      store: Store;
    }
  | {
      status: "ready";
      activeProject: ProjectIdentity;
      persistenceError: string | null;
      outsideChange: OutsideChange | null;
      history: HistoryPosition;
      /** Oldest first. */
      offers: AttentionOffer[];
      registry: ModuleRegistry;
      store: Store;
    };

/** The stored project as the session reads it: a readable one comes with its state. */
type ReadStoredProject =
  | Exclude<StoredProject, { kind: "readable" }>
  | { kind: "readable"; address: Address; state: ProjectState };

/** The store of work not started yet. */
function blankStore(): Store {
  return Store.create({});
}

/** A project nobody has worked on yet: one hidden module, empty. */
function blankProjectState(): ProjectState {
  return {
    modulesEnabled: false,
    modules: [{ id: LEGACY_MODULE_ID, name: LEGACY_MODULE_ID, archivedAt: null, content: moduleContentOf(blankStore()) }],
  };
}

interface PendingOverviewSeed {
  projectId: string;
  seed: string;
}

/** What failed: a project write. */
type PersistenceNoticeSource = "write";

/**
 * Messages for the persistence banner, at most one per source. A success
 * clears only its own source's message, so one failure never hides another.
 */
type PersistenceNotices = Partial<Record<PersistenceNoticeSource, string>>;

/** The order the banner shows its messages in: unsaved work first. */
const NOTICE_ORDER: readonly PersistenceNoticeSource[] = ["write"];

function shownNotice(notices: PersistenceNotices): string | null {
  const messages = NOTICE_ORDER.flatMap((source) => notices[source] ?? []);
  return messages.length === 0 ? null : messages.join(" ");
}

type IdleSessionState = {
  status: "idle";
  store: Store;
};

type LoadingProjectSessionState = {
  status: "loading-project";
  project: ProjectIdentity;
  store: Store;
};

/** The project's load failed; it stays named so the page can offer a retry. */
type FailedProjectSessionState = {
  status: "load-failed";
  project: ProjectIdentity;
  message: string;
  store: Store;
};

/** Another session, such as another browser tab, is the project's authority; this one offers to take it over. */
type HeldElsewhereSessionState = {
  status: "held-elsewhere";
  project: ProjectIdentity;
  store: Store;
};

type ReadySessionState = {
  status: "ready";
  project: ProjectIdentity;
  registry: ModuleRegistry;
  store: Store;
  persistenceNotices: PersistenceNotices;
};

type SessionState =
  | IdleSessionState
  | LoadingProjectSessionState
  | FailedProjectSessionState
  | HeldElsewhereSessionState
  | ReadySessionState;

function projectSaveErrorMessage(storage: string): string {
  return `Changes could not be saved in ${storage}. Export the project to avoid losing work.`;
}
const PROJECT_LOAD_ERROR_MESSAGE = "The project could not be loaded.";

/**
 * The project an exported file holds, read by the one project parser and
 * nothing else. Throws what is wrong with the file and where, so that an
 * import of it changes nothing.
 */
function importedProject(text: string, fileName: string): ProjectState {
  try {
    return parseProject(parseJson(text, "The file"));
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    throw new UserFacingError(
      `${fileName} was not imported, and nothing changed. ${problem} Import a file this version of Requireganizer exported.`,
      error,
    );
  }
}

function snapshotOf(
  state: SessionState,
  outsideChange: OutsideChange | null,
  history: HistoryPosition,
  offers: AttentionOffer[],
): ProjectSessionSnapshot {
  switch (state.status) {
    case "idle":
      return {
        status: "idle",
        activeProject: null,
        persistenceError: null,
        outsideChange: null,
        registry: null,
        store: state.store,
      };
    case "loading-project":
    case "held-elsewhere":
      return {
        status: state.status === "loading-project" ? "loading" : "elsewhere",
        activeProject: state.project,
        persistenceError: null,
        outsideChange: null,
        registry: null,
        store: state.store,
      };
    case "load-failed":
      return {
        status: "failed",
        activeProject: state.project,
        persistenceError: state.message,
        outsideChange: null,
        registry: null,
        store: state.store,
      };
    case "ready":
      return {
        status: "ready",
        activeProject: state.project,
        persistenceError: shownNotice(state.persistenceNotices),
        outsideChange,
        history,
        offers,
        registry: state.registry,
        store: state.store,
      };
  }
}

/**
 * What the last write issued held, so an unchanged project is not written
 * again. Every change to the history replaces one of its fields, so they say
 * whether it changed.
 */
interface IssuedWrite {
  address: Address;
  history: ProjectHistory;
  offers: readonly AttentionOffer[];
  name: string;
}

function issuedWriteOf(address: Address, history: ProjectHistory, offers: readonly AttentionOffer[], project: ProjectIdentity): IssuedWrite {
  return { address, history, offers, name: project.name };
}

function sameIssuedWrite(left: IssuedWrite | null, right: IssuedWrite): boolean {
  if (left == null || left.address !== right.address || left.name !== right.name || left.offers !== right.offers) return false;
  return (Object.keys(right.history) as (keyof ProjectHistory)[]).every((key) => left.history[key] === right.history[key]);
}

/** Which state storage last held for certain, and the one being written while a write is under way. */
interface WrittenStates {
  lastWritten: Address | null;
  writing: Address | null;
}

const NOTHING_WRITTEN: WrittenStates = { lastWritten: null, writing: null };

/** The project's history as its record keeps it; null, so the history starts again, when there is none or it cannot be read. */
function historyOf(record: ProjectRecord | null): ProjectHistory | null {
  if (record?.history == null) return null;
  try {
    return parseHistory(record.history);
  } catch (error) {
    console.error("The project's history could not be read; it starts again.", error);
    return null;
  }
}

function isAttentionOffer(value: unknown): value is AttentionOffer {
  if (value == null || typeof value !== "object") return false;
  const { id, place, text, from } = value as Record<string, unknown>;
  return typeof id === "string" && isFocusPlace(place) && place.unitId != null && typeof text === "string" && typeof from === "string";
}

/** The offers the record keeps, oldest first; none when it keeps none or they cannot be read. */
function offersOf(record: ProjectRecord | null): AttentionOffer[] {
  const offers = record?.offers;
  if (offers == null) return [];
  if (Array.isArray(offers) && offers.every(isAttentionOffer)) return offers;
  console.error("The offers of what the coding agent named could not be read; they are dropped.");
  return [];
}

/** What the coding agent named for the spec owner's attention within the change running. */
interface Pointed {
  place: FocusPlace & { unitId: string };
  text: string;
  from: string;
}

/** The pieces storage keeps for restore points, and the restore points' states they were found from. */
interface RestorePointPieces {
  states: ReadonlySet<Address>;
  pieces: ReadonlySet<Address>;
}

/**
 * A project's authority-side session: the live store, the module registry,
 * the history of changes and the pieces of its states, and the pending
 * project write. Framework-free so a later phase can host the same
 * orchestration in a local Node process or a Durable Object. Subscribers
 * observe changes to the session (store, registry, project, persistence
 * error), not every store mutation.
 */
export class ProjectSession {
  readonly persistence: PersistenceAdapter;
  private readonly listeners = new Set<() => void>();
  private readonly siblingStores = new SiblingModuleStores();

  private state: SessionState;
  private snapshot: ProjectSessionSnapshot;
  private pendingOverviewSeed: PendingOverviewSeed | null = null;
  /** The project load in flight, which a repeated selection of it waits for. */
  private projectLoad: Promise<void> = Promise.resolve();

  /**
   * Every operation that replaces what an async load or write would land on
   * starts a new generation: opening or leaving a project, switching, adding
   * or reloading a module, and dispose. Async work captures the generation
   * it started under and drops its result once that moved on.
   */
  private operationGeneration = 0;
  /**
   * The persistence banner reflects the newest project write: an earlier
   * write that settles after a later one never sets or clears it.
   */
  private projectWriteSequence = 0;
  /** The newest write issued, settled either way; giving the project up waits for it. */
  private lastWrite: Promise<void> = Promise.resolve();
  private issued: IssuedWrite | null = null;

  /**
   * The pieces of the open project's held states, and of restore points
   * until storage has them or one is restored.
   */
  private pieces = new PieceStore();
  /** The pieces storage holds for the open project, as far as this session knows. */
  private storedPieces = new Set<Address>();
  /** The last clean-up's finding of what restore points keep, so the next one reads only new restore points' pieces. */
  private restorePointPieces: RestorePointPieces | null = null;
  private keeper = new HistoryKeeper(this.pieces);
  private written: WrittenStates = NOTHING_WRITTEN;
  /** Steps or restore points gave way since storage was last cleaned up. */
  private cleanUpDue = false;
  /** The time zone the page last reported, which the history of every project opened takes. */
  private reportedTimeZone: string | null = null;
  /** A change is running in the gate; writes it asks for wait until its step is recorded. */
  private changing = false;
  private writeAfterChange = false;
  /** Where the spec owner's focus is, as their page last reported it; null until it did. */
  private focus: FocusPlace | null = null;
  /** What the coding agent named for the spec owner's attention in the change running. */
  private pointed: Pointed | null = null;
  private offers: AttentionOffer[] = [];

  private unsubscribeStore: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly outsideChanges: OutsideChanges | null;
  /** How the stored project differs from the one the session holds. */
  private outsideChange: OutsideChange | null = null;
  private stopWatchingOutsideChanges: (() => void) | null = null;
  /** A project write was held back while an outside change stood. */
  private writeHeldBack = false;

  private readonly authority: ProjectAuthority | null;
  private claim: { projectId: string; held: AuthorityClaim } | null = null;
  /** The claim being made; the next one waits for it, so a session never stands in its own way. */
  private claiming: Promise<void> = Promise.resolve();

  /**
   * `outsideChanges` reports changes made to the stored project by anything
   * else, for a storage that has them. `authority` decides which of several
   * sessions sharing a storage writes a project, for a storage that has
   * several.
   */
  constructor(
    persistence: PersistenceAdapter,
    options: { outsideChanges?: OutsideChanges; authority?: ProjectAuthority } = {},
  ) {
    this.persistence = persistence;
    this.outsideChanges = options.outsideChanges ?? null;
    this.authority = options.authority ?? null;
    this.state = { status: "idle", store: blankStore() };
    this.snapshot = snapshotOf(this.state, this.outsideChange, this.keeper.position, this.offers);
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

  private beginOperation(): number {
    this.operationGeneration += 1;
    return this.operationGeneration;
  }

  private isOperationCurrent(generation: number): boolean {
    return generation === this.operationGeneration;
  }

  private publish(): void {
    this.snapshot = snapshotOf(this.state, this.outsideChange, this.keeper.position, this.offers);
    this.listeners.forEach((listener) => listener());
  }

  /** The state an operation may change, or null while one is refused. */
  private readyState(): ReadySessionState | null {
    return this.state.status === "ready" ? this.state : null;
  }

  /** Set or, with null, clear one source's message. */
  private setPersistenceNotice(source: PersistenceNoticeSource, message: string | null): void {
    const state = this.readyState();
    if (state == null) return;
    if ((state.persistenceNotices[source] ?? null) === message) return;
    const notices = { ...state.persistenceNotices };
    if (message == null) delete notices[source];
    else notices[source] = message;
    this.state = { ...state, persistenceNotices: notices };
    this.publish();
  }

  /** The address of the open project's state now, its pieces held. */
  private addressOf(state: ReadySessionState): Address {
    return this.pieces.addressOf(projectState(state.registry, state.store));
  }

  /**
   * The open project, while it may change: refused while the project is not
   * open here, and while an outside change waits for the spec owner's
   * choice, since either project may be the one kept. Changes, undo and redo
   * are all refused by this one rule.
   */
  private changeableState(): ReadySessionState {
    const state = this.readyState();
    if (state == null) {
      throw new UserFacingError(
        this.state.status === "held-elsewhere"
          ? "This project is open in another tab."
          : "The project is not open yet. Try again in a moment.",
      );
    }
    if (this.outsideChange != null) {
      throw new UserFacingError(
        `${this.persistence.traits.name} changed outside Requireganizer. Nothing changes until the spec owner chooses in Requireganizer which project to keep.`,
      );
    }
    return state;
  }

  /**
   * Run one change to the open project, synchronously, and record it as one
   * step when the project's state differs afterwards, with who made it and
   * where the spec owner's focus was. Every request that changes the
   * project comes through here. A change inside another is part of it.
   * `movesFocusTo`, read once the change ran, is where a change of the spec
   * owner's moves their focus, such as a signature to the next unit; the
   * step records it with the change. What the coding agent names for the
   * spec owner's attention within its change is offered once it is made.
   */
  change = <Result>(
    kind: ChangeKind,
    run: () => Result,
    author: "spec owner" | "coding agent" = "spec owner",
    movesFocusTo: () => FocusPlace | null = () => null,
  ): Result => {
    if (this.changing) return run();
    const state = this.changeableState();
    const project = state.project.id;
    const before = this.addressOf(state);
    const startedAt = new Date();
    const focus = this.focus;
    this.changing = true;
    this.pointed = null;
    let made = false;
    try {
      const result = run();
      made = true;
      return result;
    } finally {
      this.changing = false;
      const pointed = this.pointed as Pointed | null;
      this.pointed = null;
      const after = this.readyState();
      if (after != null && after.project.id === project) {
        const address = this.addressOf(after);
        const movedFocusTo = made && author === "spec owner" ? movesFocusTo() : null;
        if (movedFocusTo != null) this.focus = movedFocusTo;
        if (address !== before) {
          this.keeper.record({
            kind,
            by: author === "spec owner" ? { kind: "spec owner", movedFocusTo } : { kind: "coding agent", named: made ? (pointed?.place ?? null) : null },
            focus,
            before,
            after: address,
            startedAt,
          });
          this.cleanUpDue ||= this.keeper.takeGaveWay();
          this.scheduleWrite();
        }
        if (made && pointed != null) {
          this.offers = [...this.offers, { id: uuid(), ...pointed }];
          this.scheduleWrite();
        }
        if (address !== before || (made && pointed != null)) this.publish();
      }
      if (this.writeAfterChange) {
        this.writeAfterChange = false;
        this.persistProject();
      }
    }
  };

  /**
   * Run a read of the open project, through the same gate as a change. A
   * read that changes the project throws, since no step records it.
   */
  read = <Result>(run: () => Result): Result => {
    const state = this.changeableState();
    const before = this.addressOf(state);
    const result = run();
    const after = this.readyState();
    if (after != null && after.project.id === state.project.id && this.addressOf(after) !== before) {
      throw new Error("A read changed the project, and no step records it.");
    }
    return result;
  };

  /**
   * Name an item, coverage or impact for the spec owner's attention, with
   * the coding agent's text; offered once the coding agent's change running
   * now is made.
   */
  pointOut = (place: FocusPlace & { unitId: string }, text: string, from: string): void => {
    if (!this.changing) throw new Error("Something is named for the spec owner's attention only within a change.");
    this.pointed = { place, text, from };
  };

  /** Take an offer away, once the spec owner took or dismissed it. */
  dismissOffer = (id: string): void => {
    if (!this.offers.some((offer) => offer.id === id)) return;
    this.offers = this.offers.filter((offer) => offer.id !== id);
    this.persistProject();
    this.publish();
  };

  /** Where the spec owner's focus is now, as their page reports it. */
  reportFocus = (place: FocusPlace | null): void => {
    this.focus = place;
  };

  /** The models the session shows of the open project, for the module versions they hold. */
  private liveStores(): LiveStoreOf {
    const state = this.readyState();
    if (state == null) return () => null;
    const { registry, store } = state;
    return (module) => {
      const entry = registry.modules.find(({ id }) => id === module.id);
      if (entry == null) return null;
      if (entry.id === registry.activeModuleId) {
        return this.pieces.moduleAddressOf({ ...entry, content: moduleContentOf(store) }) === module.address ? store : null;
      }
      const sibling = this.siblingStores.storeOf(entry.id);
      return sibling != null && this.pieces.moduleAddressOf(entry) === module.address ? sibling : null;
    };
  }

  /** The models of the open project's modules now, by module, which name its units and items. */
  private modelsNow(): ModelNowOf {
    const state = this.readyState();
    if (state == null) return () => null;
    const { registry, store } = state;
    return (moduleId) => (moduleId === registry.activeModuleId ? store : this.siblingStores.storeOf(moduleId));
  }

  /**
   * Write the open project, the pieces its history names and the history.
   * This is the only code that writes the stored project; the adapter keeps
   * the order that never leaves a record naming what is not stored. `over`
   * is the outside change the spec owner chose to write over; should the
   * write fail, it still stands.
   */
  private persistProject(over: OutsideChange | null = null): void {
    const state = this.readyState();
    if (state == null) return;
    if (this.changing) {
      this.writeAfterChange = true;
      return;
    }
    // Written once the spec owner has chosen which project to keep. Storage
    // would refuse it, and the refusal could arrive after the choice.
    if (this.outsideChange != null) {
      this.writeHeldBack = true;
      return;
    }
    const current = projectState(state.registry, state.store);
    const address = this.pieces.addressOf(current);
    const history = this.keeper.history;
    const offers = this.offers;
    const issued = issuedWriteOf(address, history, offers, state.project);
    if (sameIssuedWrite(this.issued, issued)) return;
    this.issued = issued;
    const pieces = [...this.pieces.reachable([address, ...this.keeper.roots()])]
      .filter((piece) => !this.storedPieces.has(piece))
      .map((piece) => [piece, this.pieces.get(piece)!.bytes] as const);
    for (const [piece] of pieces) this.storedPieces.add(piece);
    const { lastWritten } = this.written;
    this.written = { ...this.written, writing: address };
    const sequence = ++this.projectWriteSequence;
    const isLatest = (): boolean => sequence === this.projectWriteSequence;
    const generation = this.operationGeneration;
    const projectId = state.project.id;

    this.lastWrite = this.persistence.projects
      .write({
        project: state.project,
        state: current,
        address,
        pieces,
        writing: { lastWritten, writing: address, history, offers },
        written: { lastWritten: address, writing: null, history, offers },
        overOutsideChange: over != null,
      })
      .then(
        () => {
          if (this.readyState()?.project.id !== projectId) return;
          this.written = { lastWritten: address, writing: this.written.writing === address ? null : this.written.writing };
          if (!isLatest()) return;
          this.setPersistenceNotice("write", null);
          if (this.cleanUpDue) void this.cleanUp(projectId, generation);
        },
        (error: unknown) => {
          for (const [piece] of pieces) this.storedPieces.delete(piece);
          if (isLatest()) this.issued = null;
          if (over != null && this.outsideChange == null && this.readyState()?.project.id === projectId) {
            // The stored project is still the one changed outside, so the choice stands open again.
            this.outsideChange = over;
            this.writeHeldBack = true;
            this.publish();
          } else if (this.outsideChange != null) {
            // Refused because the stored project changed meanwhile: the
            // spec owner's choice settles it.
            this.writeHeldBack = true;
            return;
          }
          console.error("Could not persist project changes.", error);
          if (!isLatest()) return;
          this.setPersistenceNotice(
            "write",
            getUserFacingErrorMessage(error, projectSaveErrorMessage(this.persistence.traits.name)),
          );
        },
      );
  }

  private scheduleWrite(): void {
    if (this.saveTimer != null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistProject();
    }, PROJECT_SAVE_DEBOUNCE_MS);
  }

  /** Write now what waits for the debounce. */
  private flushPendingWrites(): void {
    if (!this.dropPendingWrite()) return;
    this.persistProject();
  }

  /** Stop waiting to write; whether a write waited. */
  private dropPendingWrite(): boolean {
    if (this.saveTimer == null) return false;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return true;
  }

  private attachStoreSubscription(state: ReadySessionState): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = onSnapshot(state.store, () => this.scheduleWrite());
  }

  /** Stop following the store. Unsaved changes are written first, unless the project is no longer this session's to write. */
  private detachStoreSubscription(options: { write: boolean } = { write: true }): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    if (options.write) this.flushPendingWrites();
    else this.dropPendingWrite();
  }

  /**
   * Walk the pieces of the given states, reading from storage those not
   * held. With `hold`, every piece read is held from then on. Resolves to
   * the pieces reached and whether none was missing or damaged; stops early
   * once `wanted` turns false. Throws when storage cannot be read, so a
   * clean-up never mistakes an unreadable piece for one nothing needs.
   */
  private async walkPieces(
    projectId: string,
    roots: readonly Address[],
    options: { hold: boolean; wanted: () => boolean },
  ): Promise<{ reached: Set<Address>; whole: boolean }> {
    const reached = new Set<Address>();
    let whole = true;
    let pending: (readonly [Address, PieceLevel])[] = roots.map((root) => [root, "project"] as const);
    while (pending.length > 0 && options.wanted()) {
      const batch = new Map(pending.filter(([address]) => !reached.has(address)));
      pending = [];
      for (const address of batch.keys()) reached.add(address);
      await Promise.all(
        [...batch].map(async ([address, level]) => {
          const held = this.pieces.get(address);
          if (held != null) {
            pending.push(...held.children);
            return;
          }
          const bytes = await this.persistence.record.readPiece(projectId, address);
          if (bytes == null || (options.hold ? !this.pieces.adopt(address, bytes, level) : addressOfBytes(bytes) !== address)) {
            console.error(`The piece ${address} of the project's history is missing or damaged.`);
            reached.delete(address);
            whole = false;
            return;
          }
          pending.push(...childrenOf(level, bytes));
        }),
      );
    }
    return { reached, whole };
  }

  /**
   * The pieces storage keeps for restore points, read from storage without
   * holding them. What the last clean-up found stands while each state it
   * was found from still belongs to a restore point; only the states added
   * since are walked.
   */
  private async storedRestorePointPieces(projectId: string, wanted: () => boolean): Promise<ReadonlySet<Address>> {
    const states = new Set(this.keeper.restorePointStates());
    const known = this.restorePointPieces;
    const found =
      known != null && [...known.states].every((state) => states.has(state))
        ? known
        : { states: new Set<Address>(), pieces: new Set<Address>() };
    const added = [...states].filter((state) => !found.states.has(state));
    if (added.length === 0) return found.pieces;
    const { reached } = await this.walkPieces(projectId, added, { hold: false, wanted });
    const pieces = new Set([...found.pieces, ...reached]);
    if (wanted()) this.restorePointPieces = { states: new Set([...found.states, ...added]), pieces };
    return pieces;
  }

  /**
   * Mark and sweep: keep the pieces of every held state, of every restore
   * point and of the open project, and delete every other piece, in memory
   * and in storage. Pieces only restore points keep are let go of in memory
   * once storage has them. One session is the project's authority, so
   * nothing else adds pieces meanwhile.
   */
  private async cleanUp(projectId: string, generation: number): Promise<void> {
    this.cleanUpDue = false;
    const wanted = (): boolean => this.isOperationCurrent(generation);
    try {
      await this.walkPieces(projectId, this.heldStates(), { hold: true, wanted });
      const stored = await this.storedRestorePointPieces(projectId, wanted);
      const state = this.readyState();
      if (!wanted() || state == null || state.project.id !== projectId) return;
      const held = this.pieces.reachable([this.addressOf(state), ...this.heldStates()]);
      // Restore points made since the walk are held whole.
      const restorePoints = new Set([...stored, ...this.pieces.reachable(this.keeper.restorePointStates())]);
      const unneeded = [...this.storedPieces].filter((address) => !held.has(address) && !restorePoints.has(address));
      this.pieces.retainOnly(
        new Set([...held, ...[...restorePoints].filter((address) => this.pieces.has(address) && !this.storedPieces.has(address))]),
      );
      for (const address of unneeded) this.storedPieces.delete(address);
      if (unneeded.length > 0) await this.persistence.record.deletePieces(projectId, unneeded);
    } catch (error) {
      console.error("Could not clean up the project's history.", error);
    }
  }

  /** The states whose pieces the session holds: those the history moves between, and those storage holds or is being given. */
  private heldStates(): Address[] {
    return [...this.keeper.heldStates(), ...[this.written.lastWritten, this.written.writing].filter((address) => address != null)];
  }

  /** Hold the project for this session, when sessions share its storage. False while another holds it. */
  private async claimProject(projectId: string, takeOver: boolean): Promise<boolean> {
    const authority = this.authority;
    if (authority == null) return true;
    const previous = this.claiming;
    let settled!: () => void;
    this.claiming = new Promise((resolve) => {
      settled = resolve;
    });
    try {
      await previous;
      if (this.claim?.projectId === projectId) return true;
      this.releaseClaim();
      const held = await authority.claim(projectId, { takeOver });
      if (held == null) return false;
      this.claim = { projectId, held };
      held.onEnd((asked) => this.claimEnded(projectId, asked));
      return true;
    } finally {
      settled();
    }
  }

  private releaseClaim(): void {
    this.claim?.held.release();
    this.claim = null;
  }

  /**
   * Another session took the project. Asked first, this one writes what it
   * has not written yet and waits for it; taken outright, it writes nothing
   * more, since the project is no longer its to write.
   */
  private async claimEnded(projectId: string, asked: boolean): Promise<void> {
    if (this.claim?.projectId !== projectId) return;
    this.claim = null;
    if (asked) {
      this.flushPendingWrites();
      await this.lastWrite;
    }
    const state = this.state;
    if (!("project" in state) || state.project.id !== projectId) return;
    this.beginOperation();
    this.detachStoreSubscription({ write: false });
    this.state = { status: "held-elsewhere", project: state.project, store: state.store };
    this.syncModuleContext();
    this.publish();
  }

  /** Link the shown store to the open project's other modules, so dependencies on their items resolve. */
  private syncModuleContext(): void {
    const state = this.state;
    this.siblingStores.applyModuleContext(state.store, state.status === "ready" ? state.registry : null);
  }

  /**
   * Restart whatever `dispose` cancelled: a project load, or following the
   * store of the open project.
   */
  start = (): void => {
    if (this.outsideChanges != null && this.stopWatchingOutsideChanges == null) {
      this.stopWatchingOutsideChanges = this.outsideChanges.watch((change) =>
        this.outsideChangeObserved(change),
      );
    }
    const state = this.state;
    switch (state.status) {
      case "idle":
        void this.openOnlyProject();
        return;
      case "load-failed":
      case "held-elsewhere":
        return;
      case "loading-project":
        void this.openProject(state.project);
        return;
      case "ready":
        if (this.unsubscribeStore == null) this.attachStoreSubscription(state);
    }
  };

  /**
   * Stop autosave after issuing every pending write. Safe to call repeatedly. A later `start` resumes what this
   * cancelled.
   */
  dispose = (): void => {
    if (this.writeHeldBack) {
      console.error(
        `${this.persistence.traits.name} changed outside Requireganizer, so the changes made since were not saved.`,
      );
    }
    this.stopWatchingOutsideChanges?.();
    this.stopWatchingOutsideChanges = null;
    this.beginOperation();
    this.detachStoreSubscription();
  };

  /** Show a store and registry and persist them. */
  private showStore(project: ProjectIdentity, store: Store, registry: ModuleRegistry): void {
    const previous = this.readyState();
    this.detachStoreSubscription();
    const state: ReadySessionState = {
      status: "ready",
      project,
      registry,
      store,
      persistenceNotices: previous?.project.id === project.id ? previous.persistenceNotices : {},
    };
    this.state = state;
    this.attachStoreSubscription(state);
    this.persistProject();
    this.syncModuleContext();
    this.publish();
  }

  /** Registry-only changes persist immediately; store mutations stay debounced. */
  private commitRegistry(nextRegistry: ModuleRegistry): void {
    const state = this.readyState();
    if (state == null) return;
    this.state = { ...state, registry: nextRegistry };
    this.persistProject();
    this.syncModuleContext();
    this.publish();
  }

  /** The registry with the shown store's content written into its entry. */
  private stashActiveModule(state: ReadySessionState): ModuleRegistry {
    return { ...projectState(state.registry, state.store), activeModuleId: state.registry.activeModuleId };
  }

  /**
   * Show a state of a project and write it like any other change. The shown
   * module stays shown while the state still has it visible; otherwise, and
   * when the project was not shown yet, its first visible module shows.
   * Opening, importing, undo, redo and going to a step all show a state
   * this way.
   */
  private showState(project: ProjectIdentity, shown: ProjectState): void {
    const previous = this.readyState();
    const same = previous?.project.id === project.id ? previous : null;
    const kept = same?.registry.activeModuleId ?? null;
    const visible = visibleModules(shown);
    const opened = visible.find(({ id }) => id === kept) ?? visible[0]!;
    this.beginOperation();
    if (same == null || opened.id !== kept) {
      this.showStore(project, createModuleStore(opened.content), { ...shown, activeModuleId: opened.id });
      return;
    }
    // The shown module stays in its store, which takes only what differs and
    // so sends the page only that; a module left as it was keeps its entry,
    // whose content the page already holds.
    const held = moduleContentOf(same.store);
    const content = sharedWith(held, opened.content);
    if (content !== held) applySnapshot(same.store, content);
    const modules = shown.modules.map((module): ModuleState => {
      const entry = same.registry.modules.find(({ id }) => id === module.id);
      if (entry == null) return module;
      // The shown module's content lives in its store; its entry keeps the content it had when it was last shown.
      const entryContent = module.id === opened.id ? entry.content : sharedWith(entry.content, module.content);
      return entryContent === entry.content && entry.name === module.name && entry.archivedAt === module.archivedAt
        ? entry
        : { ...module, content: entryContent };
    });
    const registryKept =
      shown.modulesEnabled === same.registry.modulesEnabled &&
      modules.length === same.registry.modules.length &&
      modules.every((entry, index) => entry === same.registry.modules[index]);
    this.state = registryKept
      ? same
      : { ...same, registry: { modulesEnabled: shown.modulesEnabled, activeModuleId: opened.id, modules } };
    this.scheduleWrite();
    this.syncModuleContext();
    this.publish();
  }

  /** A kept state, put together from its pieces; throws for the spec owner when storage lost one of them. */
  private keptState(address: Address): ProjectState {
    try {
      return this.pieces.stateAt(address);
    } catch (error) {
      console.error(`The state ${address} of the project's history cannot be put together.`, error);
      throw new UserFacingError("That state of the project is no longer stored, so it cannot be brought back.", error);
    }
  }

  /**
   * The stored project as the rule for outside changes reads it, with its
   * state when it can be opened and its pieces held.
   */
  private async readStoredProject(project: ProjectIdentity): Promise<ReadStoredProject> {
    let document: unknown;
    try {
      document = await this.persistence.projects.load(project.id);
    } catch (error) {
      return { kind: "unreadable", problem: error instanceof Error ? error.message : String(error) };
    }
    if (document == null) return { kind: "missing" };
    let state: ProjectState;
    try {
      state = parseProject(document);
    } catch (error) {
      return {
        kind: "unreadable",
        problem: `${project.name} cannot be opened because its stored data is invalid: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return { kind: "readable", address: this.pieces.addressOf(state), state };
  }

  /**
   * Show a project as opening it decides, from the stored project and its
   * history: the stored state, the state the history is at, or that state
   * with the outside change waiting for the spec owner's choice.
   */
  /** The state at an address the pieces hold whole and today's parser reads; null for one they do not. */
  private readableState(address: Address): ProjectState | null {
    if (!this.pieces.holdsWhole(address)) return null;
    try {
      return this.pieces.stateAt(address);
    } catch (error) {
      if (error instanceof InvalidJsonError) return null;
      throw error;
    }
  }

  private openStored(project: ProjectIdentity, stored: ReadStoredProject, record: ProjectRecord | null, loaded: ProjectHistory | null): void {
    let history = loaded;
    let opening: Opening<Extract<ReadStoredProject, { kind: "readable" }>> = openingOf(stored, record, history?.currentState ?? null);
    // The state the project was at, as the history keeps it; one no longer stored whole, or not readable, is none.
    const current = "current" in opening ? this.readableState(opening.current) : null;
    if ("current" in opening && current == null) {
      console.error("The project's history names a state that is no longer stored or readable; it starts again.");
      history = null;
      opening = openingOf(stored, record, null);
    }
    let shown: ProjectState;
    let shownAddress: Address;
    switch (opening.kind) {
      case "cannot open":
        throw new UserFacingError(opening.problem ?? `${project.name} is no longer stored.`);
      case "start":
      case "open stored":
        shown = opening.stored.state;
        shownAddress = opening.stored.address;
        break;
      case "write current":
      case "outside change":
        shown = current!;
        shownAddress = opening.current;
    }
    // Starting, the stored project becomes the one last written, with no steps.
    const kept = opening.kind === "start" || history == null ? EMPTY_HISTORY : history;
    this.offers = opening.kind === "start" ? [] : offersOf(record);
    this.written = opening.kind === "start" || record == null ? NOTHING_WRITTEN : { lastWritten: record.lastWritten, writing: record.writing };
    this.outsideChange = opening.kind === "outside change" ? opening.change : null;
    this.keeper = new HistoryKeeper(this.pieces, { ...kept, currentState: shownAddress, timeZone: this.reportedTimeZone ?? kept.timeZone });
    this.keeper.applyKeepingRule();
    this.cleanUpDue ||= this.keeper.takeGaveWay();
    // A project stored as its record last wrote it is not written again on
    // opening, unless opening changes its history.
    this.issued =
      opening.kind === "open stored" && this.written.writing == null && this.written.lastWritten != null
        ? issuedWriteOf(this.written.lastWritten, kept, this.offers, project)
        : null;
    this.focus = null;
    this.showState(project, shown);
  }

  /** Leave whatever is shown and load a project from storage. */
  private openProject(project: ProjectIdentity, options: { takeOver: boolean } = { takeOver: false }): Promise<void> {
    // Finish the outgoing writes before anything is replaced.
    this.flushPendingWrites();
    // The project is read again, so a write held back has nothing to keep.
    this.writeHeldBack = false;
    const generation = this.beginOperation();
    this.detachStoreSubscription();
    if (this.claim != null && this.claim.projectId !== project.id) this.releaseClaim();
    this.state = { status: "loading-project", project, store: this.state.store };
    this.publish();
    this.projectLoad = this.loadProject(project, generation, options.takeOver);
    return this.projectLoad;
  }

  /**
   * Load a project and its history, then show the store. A superseded load
   * is dropped after each await; a failed load ends failed, naming the
   * project, instead of leaving the session loading. Stored data that
   * cannot be read is never replaced.
   */
  private async loadProject(project: ProjectIdentity, generation: number, takeOver: boolean): Promise<void> {
    try {
      const claimed = await this.claimProject(project.id, takeOver);
      if (!this.isOperationCurrent(generation)) {
        // Left meanwhile, such as back to the projects: the claim goes too.
        const current = this.state;
        if ((!("project" in current) || current.project.id !== project.id) && this.claim?.projectId === project.id) {
          this.releaseClaim();
        }
        return;
      }
      if (!claimed) {
        this.state = { status: "held-elsewhere", project, store: this.state.store };
        this.publish();
        return;
      }
      this.pieces = new PieceStore();
      this.restorePointPieces = null;
      const stored = await this.readStoredProject(project);
      const record = await this.persistence.record.load(project.id).catch((error: unknown) => {
        console.error("The project's record could not be read; its history starts again.", error);
        return null;
      });
      const history = historyOf(record);
      const storedPieces = await this.persistence.record.pieceAddresses(project.id);
      if (!this.isOperationCurrent(generation)) return;
      this.storedPieces = new Set(storedPieces);
      // Undo, redo and going to a step are synchronous, so every held
      // state is held first; restore points are read when restored.
      this.keeper = new HistoryKeeper(this.pieces, history ?? EMPTY_HISTORY);
      this.written = record == null ? NOTHING_WRITTEN : { lastWritten: record.lastWritten, writing: record.writing };
      await this.walkPieces(project.id, this.heldStates(), {
        hold: true,
        wanted: () => this.isOperationCurrent(generation),
      }).catch((error: unknown) => {
        // A state missing a piece is not one the history can show.
        console.error("Some pieces of the project's history could not be read.", error);
      });
      if (!this.isOperationCurrent(generation)) return;
      this.openStored(project, stored, record, history);
      void this.cleanUp(project.id, this.operationGeneration);
    } catch (error) {
      if (!this.isOperationCurrent(generation)) return;
      console.error("Could not load the project.", error);
      this.detachStoreSubscription();
      this.state = {
        status: "load-failed",
        project,
        message: getUserFacingErrorMessage(error, PROJECT_LOAD_ERROR_MESSAGE),
        store: this.state.store,
      };
      this.syncModuleContext();
      this.publish();
    }
  }

  /** Show another module of the open project. */
  private showModule(state: ReadySessionState, store: Store, registry: ModuleRegistry): void {
    this.beginOperation();
    this.showStore(state.project, store, registry);
  }

  /**
   * Write now everything the tab or process would otherwise lose, e.g. on
   * unload; resolves once every write issued is settled.
   */
  flush = (): Promise<void> => {
    this.flushPendingWrites();
    return this.lastWrite;
  };

  /** Rebuild the store from its own snapshot, e.g. after a code reload. */
  reloadStore = (): void => {
    const state = this.state;
    const created = Store.create(getSnapshot(state.store));
    if (state.status !== "ready") {
      this.state = { ...state, store: created };
      this.publish();
      return;
    }
    this.showModule(state, created, state.registry);
  };

  consumeOverviewSeed = (projectId: string): string | null => {
    const pending = this.pendingOverviewSeed;
    if (pending == null || pending.projectId !== projectId) return null;
    this.pendingOverviewSeed = null;
    return pending.seed;
  };

  selectProject = (
    id: string,
    name: string,
    options?: { overviewSeed?: string },
  ): Promise<void> => {
    // A pending seed stays until a new one replaces it, the user leaves, or
    // another project opens.
    const seed = options?.overviewSeed?.trim();
    if (seed != null && seed.length > 0) {
      this.pendingOverviewSeed = { projectId: id, seed };
    } else if (this.pendingOverviewSeed?.projectId !== id) {
      this.pendingOverviewSeed = null;
    }
    // Clients share the session: selecting the project already open or
    // opening keeps it, rather than reloading it under another client.
    const state = this.state;
    if ((state.status === "loading-project" || state.status === "ready") && state.project.id === id) {
      return this.projectLoad;
    }
    return this.openProject({ id, name });
  };

  /** Open the project another session holds here, once that one has written what it had. */
  takeOverProject = (): Promise<void> => {
    const state = this.state;
    if (state.status !== "held-elsewhere") return Promise.resolve();
    return this.openProject(state.project, { takeOver: true });
  };

  /**
   * A storage that holds one project has nothing to choose from: its project
   * opens. Settles once the project is open or has failed to load, or at
   * once when the storage holds several projects or none.
   */
  openOnlyProject = async (): Promise<void> => {
    if (!this.persistence.traits.singleProject) return;
    const state = this.state;
    if (state.status !== "idle") {
      if (state.status === "loading-project") await this.projectLoad;
      return;
    }
    const projects = await this.persistence.projects.list();
    // Another client opened a project while the list was read.
    if (this.state.status !== "idle") return this.openOnlyProject();
    if (projects.length !== 1) return;
    await this.selectProject(projects[0]!.id, projects[0]!.name);
  };

  private outsideChangeObserved(change: OutsideChange | null): void {
    this.outsideChange = change;
    // The stored project is again the one the session holds, such as after
    // a checkout back: what was held back is written now.
    if (change == null && this.writeHeldBack) {
      this.writeHeldBack = false;
      this.issued = null;
      this.persistProject();
    }
    this.publish();
  }

  /**
   * Open the stored project that changed outside the session in place of
   * the one on screen, as one step undo takes back.
   */
  openChangedProject = async (): Promise<void> => {
    const state = this.choosableState();
    const change = this.outsideChange;
    if (change?.kind !== "changed") return;
    if (change.problem != null) throw new UserFacingError(change.problem);
    const generation = this.operationGeneration;
    const stored = await this.readStoredProject(state.project);
    const current = this.readyState();
    if (!this.isOperationCurrent(generation) || current?.project.id !== state.project.id || this.outsideChange == null) {
      return;
    }
    if (stored.kind !== "readable") {
      // It changed again meanwhile, into one that cannot be opened.
      this.outsideChange = storedProjectChange(stored, { ...this.written, history: null, offers: null });
      this.publish();
      throw new UserFacingError(stored.kind === "missing" ? `${this.persistence.traits.name} was removed.` : stored.problem);
    }
    this.outsideChange = null;
    this.writeHeldBack = false;
    this.change("opening a changed project", () => this.showState(current.project, stored.state));
  };

  /** Write the project on screen over the stored one that changed or was removed outside the session. */
  keepShownProject = (): void => {
    this.choosableState();
    const change = this.outsideChange;
    if (change == null) return;
    this.outsideChange = null;
    this.writeHeldBack = false;
    this.issued = null;
    this.persistProject(change);
    this.publish();
  };

  /**
   * Leave the stored project removed outside the session: write nothing
   * where it was, forget its history and pieces, so no later opening reports
   * the removal again, and close it.
   */
  leaveProjectRemoved = async (): Promise<void> => {
    const state = this.choosableState();
    if (this.outsideChange?.kind !== "removed") {
      throw new UserFacingError(`${state.project.name} is stored again, so it was not left removed.`);
    }
    // Once the history is forgotten, storage reports no outside change; what
    // was held back is still not written where the stored project was.
    const heldBack = this.writeHeldBack;
    this.writeHeldBack = false;
    try {
      // Storage refuses this once the stored project is back.
      await this.persistence.projects.delete(state.project.id);
    } catch (error) {
      this.writeHeldBack ||= heldBack;
      throw error;
    }
    if (this.readyState()?.project.id !== state.project.id) return;
    this.outsideChange = null;
    this.issued = null;
    this.pieces = new PieceStore();
    this.keeper = new HistoryKeeper(this.pieces);
    this.written = NOTHING_WRITTEN;
    this.offers = [];
    this.storedPieces = new Set();
    this.restorePointPieces = null;
    this.closeProject({ write: false });
  };

  /** The open project, while the choice between the two projects can be made. */
  private choosableState(): ReadySessionState {
    const state = this.readyState();
    if (state == null) {
      throw new UserFacingError("Choose which project to keep once the project has finished opening.");
    }
    return state;
  }

  /**
   * Undo the current step, bringing back the project as it was before it.
   * Undo is not itself a step. Resolves to where the focus goes, or null to
   * leave it where it is.
   */
  undo = (): FocusPlace | null => this.move(this.keeper.undo());

  /** Redo the step after the current one the project was most recently at, bringing back the project as it was after it; resolves as undo does. */
  redo = (): FocusPlace | null => this.move(this.keeper.redo());

  private move(move: HistoryMove | null): FocusPlace | null {
    const state = this.changeableState();
    if (move == null) return null;
    const shown = this.keptState(move.state);
    // What waits for the debounce is the project as it was before the move, which the move's own write replaces.
    this.dropPendingWrite();
    this.keeper.prepareMove(move, this.liveStores());
    this.showState(state.project, shown);
    const focus = this.keeper.commitMove(move, this.liveStores());
    this.focus = focus ?? this.focus;
    this.scheduleWrite();
    this.publish();
    return focus;
  }

  /** Every kept step, newest first, with where each stands and what it added, changed or removed, then the start. */
  listSteps = (): ListedSteps => (this.readyState() == null ? { steps: [], start: null } : this.keeper.listSteps(this.modelsNow()));

  /**
   * Go to how the project was after a kept step, on any branch, or before
   * the oldest of them. Like undo and redo it moves within the history and
   * is not itself a step; it leaves the focus where it is.
   */
  goTo = (target: StepListTarget): void => {
    this.move(this.keeper.goTo(target));
  };

  /** The restore points the keeping rule keeps now, newest first. */
  listRestorePoints = (): ListedRestorePoint[] => (this.readyState() == null ? [] : this.keeper.listRestorePoints());

  /**
   * The project as it was after a kept step or at a restore point, with what
   * bringing it back would add, change or remove, changing nothing. Throws
   * for the spec owner when that state is no longer kept.
   */
  preview = async (target: PreviewTarget): Promise<{ state: ProjectState; difference: StateDifference; heldNow: ReadonlySet<string> }> => {
    const address = await this.earlierState(target, "shown", "That earlier state is no longer kept, so the project shows as it is now.");
    const state = this.keptState(address);
    return { state, difference: this.differenceFromNowOf(address, "shown"), heldNow: this.modulesHeldNow(state) };
  };

  /** The modules of a state that are, by id, exactly as the project holds them now. */
  private modulesHeldNow(state: ProjectState): ReadonlySet<string> {
    const ready = this.readyState();
    if (ready == null) return new Set();
    const now = new Map(projectState(ready.registry, ready.store).modules.map((module) => [module.id, this.pieces.moduleAddressOf(module)]));
    return new Set(state.modules.filter((module) => now.get(module.id) === this.pieces.moduleAddressOf(module)).map(({ id }) => id));
  }

  /** What bringing back the project as it was after a kept step or at a restore point would add, change or remove, changing nothing. */
  differenceFromNow = async (target: PreviewTarget): Promise<StateDifference> =>
    this.differenceFromNowOf(await this.earlierState(target, "compared"), "compared");

  /**
   * The state after a kept step, before the oldest of them, or at a kept
   * restore point, with all its
   * pieces held. Throws for the spec owner when the project is not open,
   * and when the state is no longer kept, saying so with `noLongerKept`
   * where given; `doing` names what cannot be done.
   */
  private async earlierState(target: PreviewTarget, doing: string, noLongerKept: string | null = null): Promise<Address> {
    const state = this.readyState();
    if (state == null) throw new UserFacingError("The project is not open yet. Try again in a moment.");
    let address: Address | null;
    try {
      address = target.kind === "restore point" ? await this.heldRestorePoint(state.project.id, target.id, doing) : this.keeper.previewState(target);
    } catch (error) {
      if (noLongerKept == null) throw error;
      throw new UserFacingError(noLongerKept, error);
    }
    if (address == null) throw new UserFacingError(`The project was closed before the earlier state could be ${doing}.`);
    return address;
  }

  private differenceFromNowOf(address: Address, doing: string): StateDifference {
    const difference = this.keeper.differenceFromNow(address, this.modelsNow());
    if (difference == null) throw new UserFacingError(`That earlier state is no longer stored, so it cannot be ${doing}.`);
    return difference;
  }

  /**
   * The state of a kept restore point, with all its pieces held, read from
   * storage where needed; null once the project is no longer open. `doing`
   * names what cannot be done when storage lost one of them.
   */
  private async heldRestorePoint(projectId: string, id: string, doing: string): Promise<Address | null> {
    const { state: address } = this.keeper.restorePoint(id);
    const wanted = (): boolean => this.readyState()?.project.id === projectId;
    // A clean-up meanwhile may let go of pieces only restore points keep, so they are read until all are held at once.
    while (!this.pieces.holdsWhole(address)) {
      const { whole } = await this.walkPieces(projectId, [address], { hold: true, wanted });
      if (!wanted()) return null;
      if (!whole) throw new UserFacingError(`That restore point is no longer stored, so it cannot be ${doing}.`);
    }
    return address;
  }

  /** Change the history beside the project, not the project itself, and write it. */
  private historyChanged(): void {
    this.cleanUpDue ||= this.keeper.takeGaveWay();
    this.persistProject();
    this.publish();
  }

  /** Make a restore point of the project on screen under the spec owner's name. */
  makeRestorePoint = (name: string): void => {
    const state = this.changeableState();
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new UserFacingError("Name the restore point.");
    this.keeper.makeRestorePoint({ id: uuid(), state: this.addressOf(state), at: new Date().toISOString(), name: trimmed, pinned: false });
    this.historyChanged();
  };

  /**
   * Restore the project to a restore point, as one step of kind restore
   * that undo takes back. Its pieces are read from storage first; the state
   * is then shown inside the gate in one go, so no change lands between.
   */
  restoreToRestorePoint = async (id: string): Promise<void> => {
    const state = this.changeableState();
    const address = await this.heldRestorePoint(state.project.id, id, "restored");
    if (address == null) return;
    this.change("restore", () => {
      const current = this.changeableState();
      this.keeper.restorePoint(id);
      this.showState(current.project, this.keptState(address));
    });
  };

  pinRestorePoint = (id: string): void => {
    this.changeableState();
    this.keeper.pinRestorePoint(id);
    this.historyChanged();
  };

  /** Unpinned, an automatic restore point is kept by the keeping rule again, which may let go of it at once. */
  unpinRestorePoint = (id: string): void => {
    this.changeableState();
    this.keeper.unpinRestorePoint(id);
    this.historyChanged();
  };

  deleteRestorePoint = (id: string): void => {
    this.changeableState();
    this.keeper.deleteRestorePoint(id);
    this.historyChanged();
  };

  /**
   * The IANA time zone of a page, whose calendar the keeping rule reads
   * periods in. The open project's history takes it, as does every project
   * opened later.
   */
  reportTimeZone = (timeZone: string): void => {
    if (!isTimeZone(timeZone)) throw new UserFacingError(`${timeZone} is not a time zone.`);
    this.reportedTimeZone = timeZone;
    if (this.readyState() == null || !this.keeper.takeTimeZone(timeZone)) return;
    this.historyChanged();
  };

  /**
   * Remove a project that is not open, with its history and pieces. Refused
   * while another session, such as another tab, holds it.
   */
  deleteProject = async (projectId: string): Promise<void> => {
    const state = this.state;
    if ("project" in state && state.project.id === projectId && state.status !== "held-elsewhere") {
      throw new UserFacingError("Leave the project before deleting it.");
    }
    const claim = await this.authority?.claim(projectId, { takeOver: false });
    if (claim === null) throw new UserFacingError("This project is open in another tab. Close it there, then delete it.");
    try {
      await this.persistence.projects.delete(projectId);
    } finally {
      claim?.release();
    }
  };

  backToProjects = (): void => {
    this.flushPendingWrites();
    this.closeProject({ write: true });
  };

  /** Show no project, giving the open one up; `write` writes what waits for the debounce first. */
  private closeProject(options: { write: boolean }): void {
    this.beginOperation();
    this.pendingOverviewSeed = null;
    this.detachStoreSubscription(options);
    this.releaseClaim();
    this.state = { status: "idle", store: this.state.store };
    this.syncModuleContext();
    this.publish();
  }

  clearPersistenceError = (): void => {
    const state = this.readyState();
    if (state == null || Object.keys(state.persistenceNotices).length === 0) return;
    this.state = { ...state, persistenceNotices: {} };
    this.publish();
  };

  enableModules = (name: string): void => {
    const current = this.readyState()?.registry;
    if (current == null || current.modulesEnabled) return;
    const trimmed = normalizeModuleName(name);
    assertModuleNameAvailable(trimmed, current.modules);
    this.commitRegistry({
      ...current,
      modulesEnabled: true,
      modules: current.modules.map((entry) =>
        entry.id === current.activeModuleId ? { ...entry, name: trimmed } : entry,
      ),
    });
  };

  /** Another module of the open project, read-only, as dependencies on its items resolve it; null for one not shown in the registry. */
  otherModuleStore = (id: string): Store | null => this.siblingStores.storeOf(id);

  switchModule = (id: string): boolean => {
    const state = this.readyState();
    if (state == null) return false;
    const current = state.registry;
    if (id === current.activeModuleId) return true;
    const target = current.modules.find((entry) => entry.id === id);
    if (target == null || target.archivedAt != null) return false;
    this.showModule(state, createModuleStore(target.content), { ...this.stashActiveModule(state), activeModuleId: id });
    return true;
  };

  addModule = (name: string): void => {
    const state = this.readyState();
    if (state == null) return;
    const trimmed = normalizeModuleName(name);
    assertModuleNameAvailable(trimmed, state.registry.modules);
    const created = blankStore();
    const entry: ModuleState = {
      id: crypto.randomUUID(),
      name: trimmed,
      archivedAt: null,
      content: moduleContentOf(created),
    };
    const stashed = this.stashActiveModule(state);
    this.showModule(state, created, { ...stashed, activeModuleId: entry.id, modules: [...stashed.modules, entry] });
  };

  /** Throws when the name is empty, invalid, or another module has it. */
  renameModule = (id: string, name: string): void => {
    const current = this.readyState()?.registry;
    if (current == null || !current.modulesEnabled) return;
    if (!current.modules.some((entry) => entry.id === id)) return;
    const trimmed = normalizeModuleName(name);
    assertModuleNameAvailable(trimmed, current.modules.filter((entry) => entry.id !== id));
    this.commitRegistry({
      ...current,
      modules: current.modules.map((entry) => (entry.id === id ? { ...entry, name: trimmed } : entry)),
    });
  };

  /**
   * Rejects when the name is empty or another project has it. The name is
   * the project's identity, not its state, so renaming is no change to it;
   * the next write stores the name.
   */
  renameProject = async (name: string): Promise<void> => {
    const state = this.readyState();
    if (state == null) return;
    const projectId = state.project.id;
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new UserFacingError("Name the project.");
    const projects = await this.persistence.projects.list();
    if (hasProjectName(projects.filter(({ id }) => id !== projectId), trimmed)) {
      throw new UserFacingError(`A project named “${trimmed}” already exists.`);
    }
    const current = this.readyState();
    if (current == null || current.project.id !== projectId) return;
    this.state = { ...current, project: { ...current.project, name: trimmed } };
    this.persistProject();
    this.publish();
  };

  archiveModule = (id: string): void => {
    const current = this.readyState()?.registry;
    if (current == null || id === current.activeModuleId) return;
    const target = current.modules.find((entry) => entry.id === id);
    if (target == null || target.archivedAt != null) return;
    if (visibleModules(current).length <= 1) return;
    this.commitRegistry({
      ...current,
      modules: current.modules.map((entry) =>
        entry.id === id
          ? { ...entry, archivedAt: new Date().toISOString() }
          : entry,
      ),
    });
  };

  /**
   * Replace the open project with the one an exported file holds. Run
   * inside the gate as an import, it is one step undo takes back. Throws
   * what is wrong with the file, changing nothing.
   */
  importProjectFile = (text: string, fileName: string): void => {
    const state = this.changeableState();
    this.showState(state.project, importedProject(text, fileName));
  };

  /** The bytes of an export of the open project, or of one of its restore points, with the options given. */
  exportProject = async (options: ExportOptions, restorePointId?: string): Promise<string> => {
    const state = this.readyState();
    if (state == null) throw new UserFacingError("Export once the project has finished opening.");
    if (restorePointId == null) return buildExport(projectState(state.registry, state.store), options);
    const address = await this.heldRestorePoint(state.project.id, restorePointId, "exported");
    if (address == null) throw new UserFacingError("The project was closed before the restore point was exported. Open it and export again.");
    return buildExport(this.keptState(address), options);
  };

  /** Create an empty project. Rejects when the name is empty or another project has it. */
  createProject = async (name: string): Promise<ProjectIdentity> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new UserFacingError("Name the project.");
    const projects = await this.persistence.projects.list();
    if (hasProjectName(projects, trimmed)) throw new UserFacingError(`A project named “${trimmed}” already exists.`);
    const project = { id: crypto.randomUUID(), name: trimmed };
    await this.storeNewProject(project, blankProjectState());
    return project;
  };

  /**
   * Store the project an exported file holds as a new one, named after the
   * file, leaving every other project as it was. Rejects with what is wrong
   * with the file, storing nothing.
   */
  importNewProject = async (text: string, fileName: string): Promise<ProjectIdentity> => {
    const imported = importedProject(text, fileName);
    const projects = await this.persistence.projects.list();
    const baseName = fileName.replace(/\.json$/i, "").trim() || "Imported project";
    let name = baseName;
    for (let suffix = 1; hasProjectName(projects, name); suffix += 1) name = `${baseName} (${suffix})`;
    const project = { id: crypto.randomUUID(), name };
    await this.storeNewProject(project, imported);
    return project;
  };

  /** Store a project storage does not hold yet, with a record that names it as written. */
  private storeNewProject(project: ProjectIdentity, state: ProjectState): Promise<void> {
    const pieces = new PieceStore();
    const address = pieces.addressOf(state);
    const history: ProjectHistory = { ...EMPTY_HISTORY, currentState: address, timeZone: this.reportedTimeZone };
    return this.persistence.projects.create({
      project,
      state,
      address,
      pieces: [...pieces.reachable([address])].map((piece) => [piece, pieces.get(piece)!.bytes] as const),
      writing: { lastWritten: null, writing: address, history, offers: [] },
      written: { lastWritten: address, writing: null, history, offers: [] },
      overOutsideChange: false,
    });
  }
}

/** The module summaries the interface renders for a registry. */
export function moduleSummaries(
  registry: ModuleRegistry | null,
): ModuleSummary[] {
  if (registry == null) return [];
  return visibleModules(registry).map((entry) => ({
    id: entry.id,
    name: entry.name,
    active: entry.id === registry.activeModuleId,
  }));
}
