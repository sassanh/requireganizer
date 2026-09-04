import { ReactNode, memo, useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  claim,
  complete,
  getPresentationTick,
  isPresenting,
} from "presentation";

import { presentationMs, presentationSeconds } from "./animation";
import { ITEM_MOTION_SECONDS } from "./itemMotion";
import { scrollPresentationIntoView } from "./scrollFollower";

export function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

export function insertPresentedId(
  current: string[],
  id: string,
  liveIds: string[],
): string[] {
  if (current.includes(id)) return current;
  const targetIndex = liveIds.indexOf(id);
  if (targetIndex === -1) return [...current, id];

  for (let i = targetIndex + 1; i < liveIds.length; i++) {
    const nextId = liveIds[i];
    const currentIndex = current.indexOf(nextId);
    if (currentIndex !== -1) {
      const copy = [...current];
      copy.splice(currentIndex, 0, id);
      return copy;
    }
  }

  for (let i = targetIndex - 1; i >= 0; i--) {
    const prevId = liveIds[i];
    const currentIndex = current.indexOf(prevId);
    if (currentIndex !== -1) {
      const copy = [...current];
      copy.splice(currentIndex + 1, 0, id);
      return copy;
    }
  }

  return [...current, id];
}

/**
 * Follow liveIds from the presentation replica. Idle updates snap
 * immediately. While the sequencer is presenting, animate the one-id
 * membership diff and claim/complete that tick.
 */
export function useMembershipTurns(liveIds: string[]): {
  presentedIds: string[];
  enteringIds: Set<string>;
  exitingIds: Set<string>;
  exitHeightFor: (id: string) => number | undefined;
  seqFor: (id: string) => number;
  itemRef: (id: string) => (node: HTMLDivElement | null) => void;
} {
  const liveIdsUnique = uniqueIds(liveIds);
  const [presentedIds, setPresentedIds] = useState<string[]>(liveIdsUnique);
  const [enteringIds, setEnteringIds] = useState(() => new Set<string>());
  const [exitingIds, setExitingIds] = useState(() => new Set<string>());
  const presentedIdsRef = useRef(presentedIds);
  // eslint-disable-next-line react-hooks/refs -- sync for next effect
  presentedIdsRef.current = presentedIds;
  const liveIdsRef = useRef(liveIdsUnique);
  // eslint-disable-next-line react-hooks/refs -- sync for next effect
  liveIdsRef.current = liveIdsUnique;
  const sessionRef = useRef({
    tick: 0,
    completed: true,
    alive: false,
  });
  const seqRef = useRef(0);
  const seqByIdRef = useRef(new Map<string, number>());
  const nodesRef = useRef(new Map<string, HTMLDivElement>());
  const exitHeightRef = useRef(new Map<string, number>());
  const liveKey = liveIdsUnique.join("\n");

  useLayoutEffect(() => {
    const presented = presentedIdsRef.current;
    if (liveKey === presented.join("\n")) return;
    const ids = liveIdsRef.current;

    if (!isPresenting()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snap membership when not presenting
      setEnteringIds(new Set());
      setExitingIds(new Set());
      setPresentedIds(ids);
      return;
    }

    const incoming = new Set(ids);
    const added = ids.filter((id) => !presented.includes(id));
    const removed = presented.filter((id) => !incoming.has(id));
    const tick = getPresentationTick();
    const session = sessionRef.current;
    session.alive = true;
    if (session.tick !== tick || session.completed) {
      claim(tick);
      session.tick = tick;
      session.completed = false;
    }

    if (added.length > 0) {
      const id = added[0]!;
      seqByIdRef.current.set(id, seqRef.current++);
      setPresentedIds((current) =>
        uniqueIds(insertPresentedId(current, id, ids)),
      );
      setEnteringIds(new Set([id]));
      requestAnimationFrame(() => {
        const node = nodesRef.current.get(id);
        if (node != null) scrollPresentationIntoView(node);
      });
    } else if (removed.length > 0) {
      const id = removed[0]!;
      const node = nodesRef.current.get(id);
      if (node != null) {
        exitHeightRef.current.set(id, node.getBoundingClientRect().height);
        scrollPresentationIntoView(node, "nearest");
      }
      setExitingIds(new Set([id]));
    }

    const timer = setTimeout(() => {
      if (session.completed || session.tick !== tick) return;
      if (removed.length > 0) {
        const id = removed[0]!;
        exitHeightRef.current.delete(id);
        setPresentedIds((current) => current.filter((kept) => kept !== id));
        setExitingIds(new Set());
      }
      setEnteringIds(new Set());
      session.completed = true;
      complete(tick);
    }, presentationMs(ITEM_MOTION_SECONDS * 1000));

    return () => {
      clearTimeout(timer);
      session.alive = false;
      queueMicrotask(() => {
        if (!session.alive && !session.completed && session.tick === tick) {
          session.completed = true;
          complete(tick);
        }
      });
    };
  }, [liveKey]);

  return {
    presentedIds,
    enteringIds,
    exitingIds,
    exitHeightFor: (id) => exitHeightRef.current.get(id),
    seqFor: (id) => seqByIdRef.current.get(id) ?? 0,
    itemRef: (id) => (node) => {
      if (node == null) nodesRef.current.delete(id);
      else nodesRef.current.set(id, node);
    },
  };
}

/**
 * Seconds the outer box takes to settle its height. Entrances need none:
 * the box has no clipping, so it simply sits at full height while the
 * sideways glide carries the motion. Exits hold at the measured height for
 * a frame, then collapse.
 */
function exitHeightDuration(exiting: boolean, collapse: boolean): number {
  if (exiting && !collapse) return 0;
  return presentationSeconds(ITEM_MOTION_SECONDS);
}

export function MembershipMotion({
  id,
  entering,
  exiting,
  exitHeight,
  itemRef,
  children,
}: {
  id: string;
  entering: boolean;
  exiting: boolean;
  exitHeight?: number;
  itemRef: (id: string) => (node: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const [collapse, setCollapse] = useState(false);
  // The sideways glide runs as a plain CSS transition so the compositor
  // carries it through the next card's mount work on the main thread.
  const [slidIn, setSlidIn] = useState(false);
  useLayoutEffect(() => {
    if (!entering) return;
    const frame = requestAnimationFrame(() => setSlidIn(true));
    return () => {
      cancelAnimationFrame(frame);
      setSlidIn(false);
    };
  }, [entering]);
  useLayoutEffect(() => {
    if (!exiting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- collapse animates on exit
      setCollapse(false);
      return;
    }
    const frame = requestAnimationFrame(() => setCollapse(true));
    return () => cancelAnimationFrame(frame);
  }, [exiting]);

  return (
    <div
      ref={itemRef(id)}
      style={{
        height: exiting ? (collapse ? 0 : (exitHeight ?? "auto")) : "auto",
        transitionProperty: "height",
        transitionDuration: `${exitHeightDuration(exiting, collapse)}s`,
        transitionTimingFunction: "ease-in-out",
        overflow: "hidden",
        overflowAnchor: entering || exiting ? "none" : "auto",
      }}
    >
      <div
        style={{
          transform: exiting
            ? "translateX(100%)"
            : entering && !slidIn
              ? "translateX(100%)"
              : "none",
          transitionProperty: "transform",
          transitionDuration: `${presentationSeconds(ITEM_MOTION_SECONDS)}s`,
          transitionTimingFunction: "ease-in-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A membership row that survives its siblings' arrivals: list re-renders
 * only reach rows whose play state changed, so adding card 28 costs one
 * fresh row instead of re-rendering 27 settled ones. `itemRef` is outside
 * the comparison; it closes over a stable node map.
 */
export const MemoMembershipMotion = memo(
  MembershipMotion,
  (prev, next) =>
    prev.id === next.id &&
    prev.entering === next.entering &&
    prev.exiting === next.exiting &&
    prev.exitHeight === next.exitHeight &&
    prev.children === next.children,
);

/**
 * Row content cached per key across list renders: the memoized row above
 * only skips settled rows while it keeps receiving the identical element.
 * The key must capture everything the built content reads (identity,
 * position, labels, flags) — a stale key shows stale content. Appends
 * reuse settled rows' keys, so only the arriving row builds.
 */
export function useMembershipContent(): (
  key: string,
  build: () => ReactNode,
) => ReactNode {
  const cacheRef = useRef(new Map<string, ReactNode>());
  return useCallback((key: string, build: () => ReactNode) => {
    const hit = cacheRef.current.get(key);
    if (hit !== undefined) return hit;
    const node = build();
    cacheRef.current.set(key, node);
    return node;
  }, []);
}
