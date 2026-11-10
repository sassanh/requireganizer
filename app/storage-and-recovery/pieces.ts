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

/**
 * The pieces of the states a session keeps, by address. A state's address
 * is its project piece's. Equal values make equal pieces, so a state shares
 * every piece it did not change with the states before it.
 *
 * Subtrees are recognised by object: store snapshots share every object
 * that did not change, so an unchanged item, thread, stage or module costs a
 * lookup, never a new hash.
 */
export class PieceStore {
  private readonly pieces = new Map<Address, Piece>();
  private addresses = new WeakMap<object, Address>();
  private readonly modules = new WeakMap<ModuleContent, { id: string; name: string; archivedAt: string | null; address: Address }>();

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
      { schemaVersion: PROJECT_SCHEMA_VERSION, modulesEnabled: state.modulesEnabled, modules },
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

  /** Let go of every piece but those given. */
  retainOnly(kept: ReadonlySet<Address>): void {
    for (const address of [...this.pieces.keys()]) {
      if (!kept.has(address)) this.pieces.delete(address);
    }
    // An object may name a piece let go of; it is hashed again when next seen.
    this.addresses = new WeakMap();
  }

  /** The state at an address, put together from its pieces and read by the one project parser. */
  stateAt(address: Address): ProjectState {
    const read = (pieceAddress: Address): Record<string, unknown> => {
      const piece = this.pieces.get(pieceAddress);
      if (piece == null) throw new Error(`The piece ${pieceAddress} is missing.`);
      return parseJson(piece.bytes, "A stored piece") as Record<string, unknown>;
    };
    const project = read(address);
    const modules = textsOf(project.modules).map((moduleAddress) => {
      const moduleNode = read(moduleAddress);
      const node = moduleNode.content as Record<string, unknown>;
      const stages = Object.fromEntries(
        Object.entries(node.stages as Record<string, Address>).map(([stage, stageAddress]) => {
          const stored = read(stageAddress);
          return [stage, { ...stored, items: textsOf(stored.items).map(read) }];
        }),
      );
      return { ...moduleNode, content: { ...node, stages, threads: textsOf(node.threads).map(read) } };
    });
    return parseProject({ ...project, modules });
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
    this.modules.set(module.content, { id: module.id, name: module.name, archivedAt: module.archivedAt, address });
    return address;
  }
}
