import { Add } from "@mui/icons-material";
import { Button, Divider, Paper, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";
import { ReactElement, ReactNode } from "react";

import {
  STRUCTURAL_FRAGMENT_LABEL,
  StructuralFragment as StructuralFragmentName,
} from "store";
import {
  type TestCase,
  StructuralFragment as StructuralFragmentModel,
} from "store/models";

import EditableItem from "./EditableItem";
import EditableTestCaseItem from "./EditableTestCaseItem";
import { getFrozenFragment } from "./frozenFragment";
import {
  MembershipMotion,
  useMembershipTurns,
} from "./membershipPresentation";

interface FragmentListProps<Type extends StructuralFragmentModel> {
  fragments: Type[];
  isDisabled: boolean;
  structuralFragment: Type["type"];
  scenarioId?: string;
  onAddFragment?: () => void;
  renderFragment: (
    fragment: Type,
    options?: { isDisabled?: boolean; list?: Type[] },
  ) => ReactNode;
}

/**
 * Membership follows the presentation replica. Each recorded add/remove
 * is one replica frame; the list animates that one-id diff and reports
 * done. Human edits have no frames and snap immediately.
 */
const FragmentList = observer(function FragmentList<
  Type extends StructuralFragmentModel,
>({
  fragments,
  isDisabled,
  structuralFragment,
  scenarioId,
  onAddFragment,
  renderFragment,
}: FragmentListProps<Type>) {
  const liveFragments = fragments.filter((fragment) => isAlive(fragment));
  const liveIds = [
    ...new Set(liveFragments.map((fragment) => fragment.id)),
  ];

  const { presentedIds, enteringIds, exitingIds, exitHeightFor, seqFor, itemRef } =
    useMembershipTurns(liveIds);

  const renderedChildFor = (id: string): ReactNode => {
    const live = liveFragments.find((fragment) => fragment.id === id);
    if (live != null) {
      return renderFragment(live, { list: liveFragments });
    }
    return getFrozenFragment(id);
  };

  return (
    <Stack
      component={Paper}
      variant="outlined"
      sx={{ p: 1, gap: 1 }}
    >
      {presentedIds.map((id, index) => {
        const content = renderedChildFor(id);
        if (content == null) return null;
        return (
          <MembershipMotion
            key={`${id}:${seqFor(id)}:${index}`}
            id={id}
            entering={enteringIds.has(id)}
            exiting={exitingIds.has(id)}
            exitHeight={exitHeightFor(id)}
            itemRef={itemRef}
          >
            {content}
            <Divider />
          </MembershipMotion>
        );
      })}
      {onAddFragment && (
        <Button disabled={isDisabled} endIcon={<Add />} onClick={onAddFragment}>
          Add {STRUCTURAL_FRAGMENT_LABEL[structuralFragment]}
        </Button>
      )}
    </Stack>
  );
});

interface StructuralFragmentsProps<Type extends StructuralFragmentModel> {
  fragments: Type[];
  isDisabled: boolean;
  structuralFragment: Type["type"];
  onAddFragment: () => void;
  onComment: (parameters: { fragment: Type; comment: string }) => void;
  onRemoveFragment: (parameters: { fragment: Type }) => void;
}

const StructuralFragments = <Type extends StructuralFragmentModel>({
  fragments,
  isDisabled,
  structuralFragment,
  onAddFragment,
  onComment,
  onRemoveFragment,
}: StructuralFragmentsProps<Type>): ReactElement => (
  <FragmentList
    fragments={fragments}
    isDisabled={isDisabled}
    structuralFragment={structuralFragment}
    onAddFragment={onAddFragment}
    renderFragment={(fragment, options) => (
      <EditableItem<Type>
        list={options?.list ?? fragments}
        fragment={fragment}
        isDisabled={options?.isDisabled ?? isDisabled}
        onComment={onComment}
        onRemove={onRemoveFragment}
      />
    )}
  />
);

interface TestCaseFragmentsProps {
  fragments: TestCase[];
  isDisabled: boolean;
  scenarioId?: string;
}

export const TestCaseFragments = function TestCaseFragments({
  fragments,
  isDisabled,
  scenarioId,
}: TestCaseFragmentsProps) {
  return (
    <FragmentList
      fragments={fragments}
      isDisabled={isDisabled}
      structuralFragment={StructuralFragmentName.TestCase}
      scenarioId={scenarioId}
      renderFragment={(fragment, options) => (
        <EditableTestCaseItem
          list={options?.list ?? fragments}
          fragment={fragment}
          isDisabled={options?.isDisabled ?? isDisabled}
        />
      )}
    />
  );
};

export default StructuralFragments;
