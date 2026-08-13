import { Delete, Download, PushPin, Restore } from "@mui/icons-material";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemText, Stack, Tooltip } from "@mui/material";
import { saveAs } from "file-saver";
import { getSnapshot } from "mobx-state-tree";
import { useCallback, useEffect, useState } from "react";

import {
  deleteProjectSnapshot,
  listProjectSnapshots,
  type ProjectRevisionSnapshot,
  saveProjectSnapshot,
  setSnapshotPinned,
} from "lib/revisionStorage";
import { useStore } from "store";

export default function RevisionHistoryDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const store = useStore();
  const [items, setItems] = useState<ProjectRevisionSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setItems(await listProjectSnapshots(projectId)); setError(null); }
    catch { setError("Revision history is unavailable in browser storage."); }
  }, [projectId]);
  // IndexedDB is an external source; refresh only when the dialog becomes visible.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const restore = async (item: ProjectRevisionSnapshot) => {
    try {
      await saveProjectSnapshot(projectId, getSnapshot(store), `Before restoring ${item.label}`);
      store.import(item.data);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore the snapshot.");
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Revision history</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error}</Alert>}
        {items.length === 0 && !error && <Alert severity="info">No recovery snapshots have been created for this project.</Alert>}
        <List>
          {items.map((item) => (
            <ListItem key={item.id} divider secondaryAction={
              <Stack direction="row">
                <Tooltip title={item.pinned ? "Unpin" : "Pin"}><IconButton onClick={async () => { await setSnapshotPinned(item.id, !item.pinned); await refresh(); }}><PushPin color={item.pinned ? "primary" : "inherit"} /></IconButton></Tooltip>
                <Tooltip title="Download"><IconButton onClick={() => saveAs(new Blob([JSON.stringify(item.data, null, 2)], { type: "application/json" }), `requireganizer-revision-${item.createdAt}.json`)}><Download /></IconButton></Tooltip>
                <Tooltip title="Restore"><IconButton onClick={() => restore(item)}><Restore /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton color="error" onClick={async () => { if (!window.confirm("Delete this recovery snapshot?")) return; await deleteProjectSnapshot(item.id); await refresh(); }}><Delete /></IconButton></Tooltip>
              </Stack>
            }>
              <ListItemText primary={item.label} secondary={`${new Date(item.createdAt).toLocaleString()}${item.pinned ? " · pinned" : ""}`} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}
