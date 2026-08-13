import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { getSnapshot } from "mobx-state-tree";
import { useState } from "react";

import { saveProjectSnapshot } from "lib/revisionStorage";
import { useStore } from "store";

import CodeBlock from "./CodeBlock";

const ImpactConfirmationDialog = ({ projectId }: { projectId: string }) => {
  const store = useStore();
  const [saving, setSaving] = useState(false);
  const change = store.pendingImpactChange;
  const apply = async () => {
    if (change == null) return;
    setSaving(true);
    try {
      await saveProjectSnapshot(
        projectId,
        getSnapshot(store),
        `Before ${change.sourceLabel} revision`,
      );
      store.applyPendingImpactChange();
    } catch (error) {
      store.setValidationError({
        message: "The change was not applied because a recovery snapshot could not be saved.",
        details: error instanceof Error ? error.stack ?? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={change != null} maxWidth="sm" fullWidth onClose={saving ? undefined : store.cancelPendingImpactChange}>
      <DialogTitle>Confirm downstream impact</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>{change?.summary}</Alert>
        <List dense>
          {change?.affectedArtifacts.map((artifact) => (
            <ListItem key={artifact.step}>
              <ListItemText primary={artifact.label} secondary={artifact.reason} />
            </ListItem>
          ))}
        </List>
        {store.contractRevisionDiff != null && (
          <Accordion variant="outlined" sx={{ mb: 2 }}>
            <AccordionSummary>
              <Typography>Review proposed artifact diff</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <CodeBlock code={store.contractRevisionDiff} language="diff" />
            </AccordionDetails>
          </Accordion>
        )}
        <Alert severity="info">A complete recovery snapshot will be saved before this revision is applied.</Alert>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={store.cancelPendingImpactChange}>Cancel</Button>
        <Button disabled={saving} variant="contained" color="warning" onClick={apply}>{saving ? "Saving snapshot…" : "Save snapshot and apply"}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default observer(ImpactConfirmationDialog);
