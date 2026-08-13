import { Stack, StackProps, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";

import { TestCase } from "store/models";

import FragmentShell from "./FragmentShell";

interface EditableTestCaseItemProps extends StackProps {
  isDisabled: boolean;
  list: TestCase[];
  fragment: TestCase;
}

const EditableTestCaseItem = ({
  isDisabled,
  list,
  fragment,
  ...props
}: EditableTestCaseItemProps) => {
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
      showActions={false}
      highlightSx={(theme) => ({
        outline: `2px solid ${theme.palette.action.focus}`,
      })}
      sx={(theme) => ({
        py: 1,
        backgroundColor:
          fragment.testStatus === "generated"
            ? theme.palette.mode === "dark"
              ? "rgba(46, 125, 50, 0.15)"
              : "rgba(46, 125, 50, 0.08)"
            : fragment.testStatus === "out-of-sync"
              ? theme.palette.mode === "dark"
                ? "rgba(237, 108, 2, 0.15)"
                : "rgba(237, 108, 2, 0.08)"
              : "transparent",
        transition: "background-color 0.2s",
      })}
      {...props}
    >
      <Stack spacing={1} sx={{ flexGrow: 1 }}>
        <TextField
          multiline
          fullWidth
          value={fragment.title}
          placeholder="Test Case Title"
          size="small"
          sx={{
            "&:not(:focus-within) fieldset": { border: "none" },
          }}
          slotProps={{
            input: {
              onKeyUp: handleKeyUp,
              readOnly: true,
              sx: { pl: 9, fontWeight: "bold" },
            },
          }}
        />
        <TextField
          multiline
          fullWidth
          value={fragment.steps}
          placeholder="Test Steps"
          size="small"
          sx={{
            "&:not(:focus-within) fieldset": { border: "none" },
          }}
          slotProps={{
            input: {
              onKeyUp: handleKeyUp,
              readOnly: true,
              sx: { pl: 9 },
            },
          }}
        />
        <TextField
          multiline
          fullWidth
          value={fragment.expectedResult}
          placeholder="Expected Result"
          size="small"
          sx={{
            "&:not(:focus-within) fieldset": { border: "none" },
          }}
          slotProps={{
            input: {
              onKeyUp: handleKeyUp,
              readOnly: true,
              sx: { pl: 9, fontStyle: "italic" },
            },
          }}
        />
      </Stack>
    </FragmentShell>
  );
};

export default observer(EditableTestCaseItem);
