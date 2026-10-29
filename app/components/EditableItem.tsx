import { StackProps } from "@mui/material";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";

import { useShownStore } from "presentation";
import { StructuralFragment } from "store/models";

import FragmentShell from "./FragmentShell";
import { StagedTextField } from "./TextChange";

interface EditableItemProps<Type extends StructuralFragment>
  extends StackProps {
  isDisabled: boolean;
  list: Type[];
  fragment: Type;
}

const EditableItemContent = observer(function EditableItemContent<
  Type extends StructuralFragment,
>({
  isDisabled,
  list,
  fragment,
  ...props
}: EditableItemProps<Type>) {
  const shown = useShownStore();
  return (
    <FragmentShell
      list={list}
      fragment={fragment}
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
            sx: {
              fontSize: '1.2rem',
              pl: 9,
            },
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
