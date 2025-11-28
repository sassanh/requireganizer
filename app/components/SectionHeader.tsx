import { ArrowRight, Build, Info, Refresh } from "@mui/icons-material";
import { Alert, AlertTitle, Button, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import React, { useEffect } from "react";

import {
  GENERATOR_ACTION_BY_STEP,
  STEPS,
  STEP_LABELS,
  Step,
  useStore,
} from "store";

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
  const currentStepGeneratorAction = GENERATOR_ACTION_BY_STEP[step];
  const nextStepGeneratorAction = nextStep
    ? GENERATOR_ACTION_BY_STEP[nextStep]
    : null;

  useEffect(() => {
    if (!nextStepGeneratorAction) return;
    const osModifierKey = window.navigator.userAgent.includes("Mac")
      ? "metaKey"
      : "ctrlKey";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && event[osModifierKey]) {
        event.preventDefault();
        store[nextStepGeneratorAction]();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [store, nextStepGeneratorAction]);

  return (
    <Stack gap={2} mb={2}>
      {store.systemMessage && (
        <Alert>
          <AlertTitle>Needs Action!</AlertTitle>
          <div>{store.systemMessage}</div>
        </Alert>
      )}
      <Stack direction="row" justifyContent="space-between">
        <div className={css.headerPrevious}>
          {currentStepGeneratorAction != null ? (
            <Button
              disabled={store.isBusy}
              variant="outlined"
              size="large"
              startIcon={<Refresh />}
              onClick={() => store[currentStepGeneratorAction]()}
            >
              Regenerate {STEP_LABELS[step]}
            </Button>
          ) : null}
        </div>
        <div className={css.headerNext}>
          {nextStep && nextStepGeneratorAction ? (
            <Button
              disabled={store.isBusy}
              variant="contained"
              size="large"
              autoCapitalize="off"
              endIcon={<ArrowRight />}
              onClick={() => store[nextStepGeneratorAction]()}
            >
              {STEP_LABELS[nextStep]}
            </Button>
          ) : null}
        </div>
      </Stack>
      <Typography variant="h3" alignSelf="center">
        {STEP_LABELS[step]}
      </Typography>
    </Stack>
  );
};

export default observer(Header);
