import type { Hash, StateTree } from "./serialize";

/**
 * A turn in the conversation tree: one top-level action's appended messages
 * plus a hash-reference to the full store state after that action. The
 * visible conversation is the active root-to-leaf path; branches are
 * children; undo/redo/rewind/switching are tree walks.
 *
 * `stateOnly` nodes carry no messages — they record pure state edits
 * (coalesced text edits, restores) so undo covers artifact changes that
 * never posted a message. The conversation renderer filters them out.
 */
export type TurnNode = {
  id: string;
  parent: string | null;
  children: string[];
  lastActiveChild: string | null;
  messages: unknown[];
  state: StateTree;
  stateOnly: boolean;
  source: "user" | "ai" | "system";
  label: string;
  createdAt: number;
};

export type ConversationTree = {
  nodes: Map<string, TurnNode>;
  rootId: string;
  activeLeafId: string;
};

export function createTree(
  rootId: string,
  root: Omit<TurnNode, "id" | "parent" | "children" | "lastActiveChild">,
): ConversationTree {
  const node: TurnNode = {
    id: rootId,
    parent: null,
    children: [],
    lastActiveChild: null,
    ...root,
  };
  return {
    nodes: new Map([[rootId, node]]),
    rootId,
    activeLeafId: rootId,
  };
}

export function getNode(
  tree: ConversationTree,
  id: string,
): TurnNode | undefined {
  return tree.nodes.get(id);
}

/** Root-to-leaf chain of the active path, oldest first. */
export function activePath(tree: ConversationTree): TurnNode[] {
  const chain: TurnNode[] = [];
  let current: TurnNode | undefined = tree.nodes.get(tree.activeLeafId);
  while (current != null) {
    chain.push(current);
    current = current.parent == null
      ? undefined
      : tree.nodes.get(current.parent);
  }
  return chain.reverse();
}

/** Follow lastActiveChild links from a node down to its subtree's leaf. */
export function branchLeaf(tree: ConversationTree, nodeId: string): string {
  let current = nodeId;
  for (;;) {
    const node = tree.nodes.get(current);
    if (node == null || node.lastActiveChild == null) return current;
    current = node.lastActiveChild;
  }
}

/** Graft a new turn under `parentId` and make it the active leaf. */
export function graftTurn(
  tree: ConversationTree,
  parentId: string,
  turn: Omit<TurnNode, "id" | "parent" | "children" | "lastActiveChild"> & {
    id: string;
  },
): TurnNode {
  const parent = tree.nodes.get(parentId);
  if (parent == null) throw new Error(`Graft parent ${parentId} is missing.`);
  const node: TurnNode = {
    ...turn,
    parent: parentId,
    children: [],
    lastActiveChild: null,
  };
  tree.nodes.set(node.id, node);
  parent.children.push(node.id);
  parent.lastActiveChild = node.id;
  tree.activeLeafId = node.id;
  return node;
}

/** Update an existing node in place (coalesced text edits). */
export function updateNodeState(
  tree: ConversationTree,
  nodeId: string,
  state: StateTree,
  createdAt: number,
): void {
  const node = tree.nodes.get(nodeId);
  if (node == null) return;
  node.state = state;
  node.createdAt = createdAt;
}

/**
 * Activate a node: the store is expected to be restored to that node's
 * state by the caller; here we only repoint the active leaf and refresh the
 * lastActiveChild chain along the walked path.
 */
export function activateNode(
  tree: ConversationTree,
  nodeId: string,
): void {
  const node = tree.nodes.get(nodeId);
  if (node == null) return;
  // Refresh lastActiveChild from the root down the path to nodeId.
  const path: string[] = [];
  let current: string | undefined = nodeId;
  while (current != null) {
    path.push(current);
    const nodeById = tree.nodes.get(current);
    current = nodeById?.parent ?? undefined;
  }
  for (let index = path.length - 1; index > 0; index -= 1) {
    const parent = tree.nodes.get(path[index]);
    if (parent != null) parent.lastActiveChild = path[index - 1];
  }
  tree.activeLeafId = nodeId;
}

/** Drop nodes unreachable from the active leaf (and any kept leaves). */
export function pruneTree(
  tree: ConversationTree,
  extraKeptLeaves: readonly string[] = [],
): void {
  const reachable = new Set<string>();
  const keep = (leafId: string): void => {
    let current: string | undefined = leafId;
    while (current != null && !reachable.has(current)) {
      reachable.add(current);
      current = tree.nodes.get(current)?.parent ?? undefined;
    }
  };
  keep(tree.activeLeafId);
  extraKeptLeaves.forEach(keep);
  for (const id of [...tree.nodes.keys()]) {
    if (!reachable.has(id)) tree.nodes.delete(id);
  }
}

/** The message ranges each node of the active path contributed. */
export function activePathRanges(
  tree: ConversationTree,
): { node: TurnNode; startIndex: number; count: number }[] {
  const ranges: { node: TurnNode; startIndex: number; count: number }[] = [];
  let acc = 0;
  for (const node of activePath(tree)) {
    const count = node.messages.length;
    ranges.push({ node, startIndex: acc, count });
    acc += count;
  }
  return ranges;
}

/** The node whose turn appended the message at `messageIndex`. */
export function nodeCoveringMessage(
  tree: ConversationTree,
  messageIndex: number,
): TurnNode | undefined {
  for (const { node, startIndex, count } of activePathRanges(tree)) {
    if (messageIndex >= startIndex && messageIndex < startIndex + count) {
      return node;
    }
  }
  return undefined;
}
