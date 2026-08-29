import { applySnapshot, getSnapshot, onSnapshot } from "mobx-state-tree";

import { Step } from "store/constants";
import type { Store } from "store/store";
import {
  getCurrentStepKind,
  onChangeFocus,
  SUBJECT_KEYS,
  type ChangeFocusOp,
} from "store/timeline/controller";

import { applyOpToTree } from "./applyOp";
import { stepForSubject } from "./steps";

export const UNCLAIMED_MILLISECONDS = 100;
export const SAFETY_MILLISECONDS = 5000;

export type PresentationNav = {
  getStep: () => Step;
  requestStep: (step: Step) => void;
  isVisible: (step: Step) => boolean;
};

type ValueFrame = { kind: "value"; op: ChangeFocusOp };
type NavigateFrame = { kind: "navigate"; step: Step };
type Frame = ValueFrame | NavigateFrame;

type Latch = { tick: number; claims: number };

let replica: Store | null = null;
let realStore: Store | null = null;
let nav: PresentationNav | null = null;
let unsubFocus: (() => void) | null = null;
let unsubSnap: (() => void) | null = null;

const queue: Frame[] = [];
let latch: Latch = { tick: 0, claims: 0 };
let presenting = false;
let pendingNavigate: Step | null = null;
let presentingNavigate: Step | null = null;
let presentationVersion = 0;
const presentationListeners = new Set<() => void>();
let unclaimedTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

function bumpPresentation(): void {
  presentationVersion += 1;
  for (const listener of presentationListeners) listener();
}

function assignPresentingNavigate(step: Step | null): void {
  if (presentingNavigate === step) return;
  presentingNavigate = step;
  bumpPresentation();
}

/** Subscribe to navigate-presentation changes. Factory reads replica via
 * MobX; this flag is module state, so the tab rail must subscribe. */
export function subscribePresentation(listener: () => void): () => void {
  presentationListeners.add(listener);
  return () => {
    presentationListeners.delete(listener);
  };
}

export function getPresentationVersion(): number {
  return presentationVersion;
}

function clearTimers(): void {
  if (unclaimedTimer != null) {
    clearTimeout(unclaimedTimer);
    unclaimedTimer = null;
  }
  if (safetyTimer != null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

function isIdle(): boolean {
  return (
    queue.length === 0 &&
    !presenting &&
    pendingNavigate == null &&
    presentingNavigate == null
  );
}

function hasSubjectDiff(): boolean {
  if (replica == null || realStore == null) return false;
  const replicaSnap = getSnapshot(replica) as Record<string, unknown>;
  const realSnap = getSnapshot(realStore) as Record<string, unknown>;
  for (const key of SUBJECT_KEYS) {
    if (JSON.stringify(replicaSnap[key]) !== JSON.stringify(realSnap[key])) {
      return true;
    }
  }
  return false;
}

function catchUpFromReal(): void {
  if (replica == null || realStore == null) return;
  applySnapshot(replica, getSnapshot(realStore));
}

function plannedStep(): Step | null {
  if (nav == null) return null;
  let step = nav.getStep();
  for (const frame of queue) {
    if (frame.kind === "navigate") step = frame.step;
  }
  return step;
}

function collectionKey(op: ChangeFocusOp): string {
  const parts = op.subject.split("/").filter((part) => part.length > 0);
  parts.pop();
  return parts.join("/");
}

/** Play list removals last-to-first. Adds stay first-to-last. */
function playOrder(ops: ChangeFocusOp[]): ChangeFocusOp[] {
  const ordered: ChangeFocusOp[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.kind !== "remove") {
      ordered.push(op);
      i += 1;
      continue;
    }
    const key = collectionKey(op);
    const run: ChangeFocusOp[] = [];
    while (
      i < ops.length &&
      ops[i]!.kind === "remove" &&
      collectionKey(ops[i]!) === key
    ) {
      run.push(ops[i]!);
      i += 1;
    }
    ordered.push(...run.reverse());
  }
  return ordered;
}

function enqueueOps(ops: ChangeFocusOp[]): void {
  let step = plannedStep();
  for (const op of playOrder(ops)) {
    const needed = stepForSubject(op.subject);
    if (needed != null && step != null && needed !== step) {
      queue.push({ kind: "navigate", step: needed });
      step = needed;
    }
    queue.push({ kind: "value", op });
  }
}

function applyReplicaSnapshot(tree: Record<string, unknown>): void {
  if (replica == null) return;
  try {
    applySnapshot(replica, tree as never);
  } catch (error) {
    console.error("Presentation replica could not apply a change.", error);
  }
}

function armPresentTimers(tick: number): void {
  unclaimedTimer = setTimeout(() => {
    if (latch.tick !== tick) return;
    if (latch.claims !== 0) return;
    advance();
  }, UNCLAIMED_MILLISECONDS);

  safetyTimer = setTimeout(() => {
    if (latch.tick !== tick) return;
    advance();
  }, SAFETY_MILLISECONDS);
}

function advance(): void {
  clearTimers();
  pendingNavigate = null;
  assignPresentingNavigate(null);
  presenting = false;
  applyHead();
}

function beginNavigatePresent(step: Step): void {
  pendingNavigate = null;
  presenting = true;
  assignPresentingNavigate(step);
  armPresentTimers(latch.tick);
}

function applyHead(): void {
  if (replica == null) return;
  const frame = queue.shift();
  if (frame == null) {
    presenting = false;
    pendingNavigate = null;
    assignPresentingNavigate(null);
    catchUpFromReal();
    return;
  }

  if (frame.kind === "navigate") {
    nav?.requestStep(frame.step);
    if (nav?.isVisible(frame.step) === true) {
      assignPresentingNavigate(frame.step);
      // Visible: navigate does not block the value queue. Continue
      // immediately to the next frame without consuming a presenter tick.
      // Clear any stale presenting state and recurse.
      presenting = false;
      assignPresentingNavigate(null);
      applyHead();
      return;
    }
    // Not visible: wait for the step to become visible.
    latch = { tick: latch.tick + 1, claims: 0 };
    const tick = latch.tick;
    pendingNavigate = frame.step;
    assignPresentingNavigate(frame.step);
    safetyTimer = setTimeout(() => {
      if (latch.tick !== tick) return;
      advance();
    }, SAFETY_MILLISECONDS);
    return;
  }

  latch = { tick: latch.tick + 1, claims: 0 };
  const tick = latch.tick;
  presenting = true;
  applyReplicaSnapshot(
    applyOpToTree(
      getSnapshot(replica) as Record<string, unknown>,
      frame.op,
    ),
  );
  armPresentTimers(tick);
}

export function getPresentationTick(): number {
  return latch.tick;
}

export function isPresenting(): boolean {
  return presenting;
}

/** Step whose tab is the presenter for the current navigate tick, if any. */
export function getPresentingNavigate(): Step | null {
  return presentingNavigate;
}

export function claim(tick: number): void {
  if (tick !== latch.tick) return;
  latch.claims += 1;
}

export function complete(tick: number): void {
  if (tick !== latch.tick) return;
  if (latch.claims === 0) return;
  latch.claims -= 1;
  if (latch.claims === 0) advance();
}

export function noteVisibleStep(step: Step): void {
  if (pendingNavigate == null) return;
  if (step !== pendingNavigate) return;
  if (nav?.isVisible(step) !== true) return;
  clearTimers();
  pendingNavigate = null;
  assignPresentingNavigate(null);
  presenting = false;
  applyHead();
}

/**
 * Bind the presentation replica to the real store. Presenters read the
 * replica; recorded change-focus ops walk it one frame at a time. Human
 * edits (no change-focus) mirror immediately while idle.
 *
 * Idle snapshot sync is deferred a microtask so a recorded action's
 * change-focus (middleware onFinish) always starts the queue before the
 * real store's snapshot can copy the finished tree onto the replica.
 */
export function attachPresentation(
  presentation: Store,
  real: Store,
): () => void {
  replica = presentation;
  realStore = real;
  unsubFocus?.();
  unsubSnap?.();
  unsubFocus = onChangeFocus((focus) => {
    if (replica == null) return;
    const idle = isIdle();
    enqueueOps(focus.ops);
    if (idle) applyHead();
  });
  unsubSnap = onSnapshot(real, () => {
    const kind = getCurrentStepKind();
    if (kind === "user") {
      if (isIdle()) {
        syncPresentationFrom(real);
      } else {
        queueMicrotask(() => {
          syncPresentationFrom(real);
        });
      }
      return;
    }
    queueMicrotask(() => {
      if (kind === "ai" && hasSubjectDiff()) return;
      syncPresentationFrom(real);
    });
  });
  return () => {
    unsubFocus?.();
    unsubFocus = null;
    unsubSnap?.();
    unsubSnap = null;
  };
}

/** Human / unrecorded: replica catches up immediately when idle. */
export function syncPresentationFrom(real: Store): void {
  if (replica == null) return;
  if (!isIdle()) return;
  applySnapshot(replica, getSnapshot(real));
}

export function resetPresentation(): void {
  clearTimers();
  queue.length = 0;
  latch = { tick: 0, claims: 0 };
  presenting = false;
  pendingNavigate = null;
  assignPresentingNavigate(null);
  unsubFocus?.();
  unsubFocus = null;
  unsubSnap?.();
  unsubSnap = null;
  replica = null;
  realStore = null;
}

export function setPresentationNav(navigation: PresentationNav): void {
  nav = navigation;
}
