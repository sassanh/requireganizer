"use client";

import { Chip } from "@mui/material";
import { observer } from "mobx-react-lite";

import type { Thread } from "../threads";
import { parseUnitId, threadPlace } from "../units";
import { useOpenUnit, useWorkflowView } from "./context";
import ItemChip from "./ItemChip";

/**
 * What a thread is on, wherever the thread shows away from it, as a way to
 * go there with the thread open: an item, coverage or impact as its item's
 * chip; a stage by its module and name; a removed unit by what it said,
 * going to its stage. Opening it focuses the thread's last message.
 */
const ThreadOwner = observer(function ThreadOwner({
  thread,
  moduleName = null,
}: {
  /** The thread, of the module the view shows; with no messages, as a list of changes keeps it, opening it focuses its first. */
  thread: Pick<Thread, "id" | "unitId" | "stage" | "removedUnit"> & { messages?: readonly unknown[] };
  /** The module's name, shown with a stage's while the project has modules turned on. */
  moduleName?: string | null;
}) {
  const { module, workflow } = useWorkflowView();
  const openUnit = useOpenUnit();
  const message = { threadId: thread.id, index: Math.max(0, (thread.messages?.length ?? 1) - 1) };
  const go = () => openUnit({ module: null, stage: thread.stage, unitId: threadPlace(thread), message }, null);
  if (thread.unitId != null && module.unitState(thread.unitId) != null) {
    const address = parseUnitId(thread.unitId);
    return address.kind === "item" ? (
      <ItemChip itemId={address.itemId} thread={message} />
    ) : (
      <ItemChip itemId={address.itemId} as={{ kind: address.kind, unitId: thread.unitId, stage: thread.stage }} thread={message} />
    );
  }
  const stageLabel = workflow.isStage(thread.stage) ? workflow.stage(thread.stage).label : thread.stage;
  const label = thread.unitId == null ? [moduleName, stageLabel].filter((part) => part != null).join(" · ") : (thread.removedUnit?.text ?? "A removed item");
  return <Chip size="small" variant="outlined" label={label} title={label} onClick={go} sx={{ maxWidth: 320 }} />;
});

export default ThreadOwner;
