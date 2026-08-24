import {
  addMiddleware,
  applySnapshot,
  createActionTrackingMiddleware2,
  getRunningActionContext,
  getSnapshot,
  getPath,
} from "mobx-state-tree";

import { uuid } from "utilities";

import type { TimelineNode , PersistedTimeline } from "./serialize";
import {
  captureNode,
  collectArtifactGarbage,
  exportTimelineData,
  importTimelineData,
  restoreNode,
  sameNodeState,
} from "./serialize";

export type TimelinePersistence = {
  load: () => unknown;
  save: (data: PersistedTimeline) => boolean;
};

export type AttachTimelineOptions = {
  persistence?: TimelinePersistence;
};

type Source = { kind: "user" | "ai"; label: string };

type AttachedStore = { isBusy?: boolean };

let activeSource: Source | null = null;
// The middleware event id of the AI flow's root action while one runs.
// Streaming-driven store actions (conversation flushes, thinking appends)
// fire as their own root actions during the flow; only the flow's root
// itself may open a node — everything else folds into it silently.
let flowRootCallId: number | null = null;
// The AI flow's source, resolved at node close: the flow root *starts*
// before the wrapper body runs setTimelineSource, and the wrapper clears
// the source before the root finishes.
let flowSource: Source | null = null;
let attachedStore: AttachedStore | null = null;
let restoring = false;
let openNode: Source & { path: string } | null = null;
let disposer: (() => void) | null = null;
const nodes: TimelineNode[] = [];
let cursor = -1;

// Identifies the last recorded node for coalescing: a text-edit action
// following the same text-edit action on the same target path collapses.
let tailMarker: { name: string; path: string } | null = null;

const listeners = new Set<() => void>();
let metaCache: TimelineNode[] = [];

function notify(): void {
  metaCache = [...nodes];
  listeners.forEach((listener) => listener());
  scheduleSave();
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
 * Immediately persist the timeline. On quota failure, trims the oldest
 * history (keeping a floor) and retries once.
 */
export function flushTimeline(): void {
  if (persistence == null || attachedStore == null) return;
  if (persistence.save(exportTimelineData(nodes, cursor))) return;
  if (nodes.length > MIN_NODES_AFTER_TRIM) {
    const removed = nodes.length - MIN_NODES_AFTER_TRIM;
    nodes.splice(0, removed);
    cursor = Math.max(0, cursor - removed);
    collectArtifactGarbage(nodes);
    notify();
    if (persistence.save(exportTimelineData(nodes, cursor))) return;
  }
  console.warn("Could not persist the conversation timeline.");
}

/**
 * The generator() wrapper tags AI operations so nodes record their source.
 * Must be called inside the flow so the running action context identifies
 * the flow's root action.
 */
export function setTimelineSource(source: Source | null): void {
  activeSource = source;
  if (source != null && flowRootCallId == null) {
    flowRootCallId = getRunningActionContext()?.id ?? null;
    flowSource = source;
  }
}

export function timelineEntries(): TimelineNode[] {
  return metaCache;
}

export function timelineCursor(): number {
  return cursor;
}

export function canUndo(): boolean {
  return cursor > 0;
}

export function canRedo(): boolean {
  return cursor < nodes.length - 1;
}

export function onTimelineChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Close an open coalescing run (wired to text-field blur): the next
 * same-path text edit starts a fresh node even if no other action follows.
 */
export function commitTimelineSegment(): void {
  tailMarker = null;
}

function recordNode(source: Source & { path: string }): void {
  if (attachedStore == null) return;
  const snapshot = getSnapshot(attachedStore as never) as unknown as Parameters<
    typeof captureNode
  >[0];
  const effective = flowSource ?? activeSource ?? { kind: "user" as const, label: source.label };
  const node = captureNode(snapshot, {
    id: uuid(),
    label: effective.label,
    source: effective.kind,
    createdAt: Date.now(),
  });
  const previous = nodes[cursor];
  if (previous != null && sameNodeState(previous.state, node.state)) {
    tailMarker = null;
    return;
  }

  // Truncate any redo branch, then append.
  nodes.splice(cursor + 1);
  nodes.push(node);
  cursor = nodes.length - 1;

  // Coalescing: a text-edit action following the same text-edit action on
  // the same target path collapses into the previous node (the newer state
  // already wins; artifacts dedupe themselves).
  const isTextEdit = TEXT_EDIT_ACTIONS.has(source.label);
  const continuesRun =
    isTextEdit &&
    tailMarker != null &&
    tailMarker.name === source.label &&
    tailMarker.path === source.path;
  tailMarker = isTextEdit ? { name: source.label, path: source.path } : null;
  if (continuesRun && nodes.length >= 2) {
    nodes.splice(nodes.length - 2, 1);
    cursor = nodes.length - 1;
  }
  notify();
}

/** Text-edit actions coalesce into one node until a semantic boundary. */
const TEXT_EDIT_ACTIONS = new Set([
  "setContent",
  "setDescription",
]);

function closeOpenNode(failed: boolean): void {
  const source = openNode;
  openNode = null;
  void failed;
  if (source == null || restoring) return;
  recordNode(source);
}

const attachedInstances = new WeakSet<object>();
let persistence: TimelinePersistence | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 600;
const MIN_NODES_AFTER_TRIM = 20;

/**
 * Attach the timeline to a store instance. Idempotent per instance. The
 * store is used from outside only (middleware, getSnapshot, applySnapshot)
 * — it knows nothing about hashes or the timeline. When a persistence
 * adapter is provided, the timeline is restored from it and every change is
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
  nodes.length = 0;
  cursor = -1;
  openNode = null;
  tailMarker = null;

  const middleware = createActionTrackingMiddleware2({
    // Root calls only: a node records the entry into the store, never the
    // actions an action calls internally. While an AI flow runs, only the
    // flow's own root action opens a node — streaming-driven store actions
    // (conversation flushes, thinking appends) fold into it silently.
    filter: (call) => {
      if (restoring) return false;
      if (call.parentCall != null) return false;
      if (flowRootCallId != null) return call.id === flowRootCallId;
      return true;
    },
    onStart: (call) => {
      openNode = {
        ...(activeSource ?? { kind: "user" as const, label: call.name }),
        path: getPath(call.context),
      };
    },
    onFinish: (call, error) => {
      closeOpenNode(error != null);
      if (flowRootCallId != null && call.id === flowRootCallId) {
        flowRootCallId = null;
        flowSource = null;
      }
    },
  });
  disposer = addMiddleware(store as never, middleware);

  // Restore persisted history when available; otherwise seed the initial
  // node so undo can always return to "before anything".
  let restored = false;
  if (persistence != null) {
    try {
      const saved = persistence.load();
      if (saved != null) {
        const { nodes: restoredNodes, cursor: restoredCursor } =
          importTimelineData(saved as PersistedTimeline);
        nodes.push(...restoredNodes);
        cursor = restoredCursor;
        restored = true;
      }
    } catch (error) {
      console.warn("Stored timeline was invalid; starting fresh.", error);
      nodes.length = 0;
      cursor = -1;
    }
  }
  if (!restored) {
    recordNode({ kind: "user", label: "initial", path: "/" });
  } else {
    // Reconcile: if the store state moved on since the last flush (or the
    // snapshot matches exactly, this records nothing) — the timeline then
    // reflects reality.
    recordNode({ kind: "user", label: "reloaded", path: "/" });
  }
  notify();
}

function withStore(
  action: (store: AttachedStore) => void,
): void {
  const store = attachedStore;
  if (store == null || store.isBusy === true) return;
  action(store);
}

function restoreAt(index: number): void {
  if (attachedStore == null) return;
  if (index < 0 || index >= nodes.length || index === cursor) return;
  restoring = true;
  try {
    const current = getSnapshot(attachedStore as never) as unknown as Record<
      string,
      unknown
    >;
    applySnapshot(
      attachedStore as never,
      restoreNode(nodes[index], current as never) as never,
    );
    cursor = index;
    tailMarker = null;
    notify();
  } finally {
    restoring = false;
  }
}

/** Undo: restore the state of the node before the cursor. */
export function undo(): void {
  withStore(() => {
    if (!canUndo()) return;
    restoreAt(cursor - 1);
  });
}

/** Redo: restore the state of the node after the cursor. */
export function redo(): void {
  withStore(() => {
    if (!canRedo()) return;
    restoreAt(cursor + 1);
  });
}

/** Jump to an arbitrary node index (timeline scrubber). */
export function jumpToNode(index: number): void {
  withStore(() => {
    restoreAt(index);
  });
}

/**
 * Reset the timeline after a snapshot-replacing operation (project import)
 * and sweep artifacts unreachable from the new history.
 */
export function resetTimeline(): void {
  withStore(() => {
    nodes.length = 0;
    cursor = -1;
    openNode = null;
    tailMarker = null;
    recordNode({ kind: "user", label: "imported", path: "/" });
    collectArtifactGarbage(nodes);
    notify();
  });
}
