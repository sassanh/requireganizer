import { ArrowRight, Build, Refresh } from "@mui/icons-material";
import { Button, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import React from "react";

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

  return (
    <Stack gap={2} mb={2}>
      <Stack direction="row" justifyContent="space-between">
        <div className={css.headerPrevious}>
          {currentStepGeneratorAction != null ? (
            <Button
              disabled={store.isBusy}
              variant="outlined"
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
              autoCapitalize="off"
              startIcon={<Build />}
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
