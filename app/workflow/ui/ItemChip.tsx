"use client";

import { Box, Chip, Stack, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { createContext, type FocusEvent, type MouseEvent, type ReactNode, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

import type { NamedItem, OutOfDateCause } from "../module";
import { LINK_REASON_LABELS, type LinkReason, REMOVED_ITEM } from "../units";
import { placeOf, useOpenUnit, useWorkflowView } from "./context";
import VersionDiff from "./VersionDiff";
import WrittenText from "./WrittenText";

/** How the page names an item: its code, "Module/CODE" for an item of another module, or "removed item" once it no longer exists. */
export function useItemName(): (id: string) => string {
  const { module } = useWorkflowView();
  return (id) => module.itemNameOf(id) ?? REMOVED_ITEM;
}

/**
 * An item as a chip reads: its name, then `detail`, such as the name an
 * items field shows, then each reason it makes an out-of-date item out of
 * date, such as "REQ-40 · not approved".
 */
export function useItemLabel(): (id: string, options?: { detail?: string; reasons?: readonly LinkReason[] }) => string {
  const { module } = useWorkflowView();
  return (id, { detail, reasons = [] } = {}) => {
    const named = module.namedItem(id);
    if (named == null) return REMOVED_ITEM;
    const name = detail == null || detail === named.code ? named.name : `${named.name} ${detail}`;
    return reasons.length === 0 ? name : `${name} · ${reasons.map((reason) => LINK_REASON_LABELS[reason]).join(" and ")}`;
  };
}

/** A named item at a glance: its code, kind, how it changed when that is known, its text, stage and whether it is approved. */
function ItemPreview({ item, change }: { item: NamedItem; change: OutOfDateCause["change"] }) {
  const { workflow } = useWorkflowView();
  return (
    <Stack spacing={0.5} sx={{ py: 0.5 }}>
      <Stack direction="row" sx={{ alignItems: "baseline", gap: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{item.name}</Typography>
        <Typography variant="caption">{workflow.kind(item.kind).label}</Typography>
      </Stack>
      {change != null && <VersionDiff kind={item.kind} signed={change.from} current={change.to} caption="Since the version referenced here" />}
      <WrittenText text={item.text} />
      <Typography variant="caption">
        {workflow.stage(item.stage).label} · {item.approved ? "Approved" : item.phase === "removed" ? "Removed" : "Not approved"}
      </Typography>
    </Stack>
  );
}

/** How long the pointer rests on a chip before its preview shows, as MUI's tooltip waits. */
const PREVIEW_DELAY_MS = 100;

interface ItemPreviews {
  /** Show `content` beside the chip `anchor` once the pointer rests on it, or at once on keyboard focus. */
  show(anchor: HTMLElement, content: ReactNode, at: "pointer" | "focus"): void;
  /** Take the preview of `anchor` away, if it shows or is about to. */
  hide(anchor: HTMLElement): void;
}

const itemPreviewContext = createContext<ItemPreviews | null>(null);

/**
 * The one preview every item chip of the page shows its item in: MUI's
 * tooltip, beside whichever chip the pointer rests on or the keyboard
 * focuses. A stage shows hundreds of chips, and a tooltip of each chip's own
 * would cost more to render than all the rest of its card.
 */
export function ItemPreviewProvider({ children }: { children: ReactNode }) {
  const id = useId();
  const [shown, setShown] = useState<{ anchor: HTMLElement; content: ReactNode } | null>(null);
  /** The chip whose preview shows once the pointer has rested on it long enough. */
  const pending = useRef<{ anchor: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancel = () => {
    if (pending.current != null) clearTimeout(pending.current.timer);
    pending.current = null;
  };
  const previews = useMemo<ItemPreviews>(
    () => ({
      show: (anchor, content, at) => {
        cancel();
        const open = () => {
          pending.current = null;
          setShown({ anchor, content });
        };
        if (at === "focus") open();
        else pending.current = { anchor, timer: setTimeout(open, PREVIEW_DELAY_MS) };
      },
      hide: (anchor) => {
        if (pending.current?.anchor === anchor) cancel();
        setShown((current) => (current?.anchor === anchor ? null : current));
      },
    }),
    [],
  );
  useEffect(() => cancel, []);

  // The chip is described by its preview while it shows, and Escape takes the preview away, as for MUI's tooltip.
  useEffect(() => {
    if (shown == null) return;
    const { anchor } = shown;
    anchor.setAttribute("aria-describedby", id);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShown(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      anchor.removeAttribute("aria-describedby");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [shown, id]);

  return (
    <itemPreviewContext.Provider value={previews}>
      {children}
      {shown != null && (
        <Tooltip id={id} open title={shown.content} describeChild disableInteractive slotProps={{ tooltip: { sx: { maxWidth: 440 } }, popper: { anchorEl: shown.anchor } }}>
          <Box component="span" sx={{ display: "none" }} />
        </Tooltip>
      )}
    </itemPreviewContext.Provider>
  );
}

/** Hovering or focusing the chip `content` belongs to previews it; returns the chip's handlers, with the ref that takes it away should the chip go. */
function usePreview(content: () => ReactNode) {
  const previews = useContext(itemPreviewContext);
  if (previews == null) throw new Error("An item chip must be inside an item preview provider.");
  const chip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = chip.current;
    return () => {
      if (element != null) previews.hide(element);
    };
  }, [previews]);
  return {
    ref: chip,
    onMouseEnter: (event: MouseEvent<HTMLElement>) => previews.show(event.currentTarget, content(), "pointer"),
    onMouseLeave: (event: MouseEvent<HTMLElement>) => previews.hide(event.currentTarget),
    // Only focus the keyboard gave, as MUI's tooltip opens: a click focuses the chip too.
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.currentTarget.matches(":focus-visible")) previews.show(event.currentTarget, content(), "focus");
    },
    onBlur: (event: FocusEvent<HTMLElement>) => previews.hide(event.currentTarget),
  };
}

/**
 * Every place the page names an item shows it as this chip: hovering or
 * focusing it previews the item, in the page's one item preview, which lets
 * the pointer through to the chips beneath it, and clicking it or pressing
 * Enter on it opens the item in its stage and module. With `reasons`, the item makes
 * the item naming it out of date, and the chip says why in the warning
 * colour; with `change`, the preview shows how the item changed.
 */
const ItemChip = observer(function ItemChip({
  itemId,
  detail,
  reasons = [],
  change = null,
  opens = true,
  onDelete,
}: {
  itemId: string;
  detail?: string;
  reasons?: readonly LinkReason[];
  change?: OutOfDateCause["change"];
  /** False where opening the item would leave work behind, such as in an editor. */
  opens?: boolean;
  onDelete?: (event: unknown) => void;
}) {
  const { module } = useWorkflowView();
  const openUnit = useOpenUnit();
  const label = useItemLabel();
  const named = module.namedItem(itemId);
  const cause = reasons.length > 0;
  const look = { size: "small", variant: cause ? "filled" : "outlined", color: cause ? "warning" : "default" } as const;
  const removedText = named == null ? module.removedItemText(itemId) : null;
  const preview = usePreview(() => (named == null ? <WrittenText text={removedText ?? ""} /> : <ItemPreview item={named} change={change} />));
  if (named == null) {
    return <Chip {...look} {...(removedText == null ? {} : preview)} label={label(itemId)} onDelete={onDelete} />;
  }
  const open = (event: MouseEvent<HTMLElement>) => {
    openUnit({ module: named.module?.id ?? null, stage: named.stage, unitId: named.id }, placeOf(event.currentTarget));
  };
  return <Chip {...look} {...preview} label={label(itemId, { detail, reasons })} onClick={opens ? open : undefined} onDelete={onDelete} />;
});

/** An item offered in a list to choose from: its chip, then its whole text, wrapped rather than cut. */
export const ItemOption = observer(function ItemOption({ itemId }: { itemId: string }) {
  const { module } = useWorkflowView();
  const named = module.namedItem(itemId);
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: "baseline", minWidth: 0 }}>
      <ItemChip itemId={itemId} opens={false} />
      {named != null && <Box sx={{ minWidth: 0 }}><WrittenText text={named.text} /></Box>}
    </Stack>
  );
});

export default ItemChip;
