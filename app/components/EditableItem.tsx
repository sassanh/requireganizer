import { StackProps } from "@mui/material";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";

import { useShownStore } from "presentation";
import { type FragmentReference, StructuralFragment } from "store/models";

import FragmentShell from "./FragmentShell";
import { StagedTextField } from "./TextChange";

interface EditableItemProps<Type extends StructuralFragment>
  extends StackProps {
  isDisabled: boolean;
  list: Type[];
  fragment: Type;
  onComment: (parameters: { fragment: FragmentReference; comment: string }) => void;
}

const EditableItemContent = observer(function EditableItemContent<
  Type extends StructuralFragment,
>({
  isDisabled,
  list,
  fragment,
  onComment,
  ...props
}: EditableItemProps<Type>) {
  const shown = useShownStore();
  return (
    <FragmentShell
      isDisabled={isDisabled}
      list={list}
      fragment={fragment}
      onComment={onComment}
      {...props}
    >
      <StagedTextField
        committed={fragment.content}
        lastSigned={shown?.signedTextOf(fragment.id) ?? null}
        pendingRemoval={fragment.pendingRemoval}
        elementId={fragment.id}
        multiline
        fullWidth
        disabled={isDisabled}
        sx={{
          "& fieldset": { border: "none" },
        }}
        slotProps={{
          input: {
            readOnly: true,
            sx: { pl: 9 },
          },
        }}
      />
    </FragmentShell>
  );
});

// Snapshot restores can destroy a fragment before React reconciles the list
// that owned it. Keep the hook-owning renderer off that node; the list
// shows the frozen last-live picture for the exit animation.
const EditableItem = <Type extends StructuralFragment>(
  props: EditableItemProps<Type>,
) => (isAlive(props.fragment) ? <EditableItemContent {...props} /> : null);

export default EditableItem;
