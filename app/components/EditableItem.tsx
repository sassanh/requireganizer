import { Delete } from "@mui/icons-material";
import {
  IconButton,
  Stack,
  StackProps,
  TextField,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { Fragment, useEffect, useState } from "react";

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
  onComment: (paremeters: { fragment: Type; comment: string }) => void;
  onRemove: (paremeters: { fragment: Type }) => void;
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

  const [hash, setHash] = useState("");

  useEffect(() => {
    const onHashChanged = () => setHash(window.location.hash.replace(/^#/, ""));

    onHashChanged();

    const { pushState, replaceState } = window.history;
    window.history.pushState = function (...args) {
      pushState.apply(window.history, args);
      setTimeout(onHashChanged);
    };
    window.history.replaceState = function (...args) {
      replaceState.apply(window.history, args);
      setTimeout(onHashChanged);
    };

    window.addEventListener("hashchange", onHashChanged);
    return () => {
      window.removeEventListener("hashchange", onHashChanged);
    };
  }, []);

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
          sx={{
            position: "relative",
            zIndex: 1,
            fontWeight: 800,
            mr: -8,
            mt: 2,
            flexBasis: "calc(var(--mui-spacing) * 7)",
            flexShrink: 0,
            flexGrow: 0,
            color: {
              [Priority.Low]: "#4caf50",
              [Priority.Medium]: "#ff9800",
              [Priority.High]: "#f44336",
              "": "inherit",
            }[fragment.priority ?? ""],
          }}
        >
          {fragment.getCode()}.
        </Typography>
        <TextField
          multiline
          fullWidth
          onChange={handleChange}
          value={fragment.content}
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
          <IconButton disabled={isDisabled} onClick={handleRemove}>
            <Delete />
          </IconButton>
          <CommentButton disabled={isDisabled} onSubmit={handleComment} />
        </Stack>
      </Stack>
      {fragment.dependencies.length > 0 && (
        <Typography variant="caption" pb={1}>
          Dependencies:{" "}
          {fragment.dependencies.map((id, index) => (
            <Fragment key={id}>
              <Link
                scroll={false}
                href={`#${store.getCode(id)}`}
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
        <Typography variant="caption" pb={1}>
          References:{" "}
          {fragment.references.map((reference, index) => (
            <Fragment key={reference.id}>
              <Link href={store.getPath(reference.id)} underline="hover">
                {store.getCode(reference.id)}
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
