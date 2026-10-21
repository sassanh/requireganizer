import { Button, Stack, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import { observer } from "mobx-react-lite";

import { reviewerModel } from "ai-agent/model";
import { getUserFacingErrorMessage } from "lib/errors";
import { useStore, WorkflowStage } from "store";
import type { ReviewMode } from "store/review";

import { notify } from "./notices";

/**
 * A stage's review mode and the reviewer-model run. In auto review the
 * model's approval is the approval; in manual review its verdict is a
 * recommendation next to each item.
 */
const ReviewControls = observer(function ReviewControls({ step }: { step: WorkflowStage }) {
  const store = useStore();
  if (step === WorkflowStage.AutomatedTests || step === WorkflowStage.Code) return null;
  if (!store.hasStepArtifacts(step)) return null;
  const configured = reviewerModel != null;
  const editable = store.stageIsEditable(step);
  const awaiting = configured ? store.unitsAwaitingReview(step).length : 0;

  const changeMode = (mode: ReviewMode | null) => {
    if (mode == null) return;
    try {
      store.setReviewMode(step, mode);
    } catch (error) {
      notify(getUserFacingErrorMessage(error, "Unable to change the review mode."), "error");
      return;
    }
    if (mode === "auto") void store.reviewStage(step);
  };

  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
      {awaiting > 0 && editable ? (
        <Button size="small" disabled={store.isBusy} onClick={() => void store.reviewStage(step)}>
          Review {awaiting} with {reviewerModel!.id}
        </Button>
      ) : null}
      <Tooltip title={configured ? "" : "Set NEXT_PUBLIC_AI_REVIEWER_MODEL to enable the reviewer model."}>
        <span>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={store.reviewModeOf(step)}
            disabled={!configured || !editable || store.isBusy}
            onChange={(_, mode: ReviewMode | null) => changeMode(mode)}
          >
            <ToggleButton value="manual">Manual review</ToggleButton>
            <ToggleButton value="auto">Auto review</ToggleButton>
          </ToggleButtonGroup>
        </span>
      </Tooltip>
    </Stack>
  );
});

export default ReviewControls;
