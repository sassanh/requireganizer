# Undo/redo timeline

Every mutation of the project store is recorded on an undo/redo timeline that is tightly integrated with the AI conversation pane.

## Nodes reference artifacts by hash

The store is never modified to support the timeline. Two pure functions bridge the worlds:

- `captureNode(snapshot)` decomposes a store snapshot into **artifacts** (the description, each fragment, each conversation message, each branch record, each scaffold file, whole objects like the boundary design), hashes each with **sha256 truncated to 20 hex characters** over its canonical JSON, writes unseen artifacts into a content-addressed object store, and produces a **node**: the store's own data-structure tree with artifact leaves replaced by their hashes. Unchanged subtrees are memoized by object reference, so capturing a node after a small edit costs one hash computation.
- `restoreNode(node, current)` resolves every hash back into original content and rebuilds the snapshot; `applySnapshot` then clears and refills the store, which remains a completely normal store that never learns hashes exist.

Because artifacts are content-addressed, adjacent nodes typically share ~99% of their hashes and identical data is stored exactly once. A mark-and-sweep garbage-collects artifacts when the timeline resets (project import).

## One node per top-level action

An `createActionTrackingMiddleware2` filter admits **root action calls only** (`parentCall == null`): a node records the entry into the store, no matter how many actions the action calls internally. While an AI flow runs, only the flow's own root action opens a node — the streaming-driven store actions (conversation flushes, thinking appends) fold into it silently. The `generator()` wrapper tags the flow so nodes record `source: "ai"` with the operation label; everything else records as `source: "user"`.

## Keystrokes coalesce semantically

Consecutive text-edit actions on the same target path (`setContent`, `setDescription`, …) collapse into a single node. A coalescing run ends when a different action starts, when an AI operation begins, or when the field blurs (`commitTimelineSegment`). No timers.

## Conversation integration

The pane header carries undo/redo buttons and a history panel; every row shows its source (user/AI), label, and time, and jumping to a node restores that exact state — conversation and artifacts together, never diverging. `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` work when focus is outside text fields. Undo/redo are disabled while an AI operation runs, in the UI and in the controller logic.

## Persistence

The timeline survives reloads. Each project stores its timeline (nodes, cursor, and the artifact store) under its own localStorage key, written through a persistence adapter passed at attach time. Writes are debounced (600 ms) and flushed on `beforeunload`; on quota failure the oldest history is trimmed (keeping a floor) and the write retried before giving up. On load, a malformed payload starts a fresh timeline. The store snapshot itself remains the authority for the *current* state: after a reload the timeline reconciles by appending the live state if it differs from the last persisted node, so pre-reload history stays reachable through undo.

## Scope

The timeline is per-project and per-browser (clearing site data or switching devices starts fresh). Ephemeral UI state (validation banners, system messages, sidebar visibility) is excluded and survives restores unchanged.
