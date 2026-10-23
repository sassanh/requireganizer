import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { getSnapshot } from "mobx-state-tree";
import { useState } from "react";

import { reviewerModel } from "ai-agent/model";
import { usePersistence } from "provider";
import { useStore } from "store";

import CodeBlock from "./CodeBlock";

const ImpactConfirmationDialog = ({ projectId, moduleId }: { projectId: string; moduleId: string }) => {
  const persistence = usePersistence();
  const store = useStore();
  const [saving, setSaving] = useState(false);
  const change = store.pendingImpactChange;
  const apply = async () => {
    if (change == null) return;
    setSaving(true);
    try {
      await persistence.revisions.save(
        projectId,
        moduleId,
        getSnapshot(store),
        `Before ${change.sourceLabel} revision`,
      );
      store.applyPendingImpactChange();
      if (reviewerModel != null && store.frontier != null) void store.reviewStage(store.frontier);
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
      <DialogTitle>Reopen {change?.sourceLabel}</DialogTitle>
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
        <Alert severity="info">A recovery snapshot is saved before the change applies.</Alert>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={store.cancelPendingImpactChange}>Cancel</Button>
        <Button disabled={saving} variant="contained" color="warning" onClick={apply}>{saving ? "Saving snapshot…" : "Save snapshot and reopen"}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default observer(ImpactConfirmationDialog);
