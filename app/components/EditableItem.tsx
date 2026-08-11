import { Delete } from "@mui/icons-material";
import {
  IconButton,
  Stack,
  StackProps,
  TextField,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { Fragment } from "react";

import { useFragmentHash } from "hooks/useFragmentHash";
import { FRAGMENT_CODES, Priority, useStore } from "store";
import { StructuralFragment } from "store/models";

import CommentButton from "./CommentButton";
import Link from "./Link";

interface EditableItemProps<Type extends StructuralFragment>
  extends StackProps {
  isDisabled: boolean;
  list: Type[];
  fragment: Type;
  index: number;
  onComment: (parameters: { fragment: Type; comment: string }) => void;
  onRemove: (parameters: { fragment: Type }) => void;
}

const EditableItem = <Type extends StructuralFragment>({
  children,
  isDisabled,
  list,
  fragment,
  index,
  onComment,
  onRemove,
  ...props
}: EditableItemProps<Type>) => {
  const store = useStore();

  const hash = useFragmentHash();

  const handleRemove = () => {
    onRemove({ fragment });
  };

  const handleComment = (comment: string) => {
    onComment({ fragment, comment });
  };

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
    <Stack
      id={fragment.id}
      sx={[
        { pl: 1 },
        (theme) =>
          hash === fragment.getCode() || hash === fragment.id
            ? {
                backgroundColor: theme.palette.action.focus,
              }
            : {},
      ]}
      {...props}
    >
      <Stack
        direction="row"
        data-fragment={`${fragment.type}:${fragment.id}`}
        {...props}
      >
        <Typography
          component={Link}
          href={`#${fragment.getCode()}`}
          underline="hover"
          variant="body1"
          sx={(theme) => ({
            position: "relative",
            zIndex: 1,
            fontWeight: 800,
            mr: -8,
            mt: 2,
            flexBasis: "calc(var(--mui-spacing) * 7)",
            flexShrink: 0,
            flexGrow: 0,
            color: {
              [Priority.P2]: theme.palette.warning.main,
              [Priority.P1]: theme.palette.warning.dark,
              [Priority.P0]: theme.palette.error.main,
              "": "inherit",
            }[fragment.priority ?? ""],
          })}
        >
          {fragment.getCode()}.
        </Typography>
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
        <Stack direction="row">
          <IconButton aria-label="Remove" disabled={isDisabled} onClick={handleRemove}>
            <Delete />
          </IconButton>
          <CommentButton disabled={isDisabled} onSubmit={handleComment} />
        </Stack>
      </Stack>
      {fragment.dependencies.length > 0 && (
        <Typography variant="caption" sx={{
          py: 1
        }}>
          Dependencies:{" "}
          {fragment.dependencies.map((id, index) => (
            <Fragment key={id}>
              <Link
                scroll={false}
                href={store.getCode(id) ? `#${store.getCode(id)}` : "#"}
                underline="hover"
              >
                {FRAGMENT_CODES[fragment.type]}-
                {list.findIndex(({ id: id_ }) => id_ === id) + 1}
              </Link>
              {index < fragment.dependencies.length - 1 ? ", " : ""}
            </Fragment>
          ))}
        </Typography>
      )}
      {fragment.references.length > 0 && (
        <Typography variant="caption" sx={{
          py: 1
        }}>
          References:{" "}
          {fragment.references.map((reference, index) => (
            <Fragment key={reference.id}>
              <Link href={store.getPath(reference.id) ?? "#"} underline="hover">
                {store.getCode(reference.id) ?? reference.id}
              </Link>
              {index < fragment.references.length - 1 ? ", " : ""}
            </Fragment>
          ))}
        </Typography>
      )}
      {children != null ? <div>{children}</div> : null}
    </Stack>
  );
};

export default observer(EditableItem);
