"use client";

import { BookmarksOutlined, Close, DeleteOutlined, PushPin, PushPinOutlined } from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogTitle,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { getUserFacingErrorMessage } from "lib/errors";
import { useProject } from "projectContext";
import type { ListedRestorePoint } from "storage-and-recovery";

import { notify } from "./notices";

/** The Restore points button of the open project, opening its panel. */
export default function RestorePointsControls() {
  const [panelOpen, setPanelOpen] = useState(false);
  return (
    <>
      <ActionTooltip name="Restore points">
        <IconButton aria-label="Restore points" onClick={() => setPanelOpen(true)}>
          <BookmarksOutlined />
        </IconButton>
      </ActionTooltip>
      <Drawer anchor="right" open={panelOpen} onClose={() => setPanelOpen(false)}>
        {panelOpen && <RestorePointsPanel onClose={() => setPanelOpen(false)} />}
      </Drawer>
    </>
  );
}

/** Make a restore point under a name, and restore, pin, unpin or delete the kept ones, newest first. */
function RestorePointsPanel({ onClose }: { onClose: () => void }) {
  const {
    history,
    listRestorePoints,
    makeRestorePoint,
    restoreToRestorePoint,
    pinRestorePoint,
    unpinRestorePoint,
    deleteRestorePoint,
  } = useProject();
  const [points, setPoints] = useState<ListedRestorePoint[] | null>(null);
  const [name, setName] = useState("");
  const [pointToDelete, setPointToDelete] = useState<ListedRestorePoint | null>(null);
  const currentStep = history?.currentStep ?? null;

  const refresh = useCallback(
    () =>
      listRestorePoints().then(setPoints, (error: unknown) =>
        notify(getUserFacingErrorMessage(error, "Could not list the restore points."), "error"),
      ),
    [listRestorePoints],
  );

  // Listed again whenever the project changes, which may make an automatic one.
  useEffect(() => {
    void refresh();
  }, [refresh, currentStep]);

  /** Run a request, then list again; a refusal, such as while an outside change waits, says why. */
  const attempt = (request: () => Promise<void>, fallback: string): Promise<boolean> =>
    request().then(
      () => {
        void refresh();
        return true;
      },
      (error: unknown) => {
        notify(getUserFacingErrorMessage(error, fallback), "error");
        void refresh();
        return false;
      },
    );

  const make = async () => {
    if (await attempt(() => makeRestorePoint(name), "Could not make the restore point.")) setName("");
  };

  return (
    <Stack sx={{ width: { xs: "100vw", sm: 380 }, height: "100%" }}>
      <Stack direction="row" sx={{ alignItems: "center", px: 2, py: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Restore points
        </Typography>
        <IconButton aria-label="Close" onClick={onClose}>
          <Close />
        </IconButton>
      </Stack>
      <Stack
        component="form"
        direction="row"
        sx={{ alignItems: "center", gap: 1, px: 2, pb: 1 }}
        onSubmit={(event) => {
          event.preventDefault();
          void make();
        }}
      >
        <TextField
          size="small"
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          sx={{ flexGrow: 1 }}
        />
        <Button type="submit" variant="contained" disabled={name.trim().length === 0}>
          Make
        </Button>
      </Stack>
      {points != null && points.length === 0 && (
        <Typography sx={{ px: 2, color: "text.secondary" }}>No restore points yet.</Typography>
      )}
      <List dense sx={{ overflowY: "auto", flexGrow: 1 }}>
        {(points ?? []).map((point) => (
          <ListItem
            key={point.id}
            secondaryAction={
              <Stack direction="row" sx={{ alignItems: "center" }}>
                <Button
                  size="small"
                  onClick={() => void attempt(() => restoreToRestorePoint(point.id), "Could not restore it.")}
                >
                  Restore
                </Button>
                <ActionTooltip name={point.pinned ? "Unpin" : "Pin"}>
                  <IconButton
                    size="small"
                    aria-label={point.pinned ? "Unpin" : "Pin"}
                    onClick={() =>
                      void attempt(
                        () => (point.pinned ? unpinRestorePoint(point.id) : pinRestorePoint(point.id)),
                        point.pinned ? "Could not unpin it." : "Could not pin it.",
                      )
                    }
                  >
                    {point.pinned ? <PushPin fontSize="small" /> : <PushPinOutlined fontSize="small" />}
                  </IconButton>
                </ActionTooltip>
                <ActionTooltip name="Delete">
                  <IconButton size="small" aria-label="Delete" onClick={() => setPointToDelete(point)}>
                    <DeleteOutlined fontSize="small" />
                  </IconButton>
                </ActionTooltip>
              </Stack>
            }
            sx={{ pr: 20 }}
          >
            <ListItemText
              primary={
                <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box
                    component="span"
                    sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
                  >
                    {point.name ?? "Made automatically"}
                  </Box>
                  {point.pinned && <Chip size="small" label="Pinned" variant="outlined" />}
                </Box>
              }
              secondary={new Date(point.at).toLocaleString()}
            />
          </ListItem>
        ))}
      </List>
      <Dialog open={pointToDelete != null} onClose={() => setPointToDelete(null)}>
        <DialogTitle>Delete this restore point?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setPointToDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const point = pointToDelete;
              setPointToDelete(null);
              if (point != null) void attempt(() => deleteRestorePoint(point.id), "Could not delete it.");
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
