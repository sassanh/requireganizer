import { ArrowRight, Refresh } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import React, { useEffect } from "react";

import { qualityContractForStage } from "ai-harness/workflow";
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

const Header: React.FunctionComponent<HeaderProps> = ({
  step,
}: HeaderProps): React.ReactElement => {
  const store = useStore();

  const stepIndex = WORKFLOW_STAGES.indexOf(step);
  const nextStep = stepIndex < WORKFLOW_STAGES.length - 1 ? WORKFLOW_STAGES[stepIndex + 1] : null;
  const currentStepGeneratorAction = step === WorkflowStage.InterfaceContracts
    ? null
    : GENERATOR_ACTION_BY_WORKFLOW_STAGE[step];
  const nextStepGeneratorAction = nextStep
    ? GENERATOR_ACTION_BY_WORKFLOW_STAGE[nextStep]
    : null;

  useEffect(() => {
    if (!nextStepGeneratorAction) return;
    const osModifierKey = window.navigator.userAgent.includes("Mac")
      ? "metaKey"
      : "ctrlKey";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Enter" &&
        event[osModifierKey] &&
        !store.isBusy &&
        nextStep != null &&
        store.canGenerateStep(nextStep)
      ) {
        event.preventDefault();
        store[nextStepGeneratorAction]();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [store, nextStep, nextStepGeneratorAction]);

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
          ) : null}
        </div>
      </Stack>
      {qualityContractForStage(step) != null ? (
        <Stack direction="row" sx={{ gap: 1, justifyContent: "flex-end" }}>
          <GenerationButton
            disabled={store.isBusy || !store.canCheckStep(step)}
            variant="outlined"
            size="medium"
            onGenerate={() => store.checkStageQuality(step)}
          >
            Check
          </GenerationButton>
          <GenerationButton
            disabled={store.isBusy || !store.canFixStep(step)}
            variant="outlined"
            size="medium"
            onGenerate={() => store.fixStageQuality(step)}
          >
            Fix
          </GenerationButton>
        </Stack>
      ) : null}
      <Typography variant="h3" sx={{
        alignSelf: "center"
      }}>
        {WORKFLOW_STAGE_LABELS[step]}
      </Typography>
      {store.mechanicalIssuesForStage(step).map((issue, index) => (
        <Typography key={`${issue.itemId ?? "stage"}:${index}`} variant="body2" color="error">
          {issue.message}
        </Typography>
      ))}
    </Stack>
  );
};

export default observer(Header);
