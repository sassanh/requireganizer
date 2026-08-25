# Undo/redo timeline

The conversation **is** the timeline: every top-level action grafts a *turn node* into a tree, and the visible conversation is the active root-to-leaf path of that tree.

## Turn nodes reference artifacts by hash

The store is never modified to support the timeline. Two pure functions bridge the worlds:

- `captureState(snapshot)` decomposes a store snapshot into **artifacts** (the description, each fragment, each conversation message, each scaffold file, whole objects like the boundary design), hashes each with **sha256 truncated to 20 hex characters** over its canonical JSON, writes unseen artifacts into a content-addressed object store, and produces a **state tree**: the store's own data-structure tree with artifact leaves replaced by their hashes. Unchanged subtrees are memoized by object reference, so capturing a state after a small edit costs one hash computation.
- `restoreSnapshot(state, current)` resolves every hash back into original content and rebuilds the snapshot; `applySnapshot` then clears and refills the store, which remains a completely normal store that never learns hashes exist.

Because artifacts are content-addressed, adjacent turns typically share ~99% of their hashes and identical data is stored exactly once. A mark-and-sweep garbage-collects artifacts when the timeline resets or after quota-driven pruning.

## The tree

```ts
type TurnNode = {
  id, parent, children[], lastActiveChild,
  messages[],       // the messages this turn appended (payload)
  state: StateTree, // full store state after this turn, hash-referenced
  stateOnly,        // true for pure state edits (coalesced keystrokes)
  source, label, createdAt,
};
```

- **One turn per top-level action.** An `createActionTrackingMiddleware2` filter admits root action calls only; while an AI flow runs, only the flow's root opens a turn — streaming-driven store actions fold into it silently. The `generator()` wrapper tags flows so turns record `source: "ai"` with the operation label.
- **Undo** = activate the parent turn. **Redo** = activate the last-active child. **Rewind to a message** = activate the parent of the turn that posted it (artifacts and conversation revert together). **Cancel** = re-activate the saved leaf. **Commit** = the next send grafts a new child under the rewound turn; the discarded path remains a switchable sibling branch. **Branch switch** = activate a sibling subtree's remembered leaf. All are pure tree walks plus one `applySnapshot`.
- Coalesced keystroke edits become **state-only nodes** (no messages); the conversation renderer filters them, the history panel shows them in italics.
- The store's `conversation` prop is the **materialized active path**: the tree is the persistent authority, and on load/branch-switch/rewind the store is rebuilt from the active leaf's state.

## Persistence

The whole tree (nodes, root, active leaf) plus the artifact store is persisted per project (schema v3) with debounced writes and a `beforeunload` flush. On quota failure the tree prunes to the active path and retries. On load, a malformed payload starts a fresh tree. The store snapshot itself remains the authority for the *current* state: after a reload the timeline reconciles by appending the live state if it differs from the active leaf, so pre-reload history stays reachable through undo.

## Conversation integration

The pane header carries undo/redo buttons and a history panel (active-path outline; clicking jumps to that turn). Fork chips render at each node with sibling branches, offering one-click switching. Rewind prefills the composer with the message being rewritten; cancel restores the exact pre-rewind state with a blink on the anchor message. Undo/redo/rewind/switching are disabled while an AI operation runs, in the UI and in the controller logic. `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` work when focus is outside text fields.

## Scope

Per-project and per-browser (schema v3; older persisted projects are rejected by the schema gate). Ephemeral UI state (validation banners, sidebar visibility) is excluded and survives restores unchanged.
