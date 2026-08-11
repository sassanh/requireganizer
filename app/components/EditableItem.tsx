import { StackProps, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";

import { StructuralFragment } from "store/models";

import FragmentShell from "./FragmentShell";

interface EditableItemProps<Type extends StructuralFragment>
  extends StackProps {
  isDisabled: boolean;
  list: Type[];
  fragment: Type;
  onComment: (parameters: { fragment: Type; comment: string }) => void;
  onRemove: (parameters: { fragment: Type }) => void;
}

const EditableItem = <Type extends StructuralFragment>({
  isDisabled,
  list,
  fragment,
  onComment,
  onRemove,
  ...props
}: EditableItemProps<Type>) => {
  const handleChange = ({
    target: { value },
  }: React.ChangeEvent<HTMLTextAreaElement>) => {
    fragment.setContent(value);
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
        value={fragment.content}
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
};

export default observer(EditableItem);
