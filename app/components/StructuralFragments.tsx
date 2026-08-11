import { Add } from "@mui/icons-material";
import { Button, Divider, Paper, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";
import { Fragment, ReactElement, ReactNode } from "react";

import {
  STRUCTURAL_FRAGMENT_LABEL,
  StructuralFragment as StructuralFragmentName,
} from "store";
import {
  StructuralFragment as StructuralFragmentModel,
  TestCase,
} from "store/models";

import EditableItem from "./EditableItem";
import EditableTestCaseItem from "./EditableTestCaseItem";

interface FragmentListProps<Type extends StructuralFragmentModel> {
  fragments: Type[];
  isDisabled: boolean;
  structuralFragment: Type["type"];
  onAddFragment: () => void;
  renderFragment: (fragment: Type) => ReactNode;
}

function FragmentList<Type extends StructuralFragmentModel>({
  fragments,
  isDisabled,
  structuralFragment,
  onAddFragment,
  renderFragment,
}: FragmentListProps<Type>) {
  return (
    <Stack component={Paper} variant="outlined" sx={{ p: 1, gap: 1 }}>
      {fragments.map((fragment) => (
        <Fragment key={fragment.id}>
          {renderFragment(fragment)}
          <Divider />
        </Fragment>
      ))}
      <Button disabled={isDisabled} endIcon={<Add />} onClick={onAddFragment}>
        Add {STRUCTURAL_FRAGMENT_LABEL[structuralFragment]}
      </Button>
    </Stack>
  );
}

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
    renderFragment={(fragment) => (
      <EditableItem<Type>
        list={fragments}
        fragment={fragment}
        isDisabled={isDisabled}
        onComment={onComment}
        onRemove={onRemoveFragment}
      />
    )}
  />
);

interface TestCaseFragmentsProps {
  fragments: TestCase[];
  isDisabled: boolean;
  onAddFragment: () => void;
  onComment: (parameters: { fragment: TestCase; comment: string }) => void;
  onRemoveFragment: (parameters: { fragment: TestCase }) => void;
}

export const TestCaseFragments = observer(function TestCaseFragments({
  fragments,
  isDisabled,
  onAddFragment,
  onComment,
  onRemoveFragment,
}: TestCaseFragmentsProps) {
  return (
    <FragmentList
      fragments={fragments}
      isDisabled={isDisabled}
      structuralFragment={StructuralFragmentName.TestCase}
      onAddFragment={onAddFragment}
      renderFragment={(fragment) => (
        <EditableTestCaseItem
          list={fragments}
          fragment={fragment}
          isDisabled={isDisabled}
          onComment={onComment}
          onRemove={onRemoveFragment}
        />
      )}
    />
  );
});

export default observer(StructuralFragments);
