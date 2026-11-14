import { parseJson } from "lib/json";
import { WORKFLOW } from "store";
import type { Thread } from "workflow";

import { serializeCanonical } from "./canonicalJson";
import type { Address, PieceStore } from "./pieces";
import type { StageContent, StoredItem } from "./projectState";

/** What one stage of a module holds in one state that it does not in another, and the other way round. */
export interface StageDifference {
  module: string;
  /** The stage's label. */
  stage: string;
  /** The codes of the items only the one state holds, as it names them. */
  itemsMore: string[];
  /** The codes of the items only the other state holds, as that one names them. */
  itemsFewer: string[];
  /** The codes, in the other state, of the items both hold that differ in more than their signatures. */
  itemsChanged: string[];
  signaturesMore: number;
  signaturesFewer: number;
  messagesMore: number;
  messagesFewer: number;
}

/**
 * How one state differs from another, by stage. A difference no count
 * names, such as the order of items, leaves the stages empty and `same`
 * false.
 */
export interface StateDifference {
  same: boolean;
  stages: StageDifference[];
}

/** A stage as its piece holds it: its items by address. */
type StagePiece = Omit<StageContent, "items"> & { items: Address[] };

interface ModulePiece {
  id: string;
  name: string;
  content: { stages: Record<string, Address>; threads: Address[] };
}

/** The entries of the first list that the second lacks. */
function without<Entry>(entries: readonly Entry[], others: readonly Entry[]): Entry[] {
  const lacking = new Set(others);
  return entries.filter((entry) => !lacking.has(entry));
}

/** Each signature given as a text equal signatures share; none for null. */
function signatureTexts(signatures: readonly (readonly [unit: string, signature: unknown])[]): string[] {
  return signatures.flatMap(([unit, signature]) => (signature == null ? [] : [`${unit} ${serializeCanonical(signature)}`]));
}

/** What an address names, worked out once. */
function byAddress<Value>(read: (address: Address) => Value): (address: Address) => Value {
  const known = new Map<Address, Value>();
  return (address) => {
    if (!known.has(address)) known.set(address, read(address));
    return known.get(address)!;
  };
}

/**
 * Reads how kept states differ from the state at `here`, from their pieces:
 * a part both states hold at one address is the same and is not read. Null
 * for a state with a piece that is not held.
 */
export function differenceReader(pieces: PieceStore, here: Address): (there: Address) => StateDifference | null {
  const nodeAt = byAddress((address): unknown => {
    const piece = pieces.get(address);
    if (piece == null) throw new Error(`The piece ${address} is missing.`);
    return parseJson(piece.bytes, "A stored piece");
  });
  const pieceAt = <Node>(address: Address) => nodeAt(address) as Node;
  const itemSignatures = byAddress((address) => {
    const item = pieceAt<StoredItem>(address);
    return signatureTexts([[item.id, item.signature], [`removal of ${item.id}`, item.removal?.signature]]);
  });
  /** What an item is apart from its signatures. */
  const itemShape = byAddress((address) => {
    const { kind, content, references, dependencies, removal } = pieceAt<StoredItem>(address);
    return serializeCanonical({ kind, content, references, dependencies, removed: removal != null });
  });
  const stageSignatures = byAddress((address) => {
    const stage = pieceAt<StagePiece>(address);
    return signatureTexts([
      ...Object.entries(stage.coverages).map(([id, signature]) => [`coverage of ${id}`, signature] as const),
      ...Object.entries(stage.impacts).map(([id, signature]) => [`impact on ${id}`, signature] as const),
    ]);
  });
  const modulesAt = (state: Address) =>
    new Map(pieceAt<{ modules: Address[] }>(state).modules.map((address) => [pieceAt<ModulePiece>(address).id, address]));

  const stageDifference = (
    module: string,
    stage: string,
    held: Address | undefined,
    other: Address | undefined,
    threads: readonly Thread[],
    otherThreads: readonly Thread[],
  ): StageDifference => {
    // A stage both hold at one address differs in nothing of its own, only in its threads.
    const differing = (address: Address | undefined) => (address == null || held === other ? null : address);
    const itemsAt = (address: Address | null) => (address == null ? [] : pieceAt<StagePiece>(address).items);
    const signaturesAt = (address: Address | null, items: readonly Address[]) => [
      ...items.flatMap(itemSignatures),
      ...(address == null ? [] : stageSignatures(address)),
    ];
    const [heldStage, otherStage] = [differing(held), differing(other)];
    const itemAddresses = without(itemsAt(otherStage), itemsAt(heldStage));
    const heldItemAddresses = without(itemsAt(heldStage), itemsAt(otherStage));
    const idOf = (address: Address) => pieceAt<StoredItem>(address).id;
    const codeOf = (address: Address, stageAddress: Address | null) =>
      WORKFLOW.codeOf(pieceAt<StoredItem>(address), itemsAt(stageAddress).map((item) => pieceAt<StoredItem>(item)));
    const heldItems = new Map(heldItemAddresses.map((address) => [idOf(address), address]));
    const otherIds = new Set(itemAddresses.map(idOf));
    const inBoth = itemAddresses.flatMap((address) => {
      const heldAddress = heldItems.get(idOf(address));
      return heldAddress == null ? [] : [[address, heldAddress] as const];
    });
    const signatures = signaturesAt(otherStage, itemAddresses);
    const heldSignatures = signaturesAt(heldStage, heldItemAddresses);
    const heldThreads = new Map(threads.map((thread) => [thread.id, thread.messages.length]));
    const messages = otherThreads.map((thread) => thread.messages.length - (heldThreads.get(thread.id) ?? 0));
    const lacking = without([...heldThreads.keys()], otherThreads.map(({ id }) => id)).map((id) => heldThreads.get(id)!);
    const sum = (counts: readonly number[]) => counts.reduce((total, count) => total + count, 0);
    return {
      module,
      stage: WORKFLOW.stage(stage).label,
      itemsMore: itemAddresses.filter((address) => !heldItems.has(idOf(address))).map((address) => codeOf(address, otherStage)),
      itemsFewer: heldItemAddresses.filter((address) => !otherIds.has(idOf(address))).map((address) => codeOf(address, heldStage)),
      itemsChanged: inBoth
        .filter(([address, heldAddress]) => itemShape(address) !== itemShape(heldAddress))
        .map(([, heldAddress]) => codeOf(heldAddress, heldStage)),
      signaturesMore: without(signatures, heldSignatures).length,
      signaturesFewer: without(heldSignatures, signatures).length,
      messagesMore: sum(messages.filter((count) => count > 0)),
      messagesFewer: sum(lacking) - sum(messages.filter((count) => count < 0)),
    };
  };

  const difference = (there: Address): StateDifference => {
    if (there === here) return { same: true, stages: [] };
    const held = modulesAt(here);
    const others = modulesAt(there);
    const stages: StageDifference[] = [];
    for (const id of new Set([...others.keys(), ...held.keys()])) {
      if (held.get(id) === others.get(id)) continue;
      const heldModule = held.has(id) ? pieceAt<ModulePiece>(held.get(id)!) : null;
      const otherModule = others.has(id) ? pieceAt<ModulePiece>(others.get(id)!) : null;
      const threadsOf = (module: ModulePiece | null, lacking: ModulePiece | null) =>
        without(module?.content.threads ?? [], lacking?.content.threads ?? []).map((address) => pieceAt<Thread>(address));
      const threads = threadsOf(heldModule, otherModule);
      const otherThreads = threadsOf(otherModule, heldModule);
      for (const stage of WORKFLOW.stageIds) {
        const inStage = (thread: Thread) => thread.stage === stage;
        stages.push(
          stageDifference(
            (otherModule ?? heldModule)!.name,
            stage,
            heldModule?.content.stages[stage],
            otherModule?.content.stages[stage],
            threads.filter(inStage),
            otherThreads.filter(inStage),
          ),
        );
      }
    }
    return {
      same: false,
      stages: stages.filter(({ module: _module, stage: _stage, ...counts }) =>
        Object.values(counts).some((count) => (typeof count === "number" ? count : count.length) > 0),
      ),
    };
  };

  return (there) => {
    try {
      return difference(there);
    } catch (error) {
      console.error(`The state ${there} of the project's history cannot be read.`, error);
      return null;
    }
  };
}
