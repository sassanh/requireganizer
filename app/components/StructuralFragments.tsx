import { Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";
import { ReactElement, ReactNode } from "react";

import {
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
    <Stack sx={{ gap: 1 }}>
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
          </MembershipMotion>
        );
      })}
    </Stack>
  );
});

interface StructuralFragmentsProps<Type extends StructuralFragmentModel> {
  fragments: Type[];
  isDisabled: boolean;
  structuralFragment: Type["type"];
  title?: string;
  onComment: (parameters: { fragment: Type; comment: string }) => void;
}

const StructuralFragments = <Type extends StructuralFragmentModel>({
  fragments,
  isDisabled,
  structuralFragment,
  title,
  onComment,
}: StructuralFragmentsProps<Type>): ReactElement => (
  <Stack sx={{ gap: 1 }}>
    {title != null ? (
      <Typography variant="h6" component="h4">
        {title}
      </Typography>
    ) : null}
    <FragmentList
      fragments={fragments}
      isDisabled={isDisabled}
      structuralFragment={structuralFragment}
      renderFragment={(fragment, options) => (
        <EditableItem<Type>
          list={options?.list ?? fragments}
          fragment={fragment}
          isDisabled={options?.isDisabled ?? isDisabled}
          onComment={onComment}
        />
      )}
    />
  </Stack>
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
