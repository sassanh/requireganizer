import { exactRecord, InvalidJsonError, isRecord, readFlag, readText } from "lib/json";
import { type Address, isAddress, type ModulePieces, type PieceStore, serializeCanonical, type StoredItem } from "storage";
import { SiblingModuleStores, type Store, WORKFLOW } from "store";
import { coverageUnitId, impactUnitId, type ItemVersion, parseUnitId, phaseOf, shownItemOrder, type Thread, type UnitState, versionOf } from "workflow";

/** What bringing an earlier state back would do to one item, coverage or impact. */
export type UnitChange =
  | { change: "add" }
  | {
      change: "change";
      /** What differs: its content, its signatures, its threads. */
      content: boolean;
      signature: boolean;
      threads: boolean;
      /** For an item in another place in its stage: its code there and now. */
      place: { then: string; now: string } | null;
      /** For an item whose content differs, its version now, to show how the earlier one differs. */
      versionNow: ItemVersion | null;
    }
  | {
      change: "remove";
      /** Its text now, which the earlier state lacks. */
      textNow: string;
      /** The item of both states that comes before it now; null at the start of its stage. */
      after: string | null;
    };

/**
 * One item that bringing an earlier state back would add or remove, or one
 * item, coverage or impact it would change, by what each state stores of it:
 * a coverage's or impact's signature and threads, never its coming or going
 * with the items it is on. Named by its module, its stage and its label, as
 * the project names it now: "a removed item" for one it no longer holds.
 */
export type UnitDifference = UnitChange & {
  moduleId: string;
  /** The module's name. */
  module: string;
  stage: string;
  unitId: string;
  unitKind: UnitState["kind"];
  itemKind: string | null;
  label: string;
};

/**
 * A thread on a removed unit whose messages or resolution bringing an
 * earlier state back would change: the messages only one of the two holds.
 */
export interface ThreadDifference {
  moduleId: string;
  module: string;
  stage: string;
  threadId: string;
  /** The unit it was on. */
  unitId: string;
  /** The name its unit had when it was removed. */
  label: string;
  /** What its unit said when it was removed. */
  text: string;
  /** The texts of its messages only the earlier state holds, which bringing it back would add. */
  messagesAdded: string[];
  /** The texts of its messages only the project now holds, which bringing the earlier state back would remove. */
  messagesRemoved: string[];
  resolutionDiffers: boolean;
  /** Whether the earlier state lacks the thread, which bringing it back would remove. */
  onlyNow: boolean;
}

/**
 * What bringing an earlier state back would do to one of the project's
 * modules: add or remove it, archive it or bring it back from the archive,
 * or rename it.
 */
export type ModuleChange = "add" | "remove" | "archive" | "bring back" | "rename";

export interface ModuleDifference {
  moduleId: string;
  change: ModuleChange;
  /** Its name in the project now, or in the earlier state for a module only it holds. */
  nameNow: string;
  /** Its name in the earlier state, or in the project now for a module only it holds. */
  nameThen: string;
}

/** A stage that bringing an earlier state back would ask of the coding agent, asking it anew, or no longer ask. */
export interface AskDifference {
  moduleId: string;
  module: string;
  stage: string;
  change: "ask" | "withdraw";
}

/**
 * How an earlier state differs from the project now: its modules, whether
 * it has modules turned on, the stages asked of the coding agent, then unit
 * by unit and thread by thread on removed units, in the order the modules
 * and stages show them. `modulesEnabled` is the earlier state's, when it
 * differs.
 */
export interface StateDifference {
  same: boolean;
  modulesEnabled: boolean | null;
  modules: ModuleDifference[];
  asks: AskDifference[];
  units: UnitDifference[];
  threads: ThreadDifference[];
}

/**
 * A `UnitDifference` as a step keeps it: what the states' pieces hold is
 * named by the piece's address, and the label and texts are not kept, since
 * they read as the project names its items now.
 */
export type StoredUnitDifference = (
  | { change: "add" }
  | {
      change: "change";
      content: boolean;
      signature: boolean;
      threads: boolean;
      place: { then: string; now: string } | null;
      /** For an item whose content differs, the piece of the item as it is now. */
      itemNow: Address | null;
    }
  | {
      change: "remove";
      /** The piece of the item as it is now. */
      itemNow: Address;
      after: string | null;
    }
) & {
  moduleId: string;
  stage: string;
  unitId: string;
  unitKind: UnitState["kind"];
  itemKind: string | null;
};

/** A `ThreadDifference` as a step keeps it, naming the thread's pieces. */
export interface StoredThreadDifference {
  moduleId: string;
  stage: string;
  threadId: string;
  /** The thread's piece in the earlier state; null when that state lacks it. */
  earlier: Address | null;
  /** The thread's piece in the project now; null when it lacks it. */
  now: Address | null;
  /** The places among the earlier thread's messages of those only it holds. */
  messagesAdded: number[];
  /** The places among the thread's messages now of those only it holds. */
  messagesRemoved: number[];
  resolutionDiffers: boolean;
}

/** A `ModuleDifference` as a step keeps it: the names are read from the modules' pieces. */
export interface StoredModuleDifference {
  moduleId: string;
  change: ModuleChange;
}

/** An `AskDifference` as a step keeps it. */
export interface StoredAskDifference {
  moduleId: string;
  stage: string;
  change: "ask" | "withdraw";
}

/** A `StateDifference` as a step keeps it. */
export interface StoredDifference {
  modulesEnabled: boolean | null;
  modules: StoredModuleDifference[];
  asks: StoredAskDifference[];
  units: StoredUnitDifference[];
  threads: StoredThreadDifference[];
}

function textOrNull(value: unknown, label: string): string | null {
  return value === null ? null : readText(value, label);
}

const UNIT_KINDS: readonly UnitState["kind"][] = ["item", "coverage", "impact"];

function address(value: unknown, label: string): Address {
  if (isAddress(value)) return value;
  throw new InvalidJsonError(`${label} must be a piece's address.`);
}

function addressOrNull(value: unknown, label: string): Address | null {
  return value === null ? null : address(value, label);
}

function places(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || !value.every((entry) => Number.isInteger(entry) && entry >= 0)) {
    throw new InvalidJsonError(`${label} must be a list of places.`);
  }
  return value;
}

function parseUnitDifference(value: unknown, label: string): StoredUnitDifference {
  const shared = ["moduleId", "stage", "unitId", "unitKind", "itemKind"];
  if (!isRecord(value)) throw new InvalidJsonError(`${label} must be an object.`);
  const keys = value.change === "add" ? [] : value.change === "change" ? ["content", "signature", "threads", "place", "itemNow"] : value.change === "remove" ? ["itemNow", "after"] : null;
  if (keys == null) throw new InvalidJsonError(`${label} must be an add, a change or a remove.`);
  const fields = exactRecord(value, label, ["change", ...shared, ...keys]);
  if (!UNIT_KINDS.includes(fields.unitKind as UnitState["kind"])) throw new InvalidJsonError(`${label} unitKind must be item, coverage or impact.`);
  const base = {
    moduleId: readText(fields.moduleId, `${label} moduleId`),
    stage: readText(fields.stage, `${label} stage`),
    unitId: readText(fields.unitId, `${label} unitId`),
    unitKind: fields.unitKind as UnitState["kind"],
    itemKind: textOrNull(fields.itemKind, `${label} itemKind`),
  };
  switch (fields.change) {
    case "add":
      return { ...base, change: "add" };
    case "remove":
      return { ...base, change: "remove", itemNow: address(fields.itemNow, `${label} itemNow`), after: textOrNull(fields.after, `${label} after`) };
    default: {
      const place = fields.place === null ? null : exactRecord(fields.place, `${label} place`, ["then", "now"]);
      return {
        ...base,
        change: "change",
        content: readFlag(fields.content, `${label} content`),
        signature: readFlag(fields.signature, `${label} signature`),
        threads: readFlag(fields.threads, `${label} threads`),
        place: place == null ? null : { then: readText(place.then, `${label} place then`), now: readText(place.now, `${label} place now`) },
        itemNow: addressOrNull(fields.itemNow, `${label} itemNow`),
      };
    }
  }
}

function parseThreadDifference(value: unknown, label: string): StoredThreadDifference {
  const fields = exactRecord(value, label, ["moduleId", "stage", "threadId", "earlier", "now", "messagesAdded", "messagesRemoved", "resolutionDiffers"]);
  const earlier = addressOrNull(fields.earlier, `${label} earlier`);
  const now = addressOrNull(fields.now, `${label} now`);
  if (earlier == null && now == null) throw new InvalidJsonError(`${label} must name the thread's piece in one of its states.`);
  return {
    moduleId: readText(fields.moduleId, `${label} moduleId`),
    stage: readText(fields.stage, `${label} stage`),
    threadId: readText(fields.threadId, `${label} threadId`),
    earlier,
    now,
    messagesAdded: places(fields.messagesAdded, `${label} messagesAdded`),
    messagesRemoved: places(fields.messagesRemoved, `${label} messagesRemoved`),
    resolutionDiffers: readFlag(fields.resolutionDiffers, `${label} resolutionDiffers`),
  };
}

const MODULE_CHANGES: readonly ModuleChange[] = ["add", "remove", "archive", "bring back", "rename"];

function parseModuleDifference(value: unknown, label: string): StoredModuleDifference {
  const fields = exactRecord(value, label, ["moduleId", "change"]);
  if (!MODULE_CHANGES.includes(fields.change as ModuleChange)) throw new InvalidJsonError(`${label} change must be one of ${MODULE_CHANGES.join(", ")}.`);
  return { moduleId: readText(fields.moduleId, `${label} moduleId`), change: fields.change as ModuleChange };
}

function parseAskDifference(value: unknown, label: string): StoredAskDifference {
  const fields = exactRecord(value, label, ["moduleId", "stage", "change"]);
  if (fields.change !== "ask" && fields.change !== "withdraw") throw new InvalidJsonError(`${label} change must be ask or withdraw.`);
  return { moduleId: readText(fields.moduleId, `${label} moduleId`), stage: readText(fields.stage, `${label} stage`), change: fields.change };
}

/** A difference as a step keeps it, read; throws what is wrong with it, naming `label`. */
export function parseStoredDifference(value: unknown, label: string): StoredDifference {
  const fields = exactRecord(value, label, ["modulesEnabled", "modules", "asks", "units", "threads"]);
  if (fields.modulesEnabled !== null && typeof fields.modulesEnabled !== "boolean") throw new InvalidJsonError(`${label} modulesEnabled must be true, false or null.`);
  for (const key of ["modules", "asks", "units", "threads"]) {
    if (!Array.isArray(fields[key])) throw new InvalidJsonError(`${label} ${key} must be a list.`);
  }
  return {
    modulesEnabled: fields.modulesEnabled,
    modules: (fields.modules as unknown[]).map((module, index) => parseModuleDifference(module, `${label} module ${index + 1}`)),
    asks: (fields.asks as unknown[]).map((ask, index) => parseAskDifference(ask, `${label} ask ${index + 1}`)),
    units: (fields.units as unknown[]).map((unit, index) => parseUnitDifference(unit, `${label} unit ${index + 1}`)),
    threads: (fields.threads as unknown[]).map((thread, index) => parseThreadDifference(thread, `${label} thread ${index + 1}`)),
  };
}

/** The value kept under a key, made when missing; the least recently used gives way past `limit`. */
function kept<Value>(values: Map<string, Value>, key: string, limit: number, make: () => Value): Value {
  let value = values.get(key);
  if (value == null) {
    value = make();
    if (values.size >= limit) values.delete(values.keys().next().value!);
  } else {
    values.delete(key);
  }
  values.set(key, value);
  return value;
}

/** The stages and modules whose pieces a comparer keeps read at most, across the states it compares. */
const KEPT_READS = 2_000;

/** The states no session shows whose models are kept at most, for the stages of one state read one after another. */
const KEPT_STATES = 4;

/** The model of a module a session shows, when it holds the module version given; null for one it does not show. */
export type LiveStoreOf = (module: ModulePieces) => Store | null;

/** The model of a module of the project now; null for a module it no longer holds. */
export type ModelNowOf = (moduleId: string) => Store | null;

/** One item of a stage's piece, read, with its piece's address. */
interface ItemRead {
  id: string;
  address: Address;
  item: StoredItem;
}

/** A stage's piece, read: its items in the order the stage holds them and in the order the page shows them, and the signatures on its coverages and impacts. */
interface StageRead {
  held: ItemRead[];
  shown: ItemRead[];
  coverages: Record<string, unknown>;
  impacts: Record<string, unknown>;
}

const NO_STAGE: StageRead = { held: [], shown: [], coverages: {}, impacts: {} };

/** A thread of a module version, read, with its piece's address. */
interface ThreadRead {
  address: Address;
  thread: Thread;
}

/**
 * A module version's threads, read: those on units by unit, in the order
 * the module holds them, and those on removed units by thread.
 */
interface ThreadsRead {
  byUnit: Map<string, ThreadRead[]>;
  removed: Map<string, ThreadRead>;
  /** The addresses of each stage's threads, joined, by stage. */
  stages: Map<string, string>;
}

/** What a comparison reads of an item as its content and as its signature: what differs for it to change. */
function contentOf(item: StoredItem): string {
  return serializeCanonical({ kind: item.kind, version: versionOf(item), phase: phaseOf(item.removal) });
}

function signatureOf(item: StoredItem): string {
  return serializeCanonical({ signature: item.signature, removal: item.removal });
}

function addressesOf(threads: readonly ThreadRead[] | undefined): string {
  return (threads ?? []).map(({ address }) => address).join(" ");
}

/**
 * The ids of `then`, with each id only `now` holds placed after the id both
 * hold that it follows in `now`, and after any placed there before it; each
 * with that id, null at the start.
 */
function placed(then: readonly string[], now: readonly string[]): { id: string; after: string | null }[] {
  const inThen = new Set(then);
  const order: { id: string; after: string | null }[] = then.map((id) => ({ id, after: null }));
  let previous: string | null = null;
  for (const id of now) {
    if (inThen.has(id)) {
      previous = id;
      continue;
    }
    const after = previous;
    const index = after == null ? -1 : order.findIndex((entry) => entry.id === after);
    let at = index + 1;
    while (at < order.length && !inThen.has(order[at]!.id) && order[at]!.after === after) at += 1;
    order.splice(at, 0, { id, after });
  }
  return order;
}

/**
 * Compares states of the project kept as pieces by what each stores, with
 * no model: a module or a stage held at one address in both states is the
 * same and is not read, and what a stage's piece or a module's threads hold
 * is read once and kept by its address. Undo and redo also read, from the
 * models that derive units, which units a change made wait for a signature
 * and which a stage shows, to place the focus.
 */
export class StateComparer {
  private readonly states = new Map<Address, SiblingModuleStores>();
  private readonly modules = new Map<Address, ModulePieces[]>();
  private readonly stages = new Map<string, StageRead>();
  private readonly threads = new Map<Address, ThreadsRead>();
  private readonly places = new Map<Address, Map<string, number>>();
  private readonly shown = new Map<string, string[]>();
  private readonly waiting = new Map<string, Set<string>>();

  constructor(private readonly pieces: PieceStore) {}

  /** The modules the page shows of the state at an address, archived ones left out, in order. */
  private modulesAt(address: Address): ModulePieces[] {
    return kept(this.modules, address, KEPT_READS, () => this.pieces.modulesAt(address).filter(({ archivedAt }) => archivedAt == null));
  }

  /**
   * A module's model in the state at an address: the one a session shows,
   * or one read from the state's pieces, linked to the state's other
   * modules as the project links its own.
   */
  private storeIn(state: Address, module: ModulePieces, live: LiveStoreOf): Store {
    const shown = live(module);
    if (shown != null) return shown;
    const models = kept(this.states, state, KEPT_STATES, () => {
      const linked = new SiblingModuleStores();
      linked.linkState(this.pieces.stateAt(state));
      return linked;
    });
    return models.storeOf(module.id)!;
  }

  /** A module version's stage, read from its piece; an empty one for a module the state lacks, or a stage the module holds none of. */
  private stageOf(module: ModulePieces | null, stage: string): StageRead {
    const address = module?.stages[stage];
    if (address == null) return NO_STAGE;
    return kept(this.stages, `${address} ${stage}`, KEPT_READS, () => {
      const read = this.pieces.stageAt(address);
      const held = read.items.map((itemAddress) => {
        const item = this.pieces.itemAt(itemAddress);
        return { id: item.id, address: itemAddress, item };
      });
      const shown = shownItemOrder(WORKFLOW.stage(stage).kinds, held.map(({ item }) => item)).map((item) => held.find(({ id }) => id === item.id)!);
      return { held, shown, coverages: read.coverages, impacts: read.impacts };
    });
  }

  private threadsOf(module: ModulePieces | null): ThreadsRead {
    if (module == null) return { byUnit: new Map(), removed: new Map(), stages: new Map() };
    return kept(this.threads, module.address, KEPT_READS, () => {
      const read: ThreadsRead = { byUnit: new Map(), removed: new Map(), stages: new Map() };
      for (const address of module.threads) {
        const thread = this.pieces.threadAt(address);
        if (thread.removedUnit == null) read.byUnit.set(thread.unitId, [...(read.byUnit.get(thread.unitId) ?? []), { address, thread }]);
        else read.removed.set(thread.id, { address, thread });
        read.stages.set(thread.stage, `${read.stages.get(thread.stage) ?? ""} ${address}`);
      }
      return read;
    });
  }

  /** Each item's place among a module version's items: by stage, then as its stage holds it. */
  private placesOf(module: ModulePieces): Map<string, number> {
    return kept(this.places, module.address, KEPT_READS, () => {
      const ids = WORKFLOW.stageIds.flatMap((stage) => this.stageOf(module, stage).held.map(({ id }) => id));
      return new Map(ids.map((id, place) => [id, place]));
    });
  }

  /** The stages of two versions of a module whose stored content or threads differ. */
  private stagesToCompare(from: ModulePieces | null, to: ModulePieces | null): string[] {
    if (from == null || to == null) return WORKFLOW.stageIds;
    const fromThreads = this.threadsOf(from).stages;
    const toThreads = this.threadsOf(to).stages;
    return WORKFLOW.stageIds.filter((stage) => from.stages[stage] !== to.stages[stage] || fromThreads.get(stage) !== toThreads.get(stage));
  }

  /**
   * The stages that may differ between the states at two addresses, each
   * with its module in both, in the order `to` shows its modules, then
   * those only `from` holds.
   */
  private stagePairs(from: Address, to: Address): StagePair[] {
    if (from === to) return [];
    const fromModules = this.modulesAt(from);
    const toModules = this.modulesAt(to);
    const fromById = new Map(fromModules.map((module) => [module.id, module]));
    const ordered = [...toModules, ...fromModules.filter(({ id }) => !toModules.some((module) => module.id === id))];
    return ordered.flatMap((shown) => {
      const fromModule = fromById.get(shown.id) ?? null;
      const toModule = toModules.find(({ id }) => id === shown.id) ?? null;
      if (fromModule?.address === toModule?.address) return [];
      return this.stagesToCompare(fromModule, toModule).map((stage) => ({ moduleId: shown.id, stage, fromModule, toModule }));
    });
  }

  /** What going from `now` to `then` adds, changes or removes in one stage, items first, in the order `then` shows them, then coverages and impacts. */
  private stageDifference({ moduleId, stage, fromModule: nowModule, toModule: thenModule }: StagePair): StoredUnitDifference[] {
    const now = this.stageOf(nowModule, stage);
    const then = this.stageOf(thenModule, stage);
    const threadsNow = this.threadsOf(nowModule).byUnit;
    const threadsThen = this.threadsOf(thenModule).byUnit;
    const threadsDiffer = (unitId: string) => addressesOf(threadsNow.get(unitId)) !== addressesOf(threadsThen.get(unitId));
    const nowById = new Map(now.shown.map((read) => [read.id, read]));
    const thenById = new Map(then.shown.map((read) => [read.id, read]));
    const sharedThen = then.shown.filter(({ id }) => nowById.has(id)).map(({ id }) => id);
    const sharedNow = now.shown.filter(({ id }) => thenById.has(id)).map(({ id }) => id);
    const codeIn = (stageRead: StageRead, read: ItemRead) => WORKFLOW.codeOf(read.item, stageRead.held.map(({ item }) => item));
    const items = placed(
      then.shown.map(({ id }) => id),
      now.shown.map(({ id }) => id),
    ).flatMap(({ id, after }): StoredUnitDifference[] => {
      const inNow = nowById.get(id);
      const inThen = thenById.get(id);
      const base = { moduleId, stage, unitId: id, unitKind: "item" as const, itemKind: (inThen ?? inNow)!.item.kind };
      if (inNow == null) return [{ ...base, change: "add" }];
      if (inThen == null) return [{ ...base, change: "remove", itemNow: inNow.address, after }];
      const moved = sharedThen.indexOf(id) !== sharedNow.indexOf(id);
      const content = contentOf(inNow.item) !== contentOf(inThen.item);
      const signature = signatureOf(inNow.item) !== signatureOf(inThen.item);
      const threads = threadsDiffer(id);
      if (!moved && !content && !signature && !threads) return [];
      return [
        {
          ...base,
          change: "change",
          content,
          signature,
          threads,
          place: moved ? { then: codeIn(then, inThen), now: codeIn(now, inNow) } : null,
          itemNow: content ? inNow.address : null,
        },
      ];
    });
    const placeOf = (itemId: string) =>
      (thenModule == null ? undefined : this.placesOf(thenModule).get(itemId)) ?? (nowModule == null ? undefined : this.placesOf(nowModule).get(itemId)) ?? Number.POSITIVE_INFINITY;
    const signed = (kind: "coverage" | "impact", unitIdOf: (stage: string, itemId: string) => string): StoredUnitDifference[] => {
      const signatures = (read: StageRead) => (kind === "coverage" ? read.coverages : read.impacts);
      const onThreads = [...threadsNow.keys(), ...threadsThen.keys()].flatMap((unitId) => {
        const address = parseUnitId(unitId);
        return address.kind === kind && address.stage === stage ? [address.itemId] : [];
      });
      const itemIds = [...new Set([...Object.keys(signatures(now)), ...Object.keys(signatures(then)), ...onThreads])];
      return itemIds
        .sort((left, right) => placeOf(left) - placeOf(right) || left.localeCompare(right))
        .flatMap((itemId): StoredUnitDifference[] => {
          const unitId = unitIdOf(stage, itemId);
          const signature = serializeCanonical(signatures(now)[itemId] ?? null) !== serializeCanonical(signatures(then)[itemId] ?? null);
          const threads = threadsDiffer(unitId);
          if (!signature && !threads) return [];
          return [{ moduleId, stage, unitId, unitKind: kind, itemKind: null, change: "change", content: false, signature, threads, place: null, itemNow: null }];
        });
    };
    return [...items, ...signed("coverage", coverageUnitId), ...signed("impact", impactUnitId)];
  }

  /** The threads on removed units of one stage whose messages or resolution differ between `now` and `then`. */
  private threadDifferences({ moduleId, stage, fromModule: nowModule, toModule: thenModule }: StagePair): StoredThreadDifference[] {
    const now = this.threadsOf(nowModule).removed;
    const then = this.threadsOf(thenModule).removed;
    // A thread on an item either state holds is that item's.
    const holds = (unitId: string) => [nowModule, thenModule].some((module) => this.stageOf(module, stage).held.some(({ id }) => id === unitId));
    return [...new Set([...then.keys(), ...now.keys()])].flatMap((threadId): StoredThreadDifference[] => {
      const inThen = then.get(threadId) ?? null;
      const inNow = now.get(threadId) ?? null;
      const shown = (inThen ?? inNow)!.thread;
      if (shown.stage !== stage || holds(shown.unitId)) return [];
      const messages = (read: ThreadRead | null) => read?.thread.messages.map((message) => serializeCanonical(message)) ?? [];
      const only = (read: ThreadRead | null, other: ThreadRead | null) => {
        const others = messages(other);
        return messages(read).flatMap((message, index) => (others.includes(message) ? [] : [index]));
      };
      const messagesAdded = only(inThen, inNow);
      const messagesRemoved = only(inNow, inThen);
      const resolutionDiffers = serializeCanonical(inThen?.thread.resolution ?? null) !== serializeCanonical(inNow?.thread.resolution ?? null);
      if (messagesAdded.length === 0 && messagesRemoved.length === 0 && !resolutionDiffers) return [];
      return [{ moduleId, stage, threadId, earlier: inThen?.address ?? null, now: inNow?.address ?? null, messagesAdded, messagesRemoved, resolutionDiffers }];
    });
  }

  /**
   * How the state at `there` differs from the one at `here`: what going
   * from `here` to `there` adds, changes or removes. Its names read as the
   * project names its items now, `now`; what a step changed is the same
   * comparison from its state before to its state after.
   */
  difference(here: Address, there: Address, now: ModelNowOf): StateDifference {
    return this.described(here, there, this.stored(here, there), now);
  }

  /** `difference`, as a step keeps it. */
  stored(here: Address, there: Address): StoredDifference {
    const pairs = this.stagePairs(here, there);
    const enabledThen = this.pieces.modulesEnabledAt(there);
    return {
      modulesEnabled: here !== there && enabledThen !== this.pieces.modulesEnabledAt(here) ? enabledThen : null,
      ...this.moduleDifferences(here, there),
      units: pairs.flatMap((pair) => this.stageDifference(pair)),
      threads: pairs.flatMap((pair) => this.threadDifferences(pair)),
    };
  }

  /**
   * What going from `here` to `there` does to the project's modules, in the
   * order `there` holds them, then those only `here` holds, and to the
   * stages asked of the coding agent: a stage `there` asks for and `here`
   * does not, or asks for again, is asked; one only `here` asks for is withdrawn.
   */
  private moduleDifferences(here: Address, there: Address): Pick<StoredDifference, "modules" | "asks"> {
    if (here === there) return { modules: [], asks: [] };
    const now = this.pieces.modulesAt(here);
    const then = this.pieces.modulesAt(there);
    const nowById = new Map(now.map((module) => [module.id, module]));
    const thenIds = new Set(then.map(({ id }) => id));
    const modules: StoredModuleDifference[] = [];
    const asks: StoredAskDifference[] = [];
    for (const entry of [...then, ...now.filter(({ id }) => !thenIds.has(id))]) {
      const inNow = nowById.get(entry.id) ?? null;
      const inThen = thenIds.has(entry.id) ? entry : null;
      const moduleId = entry.id;
      if (inNow == null) modules.push({ moduleId, change: "add" });
      else if (inThen == null) modules.push({ moduleId, change: "remove" });
      else {
        if (inThen.archivedAt != null && inNow.archivedAt == null) modules.push({ moduleId, change: "archive" });
        if (inThen.archivedAt == null && inNow.archivedAt != null) modules.push({ moduleId, change: "bring back" });
        if (inThen.name !== inNow.name) modules.push({ moduleId, change: "rename" });
      }
      const askedNow = new Map((inNow?.writingAsked ?? []).map(({ stage, at }) => [stage, at]));
      const askedThen = new Map((inThen?.writingAsked ?? []).map(({ stage, at }) => [stage, at]));
      for (const [stage, at] of askedThen) if (askedNow.get(stage) !== at) asks.push({ moduleId, stage, change: "ask" });
      for (const stage of askedNow.keys()) if (!askedThen.has(stage)) asks.push({ moduleId, stage, change: "withdraw" });
    }
    return { modules, asks };
  }

  /**
   * A difference a step keeps, with what it names read from the pieces of
   * the states at `here` and `there`, and each unit and item text named as
   * `now`, the project now, names it: a unit it no longer holds is a
   * removed item.
   */
  described(here: Address, there: Address, stored: StoredDifference, now: ModelNowOf): StateDifference {
    const allThen = this.pieces.modulesAt(there);
    const allNow = this.pieces.modulesAt(here);
    const named = (moduleId: string) => {
      const inNow = allNow.find(({ id }) => id === moduleId);
      const inThen = allThen.find(({ id }) => id === moduleId);
      return { nameNow: (inNow ?? inThen)!.name, nameThen: (inThen ?? inNow)!.name };
    };
    const modules = stored.modules.map((module): ModuleDifference => ({ ...module, ...named(module.moduleId) }));
    const asks = stored.asks.map((ask): AskDifference => ({ ...ask, module: named(ask.moduleId).nameThen }));
    const modulesThen = this.modulesAt(there);
    const modulesNow = this.modulesAt(here);
    // Named as the earlier state names it, or as the project does now for a module only it holds.
    const moduleName = (moduleId: string) => (modulesThen.find(({ id }) => id === moduleId) ?? modulesNow.find(({ id }) => id === moduleId))!.name;
    /** The model that names a module's units: the project's now, or, for a module it no longer holds, the one `here` holds. */
    const namer = (moduleId: string) => now(moduleId) ?? this.storeIn(here, modulesNow.find(({ id }) => id === moduleId)!, () => null);
    const units = stored.units.map((unit): UnitDifference => {
      const named = { ...unit, module: moduleName(unit.moduleId), label: now(unit.moduleId)?.unitLabel(unit.unitId) ?? "a removed item" };
      switch (named.change) {
        case "add":
          return named;
        case "remove": {
          const { itemNow, ...change } = named;
          const item = this.pieces.itemAt(itemNow);
          return { ...change, textNow: namer(unit.moduleId).shownText(item.kind, item.content) };
        }
        case "change": {
          const { itemNow, ...change } = named;
          return { ...change, versionNow: itemNow == null ? null : versionOf(this.pieces.itemAt(itemNow)) };
        }
      }
    });
    const threads = stored.threads.map((thread): ThreadDifference => {
      const earlier = thread.earlier == null ? null : this.pieces.threadAt(thread.earlier);
      const current = thread.now == null ? null : this.pieces.threadAt(thread.now);
      const shown = (earlier ?? current)!;
      const texts = (of: Thread | null, places: readonly number[]) => places.map((place) => of!.messages[place]!.text);
      return {
        moduleId: thread.moduleId,
        module: moduleName(thread.moduleId),
        stage: thread.stage,
        threadId: thread.threadId,
        unitId: shown.unitId,
        label: shown.removedUnit?.name ?? "a removed item",
        text: shown.removedUnit?.text ?? "",
        messagesAdded: texts(earlier, thread.messagesAdded),
        messagesRemoved: texts(current, thread.messagesRemoved),
        resolutionDiffers: thread.resolutionDiffers,
        onlyNow: earlier == null,
      };
    });
    return { same: here === there, modulesEnabled: stored.modulesEnabled, modules, asks, units, threads };
  }

  /** The units a module's stage shows in the state at an address, in order, and those of them that wait for a signature, read once. */
  private shownOf(state: Address, module: ModulePieces, stage: string, live: LiveStoreOf): { shown: string[]; waiting: Set<string> } {
    const key = `${state} ${module.id} ${stage}`;
    const known = this.shown.get(key);
    if (known != null) return { shown: known, waiting: this.waiting.get(key)! };
    const store = this.storeIn(state, module, live);
    const units = store.unitsInShownOrder(stage);
    const shown = kept(this.shown, key, KEPT_READS, () => units.map(({ unitId }) => unitId));
    const waiting = kept(this.waiting, key, KEPT_READS, () => new Set(units.filter((unit) => store.waitsForSignature(unit)).map(({ unitId }) => unitId)));
    return { shown, waiting };
  }

  /**
   * Read what a move from `from` to `to` needs of `from`, while `live`
   * still shows `from`, so that it is not read again from pieces once
   * `live` shows `to`.
   */
  prepare(from: Address, to: Address, live: LiveStoreOf): void {
    for (const { stage, fromModule } of this.stagePairs(from, to)) {
      if (fromModule != null) this.shownOf(from, fromModule, stage, live);
    }
  }

  /** The units a module's stage shows in the state at an address, in order; null when that state shows no such module or stage. */
  shownUnits(address: Address, moduleId: string, stage: string, live: LiveStoreOf): string[] | null {
    const pieces = this.modulesAt(address).find(({ id }) => id === moduleId);
    if (pieces == null || !WORKFLOW.isStage(stage)) return null;
    return this.shownOf(address, pieces, stage, live).shown;
  }

  /**
   * The units a change from the state at `before` to the one at `after` was
   * made on: those it added, removed or changed, in the order the modules
   * and stages of `after` show them; and the units of the stages it changed
   * that it made wait for a signature, in the order they show.
   */
  unitsChanged(before: Address, after: Address, live: LiveStoreOf): { madeOn: ChangedUnit[]; madeWait: ChangedUnit[] } {
    const pairs = this.stagePairs(before, after);
    const madeOn = pairs.flatMap((pair) => this.stageDifference(pair)).map(({ moduleId, stage, unitId }) => ({ moduleId, stage, unitId }));
    const madeWait = pairs.flatMap(({ moduleId, stage, fromModule, toModule }) => {
      if (toModule == null) return [];
      const waitedBefore = fromModule == null ? new Set<string>() : this.shownOf(before, fromModule, stage, live).waiting;
      const { shown, waiting } = this.shownOf(after, toModule, stage, live);
      return shown.filter((unitId) => waiting.has(unitId) && !waitedBefore.has(unitId)).map((unitId) => ({ moduleId, stage, unitId }));
    });
    return { madeOn, madeWait };
  }
}

/** A stage whose units may differ between two states, with its module in each; null where a state lacks the module. */
interface StagePair {
  moduleId: string;
  stage: string;
  fromModule: ModulePieces | null;
  toModule: ModulePieces | null;
}

/** A unit a change was made on. */
export interface ChangedUnit {
  moduleId: string;
  stage: string;
  unitId: string;
}
