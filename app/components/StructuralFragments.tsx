import { Add } from "@mui/icons-material";
import { Button, Divider, Paper, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";
import { Fragment } from "react";

import { STRUCTURAL_FRAGMENT_LABEL } from "store";
import { StructuralFragment } from "store/models";

import EditableItem from "./EditableItem";

interface StructuralFragmentsProps<Type extends StructuralFragment> {
  fragments: Type[];
  isDisabled: boolean;
  structuralFragment: Type["type"];
  onAddFragment: () => void;
  onComment: (parameters: { fragment: Type; comment: string }) => void;
  onRemoveFragment: (parameters: { fragment: Type }) => void;
}

const StructuralFragments = <Type extends StructuralFragment>({
  fragments,
  isDisabled,
  structuralFragment,
  onAddFragment,
  onComment,
  onRemoveFragment,
}: StructuralFragmentsProps<Type>): React.ReactElement => {
  return (
    <Stack component={Paper} p={1} gap={1} variant="outlined">
      {fragments.map((fragment, index) => (
        <Fragment key={fragment.id}>
          <EditableItem<Type>
            key={fragment.id}
            list={fragments}
            fragment={fragment}
            index={index}
            isDisabled={isDisabled}
            onComment={onComment}
            onRemove={onRemoveFragment}
          />
          <Divider />
        </Fragment>
      ))}
      <Button disabled={isDisabled} endIcon={<Add />} onClick={onAddFragment}>
        Add {STRUCTURAL_FRAGMENT_LABEL[structuralFragment]}
      </Button>
    </Stack>
  );
};

export default observer(StructuralFragments);
