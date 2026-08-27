import { StackProps, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";

import { useStore } from "store";
import { StructuralFragment } from "store/models";
import { commitTimelineSegment } from "store/timeline/controller";

import { useStagedContent } from "./changeQueue";
import FragmentShell from "./FragmentShell";

interface EditableItemProps<Type extends StructuralFragment>
  extends StackProps {
  isDisabled: boolean;
  list: Type[];
  fragment: Type;
  /** The item's identity; content updates animate prev→next. */
  stageSubject?: string;
  onComment: (parameters: { fragment: Type; comment: string }) => void;
  onRemove: (parameters: { fragment: Type }) => void;
}

const EditableItemContent = observer(function EditableItemContent<
  Type extends StructuralFragment,
>({
  isDisabled,
  list,
  fragment,
  stageSubject,
  onComment,
  onRemove,
  ...props
}: EditableItemProps<Type>) {
  const displayed = useStagedContent(stageSubject, fragment.id, fragment.content);
  const realStore = useStore();
  const handleChange = ({
    target: { value },
  }: React.ChangeEvent<HTMLTextAreaElement>) => {
    const writable = realStore.structuralFragmentsCache[fragment.id];
    if (writable == null || !isAlive(writable)) return;
    writable.setContent(value);
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  };

  return (
    <FragmentShell
      isDisabled={isDisabled}
      list={list}
      fragment={fragment}
      onComment={onComment}
      onRemove={onRemove}
      {...props}
    >
      <TextField
        multiline
        fullWidth
        onChange={handleChange}
        onBlur={commitTimelineSegment}
        value={displayed}
        disabled={isDisabled}
        sx={{
          "&:not(:focus-within) fieldset": { border: "none" },
        }}
        slotProps={{
          input: {
            onKeyUp: handleKeyUp,
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
