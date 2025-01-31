import { faCog, faRefresh } from "@fortawesome/free-solid-svg-icons";
import { observer } from "mobx-react-lite";
import React from "react";

import {
  GENERATOR_ACTION_BY_ITERATION,
  ITERATIONS,
  ITERATION_LABELS,
  Iteration,
  useStore,
} from "store";

import { IconButton } from "./controls";
import css from "./SectionHeader.module.css";

interface HeaderProps {
  iteration: Iteration;
}

const Header: React.FunctionComponent<HeaderProps> = ({
  iteration,
}: HeaderProps): React.ReactElement => {
  const store = useStore();

  const iterationIndex = ITERATIONS.indexOf(iteration);
  const nextIteration =
    iterationIndex < ITERATIONS.length - 1
      ? ITERATIONS[iterationIndex + 1]
      : null;
  const currentIterationGeneratorAction =
    GENERATOR_ACTION_BY_ITERATION[iteration];
  const nextIterationGeneratorAction = nextIteration
    ? GENERATOR_ACTION_BY_ITERATION[nextIteration]
    : null;

  return (
    <div className={css.sectionHeader}>
      <h1 className={css.headerTitle}>{ITERATION_LABELS[iteration]}</h1>
      <div className={css.headerPrevious}>
        {currentIterationGeneratorAction != null ? (
          <IconButton
            icon={faRefresh}
            disabled={store.isBusy}
            onClick={() => store[currentIterationGeneratorAction]()}
          >
            Regenerate {ITERATION_LABELS[iteration]}
          </IconButton>
        ) : null}
      </div>
      <div className={css.headerNext}>
        {nextIteration && nextIterationGeneratorAction ? (
          <IconButton
            icon={faCog}
            disabled={store.isBusy}
            onClick={() => store[nextIterationGeneratorAction]()}
          >
            Generate {ITERATION_LABELS[nextIteration]}
          </IconButton>
        ) : null}
      </div>
    </div>
  );
};

export default observer(Header);
