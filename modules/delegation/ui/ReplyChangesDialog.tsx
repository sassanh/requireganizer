"use client";

import { Alert, Box, Dialog, DialogContent, DialogTitle, Divider, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";

import { getUserFacingErrorMessage } from "lib/errors";
import type { Store } from "store";
import { type ItemVersion, REMOVED_ITEM } from "workflow";

import type { ReplyChange } from "../record";
import { useDelegation } from "./context";

function VersionText({ store, kind, version }: { store: Store; kind: string; version: ItemVersion }) {
  return (
    <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: "action.hover", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {store.workflow.isKind(kind) ? store.shownText(kind, version.content) : JSON.stringify(version.content, null, 2)}
    </Box>
  );
}

/** What one change did to its item: added it, changed it from one version to another, or removed it. */
function ChangeShown({ store, change }: { store: Store; change: ReplyChange }) {
  const what = change.before == null ? "Added" : change.after == null ? "Removed or proposed for removal" : "Changed";
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">
        {what}: {store.itemNameOf(change.itemId) ?? REMOVED_ITEM}
      </Typography>
      {change.before != null && change.after != null && <Typography variant="caption" color="text.secondary">Before</Typography>}
      {change.before != null && <VersionText store={store} kind={change.kind} version={change.before} />}
      {change.before != null && change.after != null && <Typography variant="caption" color="text.secondary">After</Typography>}
      {change.after != null && <VersionText store={store} kind={change.kind} version={change.after} />}
    </Stack>
  );
}

/** The item changes a reply made, each item with its version before and after, read from the host when opened. */
export default function ReplyChangesDialog({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const { client, moduleStore, activeModuleId } = useDelegation();
  const [changes, setChanges] = useState<ReplyChange[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    client.readReplyChanges(messageId).then(
      (read) => {
        if (current) setChanges(read);
      },
      (error: unknown) => {
        if (current) setProblem(getUserFacingErrorMessage(error, "The changes could not be read."));
      },
    );
    return () => {
      current = false;
    };
  }, [client, messageId]);
  const store = moduleStore(activeModuleId);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle>Item changes of the reply</DialogTitle>
      <DialogContent dividers>
        {problem != null && <Alert severity="error">{problem}</Alert>}
        {changes != null && changes.length === 0 && <Typography color="text.secondary">No item changes are kept for this reply.</Typography>}
        {changes != null && store != null && (
          <Stack spacing={1.5} divider={<Divider flexItem />}>
            {changes.map((change) => (
              <ChangeShown key={change.itemId} store={store} change={change} />
            ))}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
