"use client";

import { Chip, Stack, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import type { MouseEvent } from "react";

import type { NamedItem, OutOfDateCause } from "../module";
import { LINK_REASON_LABELS, type LinkReason, REMOVED_ITEM } from "../units";
import { placeOf, useWorkflowNavigation, useWorkflowView } from "./context";
import VersionDiff from "./VersionDiff";

/** How the page names an item: its code, "Module/CODE" for an item of another module, or "removed item" once it no longer exists. */
export function useItemName(): (id: string) => string {
  const { module } = useWorkflowView();
  return (id) => module.namedItem(id)?.name ?? REMOVED_ITEM;
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
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{item.text}</Typography>
      <Typography variant="caption">
        {workflow.stage(item.stage).label} · {item.approved ? "Approved" : item.phase === "removed" ? "Removed" : "Not approved"}
      </Typography>
    </Stack>
  );
}

/**
 * Every place the page names an item shows it as this chip: hovering or
 * focusing it previews the item, and the preview lets the pointer through to
 * the chips beneath it, and clicking it or pressing Enter on it
 * opens the item in its stage and module. With `reasons`, the item makes
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
  const { openUnit } = useWorkflowNavigation();
  const label = useItemLabel();
  const named = module.namedItem(itemId);
  const cause = reasons.length > 0;
  const look = { size: "small", variant: cause ? "filled" : "outlined", color: cause ? "warning" : "default" } as const;
  if (named == null) return <Chip {...look} label={label(itemId)} onDelete={onDelete} />;
  const open = (event: MouseEvent<HTMLElement>) => {
    openUnit({ module: named.module?.id ?? null, stage: named.stage, unitId: named.id }, placeOf(event.currentTarget));
  };
  return (
    <Tooltip title={<ItemPreview item={named} change={change} />} describeChild disableInteractive slotProps={{ tooltip: { sx: { maxWidth: 440 } } }}>
      <Chip {...look} label={label(itemId, { detail, reasons })} onClick={opens ? open : undefined} onDelete={onDelete} />
    </Tooltip>
  );
});

/** An item offered in a list to choose from: its chip, then its whole text, wrapped rather than cut. */
export const ItemOption = observer(function ItemOption({ itemId }: { itemId: string }) {
  const { module } = useWorkflowView();
  const named = module.namedItem(itemId);
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: "baseline", minWidth: 0 }}>
      <ItemChip itemId={itemId} opens={false} />
      {named != null && <Typography variant="body2" sx={{ minWidth: 0, whiteSpace: "normal" }}>{named.text}</Typography>}
    </Stack>
  );
});

export default ItemChip;
