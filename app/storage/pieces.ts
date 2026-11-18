import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { isRecord, parseJson } from "lib/json";
import type { Thread } from "workflow";

import { serializeCanonical } from "./canonicalJson";
import { parseProject } from "./parseProject";
import {
  PROJECT_SCHEMA_VERSION,
  type ModuleContent,
  type ModuleState,
  type ProjectSections,
  type ProjectState,
  type StageContent,
  type StoredItem,
} from "./projectState";

/** The SHA-256 of a piece's bytes, in hex: what names it. */
export type Address = string;

/**
 * Where a piece sits in a state: the project without its modules, a module
 * without its stages and threads, a stage without its items, an item, or a
 * thread.
 */
export type PieceLevel = "project" | "module" | "stage" | "item" | "thread";

export interface Piece {
  bytes: string;
  level: PieceLevel;
  /** The pieces this one names, with their levels. */
  children: readonly (readonly [Address, PieceLevel])[];
}

export function addressOfBytes(bytes: string): Address {
  return bytesToHex(sha256(utf8ToBytes(bytes)));
}

export function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function textsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The pieces a piece names, read from its bytes. */
export function childrenOf(level: PieceLevel, bytes: string): (readonly [Address, PieceLevel])[] {
  if (level === "item" || level === "thread") return [];
  const node = parseJson(bytes, "A stored piece");
  if (!isRecord(node)) return [];
  switch (level) {
    case "project":
      return textsOf(node.modules).map((address) => [address, "module"] as const);
    case "stage":
      return textsOf(node.items).map((address) => [address, "item"] as const);
    case "module": {
      const content = isRecord(node.content) ? node.content : {};
      const stages = isRecord(content.stages) ? textsOf(Object.values(content.stages)) : [];
      return [
        ...stages.map((address) => [address, "stage"] as const),
        ...textsOf(content.threads).map((address) => [address, "thread"] as const),
      ];
    }
  }
}

/** A module of a state as its pieces name it: its identity, and the addresses of its piece, its stages and its threads. */
export interface ModulePieces {
  id: string;
  name: string;
  archivedAt: string | null;
  address: Address;
  stages: Record<string, Address>;
  threads: Address[];
}

/**
 * The pieces of the states a session keeps, by address. A state's address
 * is its project piece's. Equal values make equal pieces, so a state shares
 * every piece it did not change with the states before it.
 *
 * Subtrees are recognised by object: store snapshots share every object
 * that did not change, so an unchanged item, thread, stage or module costs a
 * lookup, never a new hash.
 */
/** The module contents a piece store keeps by address at most, for the states put together one after another. */
const KEPT_MODULE_CONTENTS = 64;

export class PieceStore {
  private readonly pieces = new Map<Address, Piece>();
  private readonly addresses = new WeakMap<object, Address>();
  private readonly modules = new WeakMap<ModuleContent, { id: string; name: string; archivedAt: string | null; address: Address }>();
  /**
   * The module contents last read or held, by their module's address, so a
   * state put together reads only the modules it does not share with them;
   * the oldest give way.
   */
  private readonly moduleContents = new Map<Address, ModuleContent>();

  get(address: Address): Piece | undefined {
    return this.pieces.get(address);
  }

  has(address: Address): boolean {
    return this.pieces.has(address);
  }

  /** Hold every piece of a state, and return its address. */
  addressOf(state: ProjectState): Address {
    const modules = state.modules.map((module) => this.moduleAddress(module));
    return this.hold(
      "project",
      { schemaVersion: PROJECT_SCHEMA_VERSION, modulesEnabled: state.modulesEnabled, modules, sections: state.sections },
      modules.map((address) => [address, "module"] as const),
    );
  }

  /**
   * Hold a piece read from storage. False, holding nothing, when its bytes
   * are not the ones its address names.
   */
  adopt(address: Address, bytes: string, level: PieceLevel): boolean {
    if (this.pieces.has(address)) return true;
    if (addressOfBytes(bytes) !== address) return false;
    this.pieces.set(address, { bytes, level, children: childrenOf(level, bytes) });
    return true;
  }

  /** Every held piece the given states consist of. */
  reachable(roots: Iterable<Address>): Set<Address> {
    return this.walk(roots).reached;
  }

  /** Whether every piece of the state at an address is held, so it can be put together. */
  holdsWhole(address: Address): boolean {
    return this.walk([address]).whole;
  }

  /** The held pieces the given states consist of, and whether none of theirs is missing. */
  private walk(roots: Iterable<Address>): { reached: Set<Address>; whole: boolean } {
    const reached = new Set<Address>();
    const pending = [...roots];
    let whole = true;
    while (pending.length > 0) {
      const address = pending.pop()!;
      if (reached.has(address)) continue;
      const piece = this.pieces.get(address);
      if (piece == null) {
        whole = false;
        continue;
      }
      reached.add(address);
      for (const [child] of piece.children) pending.push(child);
    }
    return { reached, whole };
  }

  /**
   * Let go of every piece but those given and the held pieces they consist
   * of. A piece recognised by its object was held with all its own pieces,
   * and so it stays: while it is held, the object needs no hashing again.
   */
  retainOnly(kept: ReadonlySet<Address>): void {
    const { reached } = this.walk(kept);
    for (const address of [...this.pieces.keys()]) {
      if (!reached.has(address)) this.pieces.delete(address);
    }
  }

  /** The held piece at an address, read; throws when it is not held. */
  private read(address: Address): Record<string, unknown> {
    const piece = this.pieces.get(address);
    if (piece == null) throw new Error(`The piece ${address} is missing.`);
    return parseJson(piece.bytes, "A stored piece") as Record<string, unknown>;
  }

  /**
   * The modules of the state at an address, in its order, each with the
   * addresses of its pieces, read without putting any module together.
   */
  modulesAt(address: Address): ModulePieces[] {
    return textsOf(this.read(address).modules).map((moduleAddress) => {
      const node = this.read(moduleAddress);
      const content = node.content as Record<string, unknown>;
      return {
        id: node.id as string,
        name: node.name as string,
        archivedAt: (node.archivedAt as string | null) ?? null,
        address: moduleAddress,
        stages: content.stages as Record<string, Address>,
        threads: textsOf(content.threads),
      };
    });
  }

  /** The sections of the state at an address, as its project piece holds them. */
  sectionsAt(address: Address): ProjectSections {
    return this.read(address).sections as ProjectSections;
  }

  /** Whether the state at an address has its modules turned on. */
  modulesEnabledAt(address: Address): boolean {
    return this.read(address).modulesEnabled === true;
  }

  /** The address of a module's piece, holding its pieces. */
  moduleAddressOf(module: ModuleState): Address {
    return this.moduleAddress(module);
  }

  /** A module's piece put together, unchecked: only for a module of a state the parser read. */
  private moduleNode(moduleAddress: Address): Record<string, unknown> {
    const recognised = (pieceAddress: Address, value: object): object => {
      this.addresses.set(value, pieceAddress);
      return value;
    };
    const leaf = (pieceAddress: Address): object => recognised(pieceAddress, this.read(pieceAddress));
    const moduleNode = this.read(moduleAddress);
    const node = moduleNode.content as Record<string, unknown>;
    const stages = Object.fromEntries(
      Object.entries(node.stages as Record<string, Address>).map(([stage, stageAddress]) => {
        const stored = this.read(stageAddress);
        return [stage, recognised(stageAddress, { ...stored, items: textsOf(stored.items).map(leaf) })];
      }),
    );
    return { ...moduleNode, content: { ...node, stages, threads: textsOf(node.threads).map(leaf) } };
  }

  /** One module of a held state, put together from its pieces and read by the one project parser. */
  moduleAt(moduleAddress: Address): ModuleState {
    const known = this.moduleContents.get(moduleAddress) ?? null;
    const node = known == null ? this.moduleNode(moduleAddress) : this.read(moduleAddress);
    // A project holds a module that is not archived, so the module is read as one.
    const [parsed] = parseProject({ schemaVersion: PROJECT_SCHEMA_VERSION, modulesEnabled: true, modules: [{ ...node, archivedAt: null }], sections: {} }, [known]).modules;
    const read = { ...parsed!, archivedAt: node.archivedAt as string | null };
    this.recognise(read, moduleAddress);
    return read;
  }

  /** A module's content as kept by its address from now on, the newest last. */
  private recognise(module: ModuleState, address: Address): void {
    this.modules.set(module.content, { id: module.id, name: module.name, archivedAt: module.archivedAt, address });
    this.moduleContents.delete(address);
    this.moduleContents.set(address, module.content);
    if (this.moduleContents.size > KEPT_MODULE_CONTENTS) this.moduleContents.delete(this.moduleContents.keys().next().value!);
  }

  /** A thread's piece, read. */
  threadAt(address: Address): Thread {
    return this.read(address) as unknown as Thread;
  }

  /** An item's piece, read. */
  itemAt(address: Address): StoredItem {
    return this.read(address) as unknown as StoredItem;
  }

  /** A stage's piece, read: its content, with the addresses of its items' pieces, in its order, in place of its items. */
  stageAt(address: Address): Omit<StageContent, "items"> & { items: Address[] } {
    const node = this.read(address);
    return { ...(node as unknown as Omit<StageContent, "items">), items: textsOf(node.items) };
  }

  /**
   * The state at an address, put together from its pieces and read by the
   * one project parser. A module it shares with a state read or held before
   * is that state's module content, the same object, so it is neither read
   * nor compared again. Each part is recognised by its address from then on,
   * so a state brought back is not hashed again.
   */
  stateAt(address: Address): ProjectState {
    const project = this.read(address);
    const moduleAddresses = textsOf(project.modules);
    const known = moduleAddresses.map((moduleAddress) => this.moduleContents.get(moduleAddress) ?? null);
    const modules = moduleAddresses.map((moduleAddress, index) => (known[index] == null ? this.moduleNode(moduleAddress) : this.read(moduleAddress)));
    const state = parseProject({ ...project, modules }, known);
    state.modules.forEach((module, index) => this.recognise(module, moduleAddresses[index]!));
    return state;
  }

  private hold(level: PieceLevel, node: unknown, children: (readonly [Address, PieceLevel])[]): Address {
    const bytes = serializeCanonical(node);
    const address = addressOfBytes(bytes);
    if (!this.pieces.has(address)) this.pieces.set(address, { bytes, level, children });
    return address;
  }

  /** The address of a leaf or of a node whose own pieces `build` holds, looked up by the object it comes from. */
  private cached(source: object, build: () => Address): Address {
    const known = this.addresses.get(source);
    if (known != null && this.pieces.has(known)) return known;
    const address = build();
    this.addresses.set(source, address);
    return address;
  }

  private itemAddress(item: StoredItem): Address {
    return this.cached(item, () => this.hold("item", item, []));
  }

  private threadAddress(thread: Thread): Address {
    return this.cached(thread, () => this.hold("thread", thread, []));
  }

  private stageAddress(stage: StageContent): Address {
    return this.cached(stage, () => {
      const items = stage.items.map((item) => this.itemAddress(item));
      return this.hold("stage", { ...stage, items }, items.map((address) => [address, "item"] as const));
    });
  }

  private moduleAddress(module: ModuleState): Address {
    const known = this.modules.get(module.content);
    if (
      known != null &&
      known.id === module.id &&
      known.name === module.name &&
      known.archivedAt === module.archivedAt &&
      this.pieces.has(known.address)
    ) {
      this.recognise(module, known.address);
      return known.address;
    }
    const stages = Object.fromEntries(
      Object.entries(module.content.stages).map(([stage, content]) => [stage, this.stageAddress(content)]),
    );
    const threads = module.content.threads.map((thread) => this.threadAddress(thread));
    const address = this.hold(
      "module",
      { id: module.id, name: module.name, archivedAt: module.archivedAt, content: { ...module.content, stages, threads } },
      [
        ...Object.values(stages).map((child) => [child, "stage"] as const),
        ...threads.map((child) => [child, "thread"] as const),
      ],
    );
    this.recognise(module, address);
    return address;
  }
}
