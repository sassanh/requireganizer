import { faCog, faRefresh } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { observer } from "mobx-react-lite";
import React from "react";
import { Iteration, useStore } from "store";
import {
  GENERATOR_ACTION_BY_ITERATION,
  ITERATIONS,
  ITERATION_LABELS,
} from "store/utilities";

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
    GENERATOR_ACTION_BY_ITERATION.get(iteration);
  const nextIterationGeneratorAction = nextIteration
    ? GENERATOR_ACTION_BY_ITERATION.get(nextIteration)
    : null;

  return (
    <div className="tab-header">
      <h1 className="header-title">{ITERATION_LABELS.get(iteration)}</h1>
      <div className="header-previous">
        {currentIterationGeneratorAction != null ? (
          <button
            className="icon-button"
            onClick={store[currentIterationGeneratorAction]}
          >
            <FontAwesomeIcon icon={faRefresh} /> Regenerate{" "}
            {ITERATION_LABELS.get(iteration)}
          </button>
        ) : null}
      </div>
      <div className="header-next">
        {nextIteration && nextIterationGeneratorAction ? (
          <button
            className="icon-button"
            disabled={store.isGenerating}
            onClick={store[nextIterationGeneratorAction]}
          >
            <FontAwesomeIcon icon={faCog} /> Generate{" "}
            {ITERATION_LABELS.get(nextIteration)}
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default observer(Header);
