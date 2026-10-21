import { Undo } from "@mui/icons-material";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";

import { useStore, type WorkflowStage } from "store";
import { impactUnitId } from "store/review";
import { summarizeInputChanges } from "store/stageInputDiff";

import ApprovalMark from "./ApprovalMark";

/**
 * One impact approval per upstream change: it affects none of the items
 * that reference none of the changed inputs. Items it does affect are sent
 * back, which makes them outdated until regenerated.
 */
const ImpactPanel = observer(function ImpactPanel({ step }: { step: WorkflowStage }) {
  const store = useStore();
  const unitId = impactUnitId(step);
  if (store.reviewUnit(unitId) == null) return null;
  const changes = summarizeInputChanges(store.inputChanges(step));
  const items = store.untouchedItemIds(step);
  return (
    <Alert
      severity="info"
      sx={{ alignSelf: "stretch", "& .MuiAlert-message": { flexGrow: 1 } }}
      action={<ApprovalMark id={unitId} />}
    >
      <Stack sx={{ gap: 1 }}>
        <Typography variant="body2">
          Inputs changed. Approve if the change affects none of these items; send back any it does.
        </Typography>
        <Stack component="ul" sx={{ m: 0, pl: 2 }}>
          {changes.map((line) => (
            <Typography key={line} component="li" variant="caption">
              {line}
            </Typography>
          ))}
        </Stack>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          {items.map((id) => (
            <Button
              key={id}
              size="small"
              variant="outlined"
              startIcon={<Undo fontSize="small" />}
              disabled={store.isBusy}
              onClick={() => store.sendBackForRegeneration([id])}
            >
              Send back {store.getCode(id) ?? id}
            </Button>
          ))}
        </Stack>
      </Stack>
    </Alert>
  );
});

export default ImpactPanel;
