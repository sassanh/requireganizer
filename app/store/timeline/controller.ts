import { runInAction } from "mobx";
import {
  addMiddleware,
  applySnapshot,
  createActionTrackingMiddleware2,
  getPropertyMembers,
  getSnapshot,
  getPath,
} from "mobx-state-tree";

import { describeCommand, parseCommandMessage } from "ai-agent/command";
import { uuid } from "utilities";


import type { PersistedTimeline, StateTree } from "./serialize";
import {
  captureState,
  collectArtifactGarbage,
  exportTimelineData,
  importTimelineData,
  resolveStateValues,
  restoreSnapshot,
  sameState,
} from "./serialize";
import type { ConversationTree, TurnNode } from "./tree";
import {
  activePath,
  activePathRanges,
  activateNode,
  branchLeaf,
  createTree,
  graftTurn,
  nodeCoveringMessage,
  pruneTree,
  updateNodeState,
} from "./tree";
import { ProductOverviewModel } from "../models/ProductOverview";

export type TimelinePersistence = {
  load: () => unknown;
  save: (data: PersistedTimeline) => boolean;
};

export type AttachTimelineOptions = {
  persistence?: TimelinePersistence;
};

type Source = { kind: "user" | "ai" | "system"; label: string };

/**
 * A step declaration: the only way an action may open a timeline turn.
 * Steps are declared, never inferred — AI flows register through their
 * `generator()` wrapper (keyed by the store property the flow is assigned
 * to), and direct user text edits are declared below so the model layer
 * stays timeline-agnostic. Infrastructure actions (hydration, exports,
 * snapshot application) never declare themselves and therefore can never
 * produce turns.
 */
type TimelineStep = Source;
const stepDeclarations = new Map<string, TimelineStep>();

export function declareTimelineStep(
  actionName: string,
  step: TimelineStep,
): void {
  stepDeclarations.set(actionName, step);
}

export function getCurrentStepKind(): Source["kind"] | null {
  return openTurn?.step.kind ?? null;
}

/** Declared step action names (introspection for diagnostics). */
export function getDeclaredStepNames(): string[] {
  return [...stepDeclarations.keys()];
}

for (const actionName of [
  "setContent",
  "setDescription",
  "setName",
  "setPurpose",
]) {
  declareTimelineStep(actionName, { kind: "user", label: actionName });
}

type AttachedStore = { isBusy?: boolean };

let attachedStore: AttachedStore | null = null;
let restoring = false;
// The currently open turn: bound to the one root action that declared it.
// Every other root call made while it runs folds into it silently.
let openTurn: {
  step: TimelineStep;
  rootCallId: number;
  beforeState: StateTree;
} | null = null;
let persistence: TimelinePersistence | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 600;

// Text-edit actions coalesce into one turn until a semantic boundary.
const TEXT_EDIT_ACTIONS = new Set([
  "setContent",
  "setDescription",
  "setName",
  "setPurpose",
]);
let tailMarker: { name: string; path: string } | null = null;

// When a rewind is pending, the leaf to restore on cancel.
let rewindSavedLeafId: string | null = null;
let disposer: (() => void) | null = null;

const tree: ConversationTree = { nodes: new Map(), rootId: "", activeLeafId: "" };

const attachedInstances = new WeakSet<object>();

function seedRoot(label: string): void {
  const snapshot = snapshotNow() as unknown as { conversation: unknown[] };
  const state = captureState(snapshot as never);
  const messages = [...(snapshot.conversation ?? [])];
  const created = createTree(uuid(), {
    messages,
    state,
    stateOnly: messages.length === 0,
    source: "system",
    label,
    createdAt: Date.now(),
  });
  tree.nodes = created.nodes;
  tree.rootId = created.rootId;
  tree.activeLeafId = created.activeLeafId;
}

const listeners = new Set<() => void>();
let metaCache: TimelineMeta = {
  entries: [],
  canUndo: false,
  canRedo: false,
  isRewinding: false,
};

export type TimelineMetaEntry = {
  id: string;
  label: string;
  source: Source["kind"];
  createdAt: number;
  stateOnly: boolean;
  messageCount: number;
  startIndex: number;
  alternatives: { id: string; label: string; createdAt: number; preview: string }[];
};

// Change focus: where a non-human change landed, so the UI can navigate to
// and highlight the subject. Human edits never emit — their author is
// already looking at them.
export type ChangeFocusOpKind = "add" | "remove" | "update";

/**
 * One changed subject, classified so the UI can react appropriately:
 * additions and removals slide (animated by the owning list), updates are
 * presented by the owning element through the change queue. `itemId`
 * carries the affected item's snapshot id whenever one exists, so lists and
 * items can recognize exactly the affected child.
 */
export type ChangeFocusOp = {
  kind: ChangeFocusOpKind;
  subject: string;
  itemId?: string;
  itemSnapshot?: unknown;
  /** After-value of a scalar/artifact update. The presenter captures this
   * at schedule time and animates it; it does not re-read the store. */
  value?: unknown;
};

export type ChangeFocus = { ops: ChangeFocusOp[]; nonce: number };

let changeFocus: ChangeFocus = { ops: [], nonce: 0 };
const focusListeners = new Set<(focus: ChangeFocus) => void>();

export function onChangeFocus(
  listener: (focus: ChangeFocus) => void,
): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

export function getChangeFocus(): ChangeFocus {
  return changeFocus;
}

/** State-tree keys that can be subjects; conversation follows itself. */
const SUBJECT_KEYS = [
  "description",
  "productOverview",
  "userStories",
  "requirements",
  "acceptanceCriteria",
  "boundaryDesign",
  "implementationProfile",
  "contractSuite",
  "testScenarios",
  "testCases",
  "projectSetup",
  "scaffoldFiles",
  "stageInputFingerprints",
] as const;

function snapshotItemId(snapshot: unknown): string | undefined {
  return typeof (snapshot as { id?: unknown } | null)?.id === "string"
    ? (snapshot as { id: string }).id
    : undefined;
}

/**
 * Field iteration order for artifact roots whose scalar fields render as
 * distinct elements. Resolved values come out of the content-hash store
 * with alphabetically ordered keys, but the change choreography must play
 * in the layout's order — a field must never blink after a collection that
 * renders below it. Derived from the model declarations: one source of
 * truth, no drift.
 */
const FIELD_ORDER_BY_ROOT: Record<string, string[]> = {
  productOverview: Object.keys(
    getPropertyMembers(ProductOverviewModel).properties,
  ),
};

/** Order an artifact's changed fields by model declaration order; fields
 * unknown to the model keep deterministic alphabetical order at the end. */
function orderedArtifactFields(root: string, fields: Set<string>): string[] {
  const order = FIELD_ORDER_BY_ROOT[root];
  if (order == null) return [...fields];
  const rank = (field: string): number => {
    const index = order.indexOf(field);
    return index === -1 ? order.length : index;
  };
  return [...fields].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Push one op per identity that appeared, disappeared, or changed.
 * Index-based diffs would treat a shift as updates of every later slot;
 * lists queue add/remove of ids, so the log has to be about ids. */
function diffArrayOps(
  subjectPrefix: string,
  beforeList: unknown[],
  afterList: unknown[],
  ops: ChangeFocusOp[],
): void {
  const beforeById = new Map<string, unknown>();
  const afterById = new Map<string, unknown>();
  for (const item of beforeList) {
    const id = snapshotItemId(item);
    if (id != null) beforeById.set(id, item);
  }
  for (const item of afterList) {
    const id = snapshotItemId(item);
    if (id != null) afterById.set(id, item);
  }

  for (const item of beforeList) {
    const id = snapshotItemId(item);
    if (id == null || afterById.has(id)) continue;
    const op: ChangeFocusOp = {
      kind: "remove",
      subject: `${subjectPrefix}/${id}`,
      itemId: id,
      itemSnapshot: item,
    };
    ops.push(op);
  }

  for (const item of afterList) {
    const id = snapshotItemId(item);
    if (id == null) continue;
    const beforeItem = beforeById.get(id);
    if (beforeItem == null) {
      ops.push({
        kind: "add",
        subject: `${subjectPrefix}/${id}`,
        itemId: id,
        itemSnapshot: item,
      });
      continue;
    }
    if (JSON.stringify(beforeItem) !== JSON.stringify(item)) {
      ops.push({
        kind: "update",
        subject: `${subjectPrefix}/${id}`,
        itemId: id,
        itemSnapshot: item,
      });
    }
  }
}

/** Collections nested inside identifiable items (scenario.testCases, ...). */
function diffNestedIdentifiableArrays(
  prefix: string,
  beforeList: unknown[],
  afterList: unknown[],
  ops: ChangeFocusOp[],
): void {
  const beforeById = new Map<string, Record<string, unknown>>();
  const afterById = new Map<string, Record<string, unknown>>();
  for (const item of beforeList) {
    const id = snapshotItemId(item);
    if (id != null && item != null && typeof item === "object") {
      beforeById.set(id, item as Record<string, unknown>);
    }
  }
  for (const item of afterList) {
    const id = snapshotItemId(item);
    if (id != null && item != null && typeof item === "object") {
      afterById.set(id, item as Record<string, unknown>);
    }
  }
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  for (const id of ids) {
    const beforeItem = beforeById.get(id);
    const afterItem = afterById.get(id);
    const fields = new Set([
      ...Object.keys(beforeItem ?? {}),
      ...Object.keys(afterItem ?? {}),
    ]);
    for (const field of fields) {
      const beforeField = beforeItem?.[field];
      const afterField = afterItem?.[field];
      if (!Array.isArray(beforeField) && !Array.isArray(afterField)) continue;
      const beforeArr = Array.isArray(beforeField) ? beforeField : [];
      const afterArr = Array.isArray(afterField) ? afterField : [];
      if (
        ![...beforeArr, ...afterArr].some(
          (entry) => snapshotItemId(entry) != null,
        )
      ) {
        continue;
      }
      diffArrayOps(`${prefix}/${id}/${field}`, beforeArr, afterArr, ops);
    }
  }
}

/**
 * Diff two recorded state trees into change-focus ops: top-level artifact
 * keys for whole-artifact changes, identity add/remove/update ops for
 * collection items. The trees record content hashes, so they are resolved
 * into artifact values first — item identities (ids) and embedded
 * collections only exist there. Artifact objects are descended into: their
 * embedded collections get item-level ops (so their lists can choreograph)
 * and their scalar fields get per-field ops (so the pulse can target
 * exactly the changed field). Additions and removals carry the affected
 * item's snapshot id so lists can animate exactly that item.
 */
function diffOps(before: StateTree, after: StateTree): ChangeFocusOp[] {
  const beforeTree = resolveStateValues(before) as Record<string, unknown>;
  const afterTree = resolveStateValues(after) as Record<string, unknown>;
  const ops: ChangeFocusOp[] = [];
  for (const key of SUBJECT_KEYS) {
    const beforeValue = beforeTree[key];
    const afterValue = afterTree[key];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;

    if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
      diffArrayOps(key, beforeValue, afterValue, ops);
      diffNestedIdentifiableArrays(key, beforeValue, afterValue, ops);
      continue;
    }

    // Artifact objects (e.g. productOverview) are descended into so their
    // embedded collections produce item-level ops; scalar field changes
    // collapse into a single whole-artifact update.
    if (
      beforeValue != null &&
      afterValue != null &&
      typeof beforeValue === "object" &&
      typeof afterValue === "object"
    ) {
      const beforeFields = beforeValue as Record<string, unknown>;
      const afterFields = afterValue as Record<string, unknown>;
      const fields = new Set([
        ...Object.keys(beforeFields),
        ...Object.keys(afterFields),
      ]);
      for (const field of orderedArtifactFields(key, fields)) {
        const beforeField = beforeFields[field];
        const afterField = afterFields[field];
        if (Array.isArray(beforeField) && Array.isArray(afterField)) {
          diffArrayOps(`${key}/${field}`, beforeField, afterField, ops);
          diffNestedIdentifiableArrays(
            `${key}/${field}`,
            beforeField,
            afterField,
            ops,
          );
          continue;
        }
        if (JSON.stringify(beforeField) !== JSON.stringify(afterField)) {
          ops.push({
            kind: "update",
            subject: `${key}/${field}`,
            value: afterField,
          });
        }
      }
      continue;
    }

    ops.push({ kind: "update", subject: key, value: afterValue });
  }
  return ops;
}

function emitChangeFocus(ops: ChangeFocusOp[]): void {
  if (ops.length === 0) return;
  changeFocus = { ops, nonce: changeFocus.nonce + 1 };
  focusListeners.forEach((listener) => listener(changeFocus));
}

export type TimelineMeta = {
  entries: TimelineMetaEntry[];
  canUndo: boolean;
  canRedo: boolean;
  isRewinding: boolean;
};

function rebuildMetaCache(): void {
  const busy = attachedStore?.isBusy === true;
  const entries: TimelineMetaEntry[] = activePathRanges(tree).map(
    ({ node, startIndex, count }) => ({
      id: node.id,
      label: humanizeTurnLabel(node.label),
      source: node.source,
      createdAt: node.createdAt,
      stateOnly: node.stateOnly,
      messageCount: count,
      startIndex,
      // Alternatives are the node's OTHER children: they fork from this
      // point forward, so the chip renders after the node's messages.
      alternatives: forkAlternativesForNode(node),
    }),
  );
  const leaf = tree.nodes.get(tree.activeLeafId);
  metaCache = {
    entries,
    canUndo: leaf?.parent != null && !busy,
    canRedo: leaf?.lastActiveChild != null && !busy,
    isRewinding: rewindSavedLeafId != null,
  };
}

// Turn labels start as internal identifiers (action names, reconcile
// markers); the meta layer translates them into reader-facing text.
const LABEL_OVERRIDES: Record<string, string> = {
  initial: "Starting point",
  reloaded: "Restored from save",
  imported: "Imported project",
  setDescription: "Edited description",
  setName: "Edited name",
  setPurpose: "Edited purpose",
  setContent: "Edited content",
};

function humanizeTurnLabel(label: string): string {
  const override = LABEL_OVERRIDES[label];
  if (override != null) return override;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Reader-facing summary of a branch's first meaningful message. */
function branchPreview(node: TurnNode): string {
  for (const message of node.messages) {
    const blocks = (message as { content?: unknown }).content;
    if (!Array.isArray(blocks)) continue;
    const text = blocks
      .filter((block) => (block as { type?: unknown })?.type === "text")
      .map((block) => String((block as { text?: unknown }).text ?? ""))
      .join("")
      .trim();
    if (text.length === 0) continue;
    // Stage commands are posted as JSON payloads; describe them as actions.
    const command = parseCommandMessage(text);
    if (command != null) return describeCommand(command);
    return text.length > 64 ? `${text.slice(0, 64)}…` : text;
  }
  return humanizeTurnLabel(node.label);
}

function forkAlternativesForNode(
  node: TurnNode,
): TimelineMetaEntry["alternatives"] {
  if (node.children.length <= 1) return [];
  return node.children
    .filter((childId) => childId !== node.lastActiveChild)
    .map((childId) => {
      const child = tree.nodes.get(childId);
      if (child == null) return null;
      return {
        id: branchLeaf(tree, childId),
        label: humanizeTurnLabel(child.label),
        createdAt: child.createdAt,
        preview: branchPreview(child),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);
}

function notify(): void {
  rebuildMetaCache();
  listeners.forEach((listener) => listener());
  scheduleSave();
}

export function onTimelineChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTimelineMeta(): TimelineMeta {
  return metaCache;
}

/** Close an open coalescing run (wired to text-field blur). */
export function commitTimelineSegment(): void {
  tailMarker = null;
}

function snapshotNow(): Record<string, unknown> {
  return getSnapshot(attachedStore as never) as unknown as Record<string, unknown>;
}

function restoreStateAt(nodeId: string): void {
  const node = tree.nodes.get(nodeId);
  if (node == null || attachedStore == null) return;
  const fromNode = tree.nodes.get(tree.activeLeafId);
  restoring = true;
  try {
    // One explicit batch: every observer reaction (mobx or the timeline
    // meta listeners) must observe the fully restored tree, never an
    // intermediate one, and must be scheduled exactly once for this
    // restore.
    runInAction(() => {
      applySnapshot(
        attachedStore as never,
        restoreSnapshot(node.state, snapshotNow() as never) as never,
      );
      activateNode(tree, nodeId);
      tailMarker = null;
      notify();
      // Publish before this action ends so observers still see the
      // recorded subjects when they first read the restored values.
      emitChangeFocus(diffOps(fromNode?.state ?? node.state, node.state));
    });
  } finally {
    restoring = false;
  }
}

/**
 * Close the finished turn: capture the store state, graft a turn node under
 * the current node (or coalesce into the previous state-only text-edit
 * turn), and make it the active leaf. Restores are never recorded.
 */
function closeOpenTurn(
  step: TimelineStep,
  path: string,
  failed: boolean,
): void {
  if (restoring || attachedStore == null) return;

  const snapshot = snapshotNow() as never as {
    conversation: unknown[];
  } & Record<string, unknown>;
  // The graft parent is wherever the active leaf is at close — a rewind
  // inside the turn (regenerate) moves it, so slice the appended messages
  // from the parent's conversation length, not the turn-start length.
  const parent = tree.nodes.get(tree.activeLeafId);
  const parentLength = parent?.state.conversation.length ?? 0;
  const messages = snapshot.conversation.slice(parentLength);
  const state = captureState(snapshot as never);

  // Coalescing: a state-only text-edit turn following the same text-edit
  // turn on the same target path updates the previous turn in place.
  const isTextEdit = !failed && TEXT_EDIT_ACTIONS.has(step.label);
  const continuesRun =
    isTextEdit &&
    tailMarker != null &&
    tailMarker.name === step.label &&
    tailMarker.path === path &&
    parent?.stateOnly === true;
  tailMarker = isTextEdit ? { name: step.label, path } : null;

  // A committed attempt ends any pending rewind/regenerate.
  const endsRewind = rewindSavedLeafId != null;
  rewindSavedLeafId = null;

  if (continuesRun && parent != null) {
    updateNodeState(tree, parent.id, state, Date.now());
    notify();
    return;
  }

  // A turn that neither moved state nor added messages is not history:
  // recording it would only litter undo with no-op clones. The meta cache
  // still needs a refresh when the attempt ended a pending rewind.
  if (
    parent != null &&
    messages.length === 0 &&
    sameState(parent.state, state)
  ) {
    if (endsRewind) notify();
    return;
  }

  graftTurn(tree, tree.activeLeafId, {
    id: uuid(),
    messages: [...messages],
    state,
    stateOnly: messages.length === 0,
    source: step.kind,
    label: step.label,
    createdAt: Date.now(),
  });
  notify();
}

/**
 * Attach the timeline to a store instance. Idempotent per instance. The
 * store is used from outside only (middleware, getSnapshot, applySnapshot)
 * — it knows nothing about hashes or the timeline. When a persistence
 * adapter is provided, the tree is restored from it and every change is
 * flushed back (debounced; `flushTimeline` forces an immediate write).
 */
export function attachTimeline(
  store: AttachedStore,
  options?: AttachTimelineOptions,
): void {
  if (attachedInstances.has(store)) return;
  attachedInstances.add(store);
  disposer?.();
  if (saveTimer != null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  persistence = options?.persistence ?? null;
  attachedStore = store;
  tree.nodes.clear();
  tree.rootId = "";
  tree.activeLeafId = "";
  openTurn = null;
  tailMarker = null;
  rewindSavedLeafId = null;

  const middleware = createActionTrackingMiddleware2({
    // Root calls only. Admission is default-deny: while a declared turn
    // runs, every other root call (streaming flushes, thinking appends,
    // snapshot applications) folds into it silently; outside a turn, only
    // declared steps may open one.
    filter: (call) => {
      if (restoring) return false;
      if (call.parentCall != null) return false;
      if (openTurn != null) return call.id === openTurn.rootCallId;
      return stepDeclarations.has(call.name);
    },
    onStart: (call) => {
      openTurn = {
        step:
          stepDeclarations.get(call.name) ??
          { kind: "user" as const, label: call.name },
        rootCallId: call.id,
        beforeState: captureState(snapshotNow() as never),
      };
    },
    onFinish: (call, error) => {
      if (openTurn == null || call.id !== openTurn.rootCallId) return;
      const { step, beforeState } = openTurn;
      openTurn = null;
      closeOpenTurn(step, getPath(call.context), error != null);
      // AI-driven turns are not human edits: publish where the change
      // landed so the UI can navigate to the subject.
      if (step.kind === "ai") {
        emitChangeFocus(diffOps(beforeState, captureState(snapshotNow() as never)));
      }
    },
  });
  disposer = addMiddleware(store as never, middleware);

  // Restore the persisted tree when available; otherwise seed the root.
  let restored = false;
  if (persistence != null) {
    try {
      const saved = persistence.load();
      if (saved != null) {
        const payload = importTimelineData(saved as PersistedTimeline);
        tree.rootId = payload.rootId;
        tree.activeLeafId = payload.activeLeafId;
        for (const raw of payload.nodes) {
          const node = raw as TurnNode;
          if (
            typeof node?.id === "string" &&
            typeof node?.label === "string" &&
            node?.state != null
          ) {
            tree.nodes.set(node.id, node);
          }
        }
        if (!tree.nodes.has(tree.rootId)) throw new Error("Missing root node.");
        if (!tree.nodes.has(tree.activeLeafId)) {
          tree.activeLeafId = tree.rootId;
        }
        restored = true;
      }
    } catch (error) {
      console.warn("Stored timeline was invalid; starting fresh.", error);
      tree.nodes.clear();
      tree.rootId = "";
    }
  }
  if (restored) {
    // Repair persisted histories corrupted by the pre-fix `reloaded` path
    // (see `repairActivePathGaps` below). The persisted `reloaded` node
    // was `messages:[]` while its `state` already held the gap, leaving
    // `activePathRanges` sum < `leaf.state.conversation.length`.
    repairActivePathGaps();
  }
  if (!restored) {
    seedRoot("initial");
  } else {
    // Reconcile: if the store state moved on since the last flush, record
    // it as a system turn so the tree reflects reality.
    const snapshot = snapshotNow() as never as { conversation: unknown[] };
    const state = captureState(snapshot as never);
    const leaf = tree.nodes.get(tree.activeLeafId);
    if (leaf == null || !sameState(leaf.state, state)) {
      // Reconcile gaps (e.g. projectStorage saved more messages than the
      // timeline persistence). Capture the conversation delta as the turn's
      // messages so `nodeCoveringMessage` can locate every index; a pure
      // state-only turn would leave those messages addressable in the state
      // but invisible to the rewind index.
      const parentLength = leaf?.state.conversation.length ?? 0;
      const snapshotConversation = (snapshot as { conversation: unknown[] }).conversation;
      const messages = snapshotConversation.slice(parentLength);
      graftTurn(tree, tree.activeLeafId, {
        id: uuid(),
        messages: [...messages],
        state,
        stateOnly: messages.length === 0,
        source: "system",
        label: "reloaded",
        createdAt: Date.now(),
      });
    }
  }
  notify();
}

/**
 * Rewind to the state before the message at `messageIndex`: activates the
 * parent of the turn that posted it, reverting artifacts and conversation
 * together. Returns false when the message cannot be located.
 */
function repairActivePathGaps(): boolean {
  // Backfill any `reloaded` corruption where a turn's state holds more
  // conversation messages than its `messages` array accounts for. Fixes
  // already-loaded in-memory trees without requiring a full reload.
  let repaired = false;
  for (const node of activePath(tree)) {
    const resolvedConversation = resolveStateValues(node.state).conversation as unknown[];
    const parent = node.parent ? tree.nodes.get(node.parent) : null;
    const parentLen = parent
      ? (resolveStateValues(parent.state).conversation as unknown[]).length
      : 0;
    const expectedLen = resolvedConversation.length - parentLen;
    if (node.messages.length !== expectedLen) {
      node.messages = [...resolvedConversation.slice(parentLen)];
      node.stateOnly = node.messages.length === 0;
      repaired = true;
    }
  }
  if (repaired) rebuildMetaCache();
  return repaired;
}

export function beginRewind(messageIndex: number): boolean {
  if (attachedStore == null || attachedStore.isBusy === true) return false;
  let turn = nodeCoveringMessage(tree, messageIndex);
  if (turn?.parent == null) {
    // The in-memory tree may still be the pre-fix corrupted shape
    // (persisted `reloaded` with `0` messages). Repair and retry once
    // so the current session heals without a page reload.
    const ranges = activePathRanges(tree);
    const total = ranges.reduce((acc, r) => acc + r.count, 0);
    const leaf = tree.nodes.get(tree.activeLeafId);
    const leafLen = (leaf?.state as unknown as { conversation?: unknown[] })?.conversation?.length ?? 0;
    const storeLen = (attachedStore as unknown as { conversation?: unknown[] })?.conversation?.length ?? 0;
    if (messageIndex < storeLen && total !== leafLen && repairActivePathGaps()) {
      // Persist the healed shape so the next load is already correct.
      scheduleSave();
      turn = nodeCoveringMessage(tree, messageIndex);
    }
  }
  if (turn?.parent == null) return false;
  // Keep the original leaf for cancel: a nested rewind while already
  // rewinding must not overwrite the "before-rewind" save, otherwise
  // cancel would return to the intermediate rewound state instead of the
  // true pre-rewind leaf and the user must manually redo.
  if (rewindSavedLeafId == null) rewindSavedLeafId = tree.activeLeafId;
  restoreStateAt(turn.parent);
  return true;
}

/** Cancel a pending rewind: restore the exact pre-rewind state. */
export function cancelRewind(): void {
  if (rewindSavedLeafId == null) return;
  const leafId = rewindSavedLeafId;
  rewindSavedLeafId = null;
  restoreStateAt(leafId);
}

/** Clear a committed rewind (called when the follow-up message is sent). */
export function endRewind(): void {
  rewindSavedLeafId = null;
  notify();
}

/** Switch to a sibling branch by activating its remembered leaf. */
export function activateBranch(leafId: string): void {
  if (attachedStore == null || attachedStore.isBusy === true) return;
  restoreStateAt(branchLeaf(tree, leafId));
}

/** Undo: activate the parent of the current turn. */
export function undo(): void {
  if (attachedStore == null || attachedStore.isBusy === true) return;
  const leaf = tree.nodes.get(tree.activeLeafId);
  if (leaf?.parent == null) return;
  restoreStateAt(leaf.parent);
}

/** Redo: activate the last-active child of the current turn. */
export function redo(): void {
  if (attachedStore == null || attachedStore.isBusy === true) return;
  const leaf = tree.nodes.get(tree.activeLeafId);
  if (leaf?.lastActiveChild == null) return;
  restoreStateAt(leaf.lastActiveChild);
}

/** Jump to an arbitrary turn (history scrubber). */
export function jumpToNode(nodeId: string): void {
  if (attachedStore == null || attachedStore.isBusy === true) return;
  restoreStateAt(nodeId);
}

/**
 * The full timeline payload (turn nodes plus the content-addressed artifact
 * store): what persistence writes and what a debug export downloads. Sweeps
 * artifacts unreachable from the surviving nodes first — captures that were
 * coalesced away or skipped as no-ops would otherwise accumulate forever
 * and ride along in every save.
 */
export function getTimelineSnapshot(): PersistedTimeline | null {
  if (attachedStore == null || tree.rootId === "") return null;
  const survivors = [...tree.nodes.values()];
  collectArtifactGarbage(survivors.map((node) => node.state));
  return exportTimelineData({
    rootId: tree.rootId,
    activeLeafId: tree.activeLeafId,
    nodes: survivors,
  });
}

/**
 * Immediately persist the tree. On quota failure, prunes to the active path
 * and retries once.
 */
export function flushTimeline(): void {
  if (persistence == null || attachedStore == null) return;
  const payload = getTimelineSnapshot();
  if (payload != null && persistence.save(payload)) {
    return;
  }
  pruneTree(tree);
  notify();
  const retried = getTimelineSnapshot();
  if (retried != null && persistence.save(retried)) {
    return;
  }
  console.warn("Could not persist the conversation timeline.");
}

function scheduleSave(): void {
  if (persistence == null) return;
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushTimeline();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Reset the tree after a snapshot-replacing operation (project import) and
 * sweep artifacts unreachable from the new history.
 */
export function resetTimeline(): void {
  if (attachedStore == null) return;
  tree.nodes.clear();
  tree.rootId = "";
  tree.activeLeafId = "";
  openTurn = null;
  tailMarker = null;
  rewindSavedLeafId = null;
  seedRoot("imported");
  notify();
}

/**
 * Rewind to the state before the last message-bearing turn so a regenerate
 * can replace it. This is an internal re-position, not a pending user
 * decision: the old reply stays as a sibling branch, so nothing is armed
 * as cancellable.
 */
export function rewindBeforeLastTurn(): boolean {
  const leaf = tree.nodes.get(tree.activeLeafId);
  if (leaf == null) return false;
  let target = leaf.stateOnly ? null : leaf;
  if (target == null) {
    for (const node of [...activePath(tree)].reverse()) {
      if (node.messages.length > 0) {
        target = node;
        break;
      }
    }
  }
  if (target?.parent == null) return false;
  restoreStateAt(target.parent);
  return true;
}
