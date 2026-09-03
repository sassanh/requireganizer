import { ArrowRight, Refresh } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import React from "react";

import {
  GENERATOR_ACTION_BY_WORKFLOW_STAGE,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_LABELS,
  Status,
  WorkflowStage,
  useStore,
} from "store";

import GenerationButton from "./GenerationButton";
import css from "./SectionHeader.module.css";

export interface HeaderProps {
  step: WorkflowStage;
}

function nextGenerateHint(
  store: ReturnType<typeof useStore>,
  step: WorkflowStage,
  nextStep: WorkflowStage,
): string | null {
  if (store.canGenerateStep(nextStep)) return null;
  const status = store.getStepStatus(step);
  if (status === Status.Pending || status === Status.Locked) {
    return "Generate this stage first.";
  }
  if (!store.stageIsApproved(step)) {
    return "Approve each item first.";
  }
  if (status === Status.Outdated) {
    return "Regenerate this stage first.";
  }
  if (
    nextStep === WorkflowStage.InterfaceContracts &&
    store.implementationProfile != null &&
    store.implementationProfile.status !== "approved"
  ) {
    return "Approve the profile first.";
  }
  return null;
}

const Header: React.FunctionComponent<HeaderProps> = ({
  step,
}: HeaderProps): React.ReactElement => {
  const store = useStore();

  const stepIndex = WORKFLOW_STAGES.indexOf(step);
  const nextStep = stepIndex < WORKFLOW_STAGES.length - 1 ? WORKFLOW_STAGES[stepIndex + 1] : null;
  const currentStepGeneratorAction = store.generatorActionForStep(step);
  const nextStepGeneratorAction = nextStep
    ? GENERATOR_ACTION_BY_WORKFLOW_STAGE[nextStep]
    : null;

  const hint =
    nextStep != null ? nextGenerateHint(store, step, nextStep) : null;
  const listChangeText = store.stageListChangeCaption(step)?.text;

  return (
    <Stack
      sx={{
        gap: 2,
        mb: 2
      }}>
      <Stack direction="row" sx={{
        justifyContent: "space-between"
      }}>
        <div className={css.headerPrevious}>
          {currentStepGeneratorAction != null ? (
            <GenerationButton
              disabled={store.isBusy || !store.canGenerateStep(step)}
              variant="outlined"
              size="large"
              startIcon={<Refresh />}
              onGenerate={() => store[currentStepGeneratorAction]()}
            >
              {store.getStepStatus(step) === Status.Pending
                ? "Generate"
                : "Regenerate"}{" "}
              {WORKFLOW_STAGE_LABELS[step]}
            </GenerationButton>
          ) : null}
        </div>
        <div className={css.headerNext}>
          {nextStep && nextStepGeneratorAction ? (
            <>
              <GenerationButton
                disabled={store.isBusy || !store.canGenerateStep(nextStep)}
                variant="contained"
                size="large"
                autoCapitalize="off"
                endIcon={<ArrowRight />}
                onGenerate={() => store[nextStepGeneratorAction]()}
              >
                {WORKFLOW_STAGE_LABELS[nextStep]}
              </GenerationButton>
              {hint == null ? null : (
                <Typography variant="caption" color="text.secondary">
                  {hint}
                </Typography>
              )}
            </>
          ) : null}
        </div>
      </Stack>
      <Typography variant="h3" sx={{
        alignSelf: "center"
      }}>
        {WORKFLOW_STAGE_LABELS[step]}
      </Typography>
      {listChangeText != null ? (
        <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "center" }}>
          {listChangeText}
        </Typography>
      ) : null}
      {store.mechanicalIssuesForStage(step).map((issue, index) => (
        <Typography key={`${issue.itemId ?? "stage"}:${index}`} variant="body2" color="error">
          {issue.message}
        </Typography>
      ))}
    </Stack>
  );
};

export default observer(Header);
