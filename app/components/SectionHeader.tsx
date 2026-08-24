import { ArrowRight, Refresh } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import React, { useEffect } from "react";

import {
  GENERATOR_ACTION_BY_STEP,
  STEPS,
  STEP_LABELS,
  Status,
  Step,
  useStore,
} from "store";

import GenerationButton from "./GenerationButton";
import css from "./SectionHeader.module.css";

export interface HeaderProps {
  step: Step;
}

const Header: React.FunctionComponent<HeaderProps> = ({
  step,
}: HeaderProps): React.ReactElement => {
  const store = useStore();

  const stepIndex = STEPS.indexOf(step);
  const nextStep = stepIndex < STEPS.length - 1 ? STEPS[stepIndex + 1] : null;
  const currentStepGeneratorAction = step === Step.InterfaceContracts
    ? null
    : GENERATOR_ACTION_BY_STEP[step];
  const nextStepGeneratorAction = nextStep
    ? GENERATOR_ACTION_BY_STEP[nextStep]
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
              {STEP_LABELS[step]}
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
              {STEP_LABELS[nextStep]}
            </GenerationButton>
          ) : null}
        </div>
      </Stack>
      <Typography variant="h3" sx={{
        alignSelf: "center"
      }}>
        {STEP_LABELS[step]}
      </Typography>
    </Stack>
  );
};

export default observer(Header);
