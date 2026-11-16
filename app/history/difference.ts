import { exactRecord, InvalidJsonError, isRecord, readFlag, readText } from "lib/json";
import { type Address, isAddress, type ModulePieces, type PieceStore, serializeCanonical } from "storage";
import { createModuleStore, type Store, WORKFLOW } from "store";
import { type ItemVersion, type Thread, type UnitState, versionOf } from "workflow";

/** One item, coverage or impact of a stage as a comparison of two states reads it. */
interface UnitPrint {
  unitId: string;
  unitKind: UnitState["kind"];
  /** The item it is or is on. */
  itemId: string;
  /** The kind of the item it is, or null for a coverage or an impact. */
  itemKind: string | null;
  /** As the page names it, such as "REQ-03" or "coverage of REQ-03". */
  label: string;
  /** What it holds apart from its signatures and threads. */
  content: string;
  signature: string;
  threads: string;
  waits: boolean;
}

function printsOf(store: Store, stage: string): UnitPrint[] {
  return store.unitsInShownOrder(stage).map((unit): UnitPrint => {
    const common = {
      unitId: unit.unitId,
      unitKind: unit.kind,
      itemId: unit.itemId,
      label: store.unitLabel(unit.unitId),
      threads: serializeCanonical(store.threadsOf(unit.unitId)),
      waits: store.waitsForSignature(unit),
    };
    switch (unit.kind) {
      case "item":
        return {
          ...common,
          itemKind: unit.itemKind,
          content: serializeCanonical({ kind: unit.itemKind, version: unit.version, phase: unit.phase }),
          signature: serializeCanonical({ signature: unit.signature, removal: store.locate(unit.itemId)?.item.removal ?? null }),
        };
      case "coverage":
        return { ...common, itemKind: null, content: "", signature: serializeCanonical(unit.signature) };
      case "impact":
        return {
          ...common,
          itemKind: null,
          content: serializeCanonical({ before: unit.before, after: unit.after }),
          signature: serializeCanonical(unit.signature),
        };
    }
  });
}

/** A thread of a stage on a unit gone from it, as a comparison of two states reads it. */
interface OrphanThreadPrint {
  threadId: string;
  unitId: string;
  messages: string[];
  resolution: string;
}

function orphanThreadsOf(store: Store, stage: string): OrphanThreadPrint[] {
  return store
    .threadsOfStage(stage)
    .filter(({ unitId }) => store.unitState(unitId) == null)
    .map((thread: Thread) => ({
      threadId: thread.id,
      unitId: thread.unitId,
      messages: thread.messages.map((message) => serializeCanonical(message)),
      resolution: serializeCanonical(thread.resolution),
    }));
}

/** What bringing an earlier state back would do to one item, coverage or impact. */
export type UnitChange =
  | { change: "add" }
  | {
      change: "change";
      /** What differs: its content, its signatures, its threads. */
      content: boolean;
      signature: boolean;
      threads: boolean;
      /** For an item in another place in its stage: its label there and now. */
      place: { then: string; now: string } | null;
      /** For an item whose content differs, its version now, to show how the earlier one differs. */
      versionNow: ItemVersion | null;
    }
  | {
      change: "remove";
      /** Its text now, which the earlier state lacks. */
      textNow: string;
      /** The unit of the earlier state that comes before it now; null at the start of its stage. */
      after: string | null;
    };

/**
 * One item, coverage or impact that bringing an earlier state back would
 * add, change or remove, named by its module, its stage and its label, as
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
  /** Its place among the units the earlier state's stage shows, with those it would remove where the project shows them now. */
  position: number;
};

/**
 * A thread on a unit that neither an earlier state nor the project now
 * holds, whose messages or resolution bringing that state back would
 * change: the messages only one of the two holds.
 */
export interface ThreadDifference {
  moduleId: string;
  module: string;
  stage: string;
  threadId: string;
  /** The unit it was on, which neither state holds. */
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
 * How an earlier state differs from the project now, unit by unit and then
 * thread by thread on units neither holds, in the order the modules and
 * stages show them. `same` is false also for a difference neither shows,
 * such as a module's name.
 */
export interface StateDifference {
  same: boolean;
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
      /** The piece of the item it is or is on, as it is now. */
      itemNow: Address;
      after: string | null;
    }
) & {
  moduleId: string;
  stage: string;
  unitId: string;
  unitKind: UnitState["kind"];
  itemKind: string | null;
  position: number;
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

/** A `StateDifference` as a step keeps it. */
export interface StoredDifference {
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
  const shared = ["moduleId", "stage", "unitId", "unitKind", "itemKind", "position"];
  if (!isRecord(value)) throw new InvalidJsonError(`${label} must be an object.`);
  const keys = value.change === "add" ? [] : value.change === "change" ? ["content", "signature", "threads", "place", "itemNow"] : value.change === "remove" ? ["itemNow", "after"] : null;
  if (keys == null) throw new InvalidJsonError(`${label} must be an add, a change or a remove.`);
  const fields = exactRecord(value, label, ["change", ...shared, ...keys]);
  if (!UNIT_KINDS.includes(fields.unitKind as UnitState["kind"])) throw new InvalidJsonError(`${label} unitKind must be item, coverage or impact.`);
  if (typeof fields.position !== "number") throw new InvalidJsonError(`${label} position must be a number.`);
  const base = {
    moduleId: readText(fields.moduleId, `${label} moduleId`),
    stage: readText(fields.stage, `${label} stage`),
    unitId: readText(fields.unitId, `${label} unitId`),
    unitKind: fields.unitKind as UnitState["kind"],
    itemKind: textOrNull(fields.itemKind, `${label} itemKind`),
    position: fields.position,
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

/** A difference as a step keeps it, read; throws what is wrong with it, naming `label`. */
export function parseStoredDifference(value: unknown, label: string): StoredDifference {
  const fields = exactRecord(value, label, ["units", "threads"]);
  if (!Array.isArray(fields.units)) throw new InvalidJsonError(`${label} units must be a list.`);
  if (!Array.isArray(fields.threads)) throw new InvalidJsonError(`${label} threads must be a list.`);
  return {
    units: fields.units.map((unit, index) => parseUnitDifference(unit, `${label} unit ${index + 1}`)),
    threads: fields.threads.map((thread, index) => parseThreadDifference(thread, `${label} thread ${index + 1}`)),
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

/** How one unit compares between two states, `from` and `to`. */
interface UnitComparison {
  moduleId: string;
  module: string;
  stage: string;
  from: UnitPrint | null;
  to: UnitPrint | null;
  /** Shown in another order among the units both states show. */
  moved: boolean;
  /** Its place among the units `to` shows, with those only `from` shows where `from` shows them. */
  position: number;
  /** For a unit only `from` shows: the unit both show that comes before it in `from`. */
  after: string | null;
}

/** The ids of the given prints that the other list holds too, in order. */
function sharedIds(prints: readonly UnitPrint[], others: ReadonlySet<string>): string[] {
  return prints.map(({ unitId }) => unitId).filter((unitId) => others.has(unitId));
}

function compareStage(moduleId: string, module: string, stage: string, from: readonly UnitPrint[], to: readonly UnitPrint[]): UnitComparison[] {
  const fromById = new Map(from.map((print) => [print.unitId, print]));
  const toById = new Map(to.map((print) => [print.unitId, print]));
  const fromShared = sharedIds(from, new Set(toById.keys()));
  const toShared = sharedIds(to, new Set(fromById.keys()));
  const fromIndex = new Map(fromShared.map((unitId, index) => [unitId, index]));
  const sharedIndex = new Map(toShared.map((unitId, index) => [unitId, index]));
  // The units of `to`, with each unit only `from` shows after the unit both show that it follows in `from`.
  const placed: { unitId: string; after: string | null }[] = to.map(({ unitId }) => ({ unitId, after: null }));
  let previous: string | null = null;
  const onlyFrom: { unitId: string; after: string | null }[] = [];
  for (const { unitId } of from) {
    if (toById.has(unitId)) previous = unitId;
    else onlyFrom.push({ unitId, after: previous });
  }
  for (const entry of onlyFrom) {
    const index = entry.after == null ? -1 : placed.findIndex(({ unitId }) => unitId === entry.after);
    // After the unit it follows and after any other unit placed there before it.
    let at = index + 1;
    while (at < placed.length && !toById.has(placed[at]!.unitId) && placed[at]!.after === entry.after) at += 1;
    placed.splice(at, 0, entry);
  }
  return placed.map(({ unitId, after }, position) => ({
    moduleId,
    module,
    stage,
    from: fromById.get(unitId) ?? null,
    to: toById.get(unitId) ?? null,
    moved: fromIndex.has(unitId) && sharedIndex.has(unitId) && fromIndex.get(unitId) !== sharedIndex.get(unitId),
    position,
    after,
  }));
}

function differs(comparison: UnitComparison): boolean {
  const { from, to } = comparison;
  return from == null || to == null || from.content !== to.content || from.signature !== to.signature || from.threads !== to.threads;
}

/** The stages whose prints are kept at most, across the states a session compares. */
const KEPT_PRINTS = 2_000;

/** The models of modules no session shows that are kept at most, for the stages of one module version read one after another. */
const KEPT_STORES = 8;

/** The model of a module a session shows, when it holds the module version given; null for one it does not show. */
export type LiveStoreOf = (module: ModulePieces) => Store | null;

/** The model of a module of the project now; null for a module it no longer holds. */
export type ModelNowOf = (moduleId: string) => Store | null;

/**
 * Compares states of the project kept as pieces, unit by unit, with the
 * one model that derives units. A module or a stage held at one address in
 * both states is the same and is not read; a stage is read only where it,
 * a stage it builds on or its threads differ. What a module version's
 * stage holds is read once and kept by its address.
 */
export class StateComparer {
  private readonly prints = new Map<string, UnitPrint[]>();
  private readonly orphanPrints = new Map<string, OrphanThreadPrint[]>();
  private readonly stores = new Map<Address, Store>();
  private readonly modules = new Map<Address, ModulePieces[]>();
  private readonly threadStages = new Map<Address, string>();
  private readonly itemPieces = new Map<Address, Map<string, Address>>();
  private readonly threadPieces = new Map<Address, Map<string, Address>>();

  constructor(private readonly pieces: PieceStore) {}

  /** The modules the page shows of the state at an address, archived ones left out, in order. */
  private modulesAt(address: Address): ModulePieces[] {
    return kept(this.modules, address, KEPT_PRINTS, () => this.pieces.modulesAt(address).filter(({ archivedAt }) => archivedAt == null));
  }

  /** A module version's model: the one a session shows, or one read from its pieces. */
  private storeOf(module: ModulePieces, live: LiveStoreOf): Store {
    const shown = live(module);
    if (shown != null) return shown;
    return kept(this.stores, module.address, KEPT_STORES, () => createModuleStore(this.pieces.moduleAt(module.address).content));
  }

  private stagePrints(module: ModulePieces, stage: string, live: LiveStoreOf): UnitPrint[] {
    return kept(this.prints, `${module.address} ${stage}`, KEPT_PRINTS, () => printsOf(this.storeOf(module, live), stage));
  }

  private stageOrphanThreads(module: ModulePieces, stage: string, live: LiveStoreOf): OrphanThreadPrint[] {
    return kept(this.orphanPrints, `${module.address} ${stage}`, KEPT_PRINTS, () => orphanThreadsOf(this.storeOf(module, live), stage));
  }

  private threadStage(address: Address): string {
    let stage = this.threadStages.get(address);
    if (stage == null) {
      stage = this.pieces.threadAt(address).stage;
      this.threadStages.set(address, stage);
    }
    return stage;
  }

  /** The piece of an item a stage's piece holds, by the item's id. */
  private itemPiece(stageAddress: Address, itemId: string): Address | null {
    const byId = kept(this.itemPieces, stageAddress, KEPT_PRINTS, () => {
      const addresses = this.pieces.stageItemsAt(stageAddress);
      return new Map(addresses.map((address) => [this.pieces.itemAt(address).id, address]));
    });
    return byId.get(itemId) ?? null;
  }

  /** The piece of an item a module version holds, by the item's id, in whichever stage holds it. */
  private itemPieceIn(module: ModulePieces, itemId: string): Address | null {
    for (const stageAddress of Object.values(module.stages)) {
      const found = this.itemPiece(stageAddress, itemId);
      if (found != null) return found;
    }
    return null;
  }

  /** The piece of a thread a module version holds, by the thread's id. */
  private threadPiece(module: ModulePieces | null, threadId: string): Address | null {
    if (module == null) return null;
    const byId = kept(this.threadPieces, module.address, KEPT_PRINTS, () => new Map(module.threads.map((address) => [this.pieces.threadAt(address).id, address])));
    return byId.get(threadId) ?? null;
  }

  /** The stages of two versions of a module whose units may differ. */
  private stagesToCompare(from: ModulePieces | null, to: ModulePieces | null): string[] {
    if (from == null || to == null) return WORKFLOW.stageIds;
    const threadsOf = (module: ModulePieces, stage: string) =>
      module.threads.filter((address) => this.threadStage(address) === stage).sort().join(" ");
    const contentChanged = new Set(WORKFLOW.stageIds.filter((stage) => from.stages[stage] !== to.stages[stage]));
    return WORKFLOW.stageIds.filter(
      (stage) =>
        contentChanged.has(stage) ||
        WORKFLOW.upstreamStages(stage).some((upstream) => contentChanged.has(upstream)) ||
        threadsOf(from, stage) !== threadsOf(to, stage),
    );
  }

  /**
   * How each unit compares between the states at two addresses, in the
   * order `to` shows its modules, then those only `from` holds.
   */
  private compare(from: Address, to: Address, live: LiveStoreOf): UnitComparison[] {
    const prints = (module: ModulePieces | null, stage: string) => (module == null ? [] : this.stagePrints(module, stage, live));
    return this.stagePairs(from, to).flatMap(({ moduleId, module, stage, fromModule, toModule }) =>
      compareStage(moduleId, module, stage, prints(fromModule, stage), prints(toModule, stage)),
    );
  }

  /**
   * The stages whose units may differ between the states at two addresses,
   * each with its module in both, in the order `to` shows its modules, then
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
      return this.stagesToCompare(fromModule, toModule).map((stage) => ({ moduleId: shown.id, module: shown.name, stage, fromModule, toModule }));
    });
  }

  /** The threads on units neither the state at `here` nor the one at `there` holds that differ between them. */
  private threadDifferences(here: Address, there: Address, live: LiveStoreOf): StoredThreadDifference[] {
    return this.stagePairs(here, there).flatMap(({ moduleId, stage, fromModule: nowModule, toModule: earlierModule }) => {
      const orphans = (pieces: ModulePieces | null) => (pieces == null ? [] : this.stageOrphanThreads(pieces, stage, live));
      const holds = (pieces: ModulePieces | null, unitId: string) => pieces != null && this.storeOf(pieces, live).unitState(unitId) != null;
      const now = new Map(orphans(nowModule).map((print) => [print.threadId, print]));
      const earlier = new Map(orphans(earlierModule).map((print) => [print.threadId, print]));
      return [...new Set([...earlier.keys(), ...now.keys()])].flatMap((threadId): StoredThreadDifference[] => {
        const then = earlier.get(threadId) ?? null;
        const current = now.get(threadId) ?? null;
        const shown = (then ?? current)!;
        if (holds(nowModule, shown.unitId) || holds(earlierModule, shown.unitId)) return [];
        const only = (print: OrphanThreadPrint | null, other: OrphanThreadPrint | null) =>
          print == null ? [] : print.messages.flatMap((message, index) => (other?.messages.includes(message) ?? false ? [] : [index]));
        const messagesAdded = only(then, current);
        const messagesRemoved = only(current, then);
        const resolutionDiffers = (then?.resolution ?? null) !== (current?.resolution ?? null);
        if (messagesAdded.length === 0 && messagesRemoved.length === 0 && !resolutionDiffers) return [];
        return [
          {
            moduleId,
            stage,
            threadId,
            earlier: then == null ? null : this.threadPiece(earlierModule, threadId),
            now: current == null ? null : this.threadPiece(nowModule, threadId),
            messagesAdded,
            messagesRemoved,
            resolutionDiffers,
          },
        ];
      });
    });
  }

  /**
   * Read what a comparison of `from` with `to` reads of `from`, while
   * `live` still shows `from`, so that it is not read again from pieces
   * once `live` shows `to`.
   */
  prepare(from: Address, to: Address, live: LiveStoreOf): void {
    if (from === to) return;
    const toModules = new Map(this.modulesAt(to).map((pieces) => [pieces.id, pieces]));
    for (const pieces of this.modulesAt(from)) {
      const other = toModules.get(pieces.id) ?? null;
      if (other?.address === pieces.address) continue;
      for (const stage of this.stagesToCompare(pieces, other)) {
        this.stagePrints(pieces, stage, live);
        this.stageOrphanThreads(pieces, stage, live);
      }
    }
  }

  /** The units a module's stage shows in the state at an address, in order; null when that state shows no such module or stage. */
  shownUnits(address: Address, moduleId: string, stage: string, live: LiveStoreOf): string[] | null {
    const pieces = this.modulesAt(address).find(({ id }) => id === moduleId);
    if (pieces == null || !WORKFLOW.isStage(stage)) return null;
    return this.stagePrints(pieces, stage, live).map(({ unitId }) => unitId);
  }

  /** How each unit that differs between the states at two addresses compares, in the order `to` shows them. */
  private changes(from: Address, to: Address, live: LiveStoreOf): UnitComparison[] {
    return this.compare(from, to, live).filter((comparison) => comparison.moved || differs(comparison));
  }

  /**
   * How the state at `there` differs from the one at `here`: what going
   * from `here` to `there` adds, changes or removes. Its names read for an
   * earlier state, at `there`, and the project now, at `here`; what a step
   * changed is the same comparison from its state before to its state after.
   */
  difference(here: Address, there: Address, live: LiveStoreOf, now: ModelNowOf): StateDifference {
    return this.described(here, there, this.stored(here, there, live), now);
  }

  /** `difference`, as a step keeps it. */
  stored(here: Address, there: Address, live: LiveStoreOf): StoredDifference {
    const modulesNow = new Map(this.modulesAt(here).map((pieces) => [pieces.id, pieces]));
    const units = this.changes(here, there, live).map((comparison): StoredUnitDifference => {
      const { from: now, to: earlier, moduleId, stage, position } = comparison;
      const shown = (earlier ?? now)!;
      const base = { moduleId, stage, unitId: shown.unitId, unitKind: shown.unitKind, itemKind: shown.itemKind, position };
      if (now == null) return { ...base, change: "add" };
      const moduleNow = modulesNow.get(moduleId)!;
      if (earlier == null) return { ...base, change: "remove", itemNow: this.itemPieceIn(moduleNow, now.itemId)!, after: comparison.after };
      const content = now.content !== earlier.content;
      const stageNow = moduleNow.stages[stage]!;
      return {
        ...base,
        change: "change",
        content,
        signature: now.signature !== earlier.signature,
        threads: now.threads !== earlier.threads,
        place: comparison.moved ? { then: earlier.label, now: now.label } : null,
        itemNow: content && now.unitKind === "item" ? this.itemPiece(stageNow, now.itemId) : null,
      };
    });
    return { units, threads: this.threadDifferences(here, there, live) };
  }

  /**
   * A difference a step keeps, with what it names read from the pieces of
   * the states at `here` and `there`, and each unit and item text named as
   * `now`, the project now, names it: a unit it no longer holds is a
   * removed item.
   */
  described(here: Address, there: Address, stored: StoredDifference, now: ModelNowOf): StateDifference {
    const modulesThen = this.modulesAt(there);
    const modulesNow = this.modulesAt(here);
    // Named as the earlier state names it, or as the project does now for a module only it holds.
    const moduleName = (moduleId: string) => (modulesThen.find(({ id }) => id === moduleId) ?? modulesNow.find(({ id }) => id === moduleId))!.name;
    /** The model that names a module's units: the project's now, or, for a module it no longer holds, the one `here` holds. */
    const namer = (moduleId: string) => now(moduleId) ?? this.storeOf(modulesNow.find(({ id }) => id === moduleId)!, () => null);
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
      const now = thread.now == null ? null : this.pieces.threadAt(thread.now);
      const shown = (earlier ?? now)!;
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
        messagesRemoved: texts(now, thread.messagesRemoved),
        resolutionDiffers: thread.resolutionDiffers,
        onlyNow: earlier == null,
      };
    });
    return { same: here === there, units, threads };
  }

  /**
   * The units a change from the state at `before` to the one at `after` was
   * made on: those it added, removed, changed or moved, in the order the
   * modules and stages of `after` show them; and of those, the ones it made
   * wait for a signature.
   */
  unitsChanged(before: Address, after: Address, live: LiveStoreOf): { madeOn: ChangedUnit[]; madeWait: ChangedUnit[] } {
    const changed = this.changes(before, after, live);
    const place = ({ moduleId, stage, from, to }: UnitComparison): ChangedUnit => ({ moduleId, stage, unitId: (to ?? from)!.unitId });
    return {
      madeOn: changed.map(place),
      madeWait: changed.filter(({ from, to }) => to?.waits === true && from?.waits !== true).map(place),
    };
  }
}

/** A stage whose units may differ between two states, with its module in each; null where a state lacks the module. */
interface StagePair {
  moduleId: string;
  module: string;
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
