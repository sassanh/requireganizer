import { Stack, StackProps, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";

import { TestCase } from "store/models";

import { useStagedContent } from "./changeQueue";
import FragmentShell from "./FragmentShell";

interface EditableTestCaseItemProps extends StackProps {
  isDisabled: boolean;
  list: TestCase[];
  fragment: TestCase;
  /** The item's identity; content updates animate prev→next. */
  stageSubject?: string;
}

const EditableTestCaseItemContent = observer(function EditableTestCaseItemContent({
  isDisabled,
  list,
  fragment,
  stageSubject,
  ...props
}: EditableTestCaseItemProps) {
  const testStatus = fragment.testStatus;
  // One item is one animated element: a single displayed copy covers every
  // field of the card, and one turn swaps them together.
  const displayed = useStagedContent(
    stageSubject,
    fragment.id,
    {
      title: fragment.title,
      steps: fragment.steps,
      expectedResult: fragment.expectedResult,
    },
    (left, right) =>
      left.title === right.title &&
      left.steps === right.steps &&
      left.expectedResult === right.expectedResult,
  );
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
          testStatus === "generated"
            ? theme.palette.mode === "dark"
              ? "rgba(46, 125, 50, 0.15)"
              : "rgba(46, 125, 50, 0.08)"
            : testStatus === "out-of-sync"
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
          value={displayed.title}
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
          value={displayed.steps}
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
          value={displayed.expectedResult}
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
});

const EditableTestCaseItem = (props: EditableTestCaseItemProps) =>
  isAlive(props.fragment) ? <EditableTestCaseItemContent {...props} /> : null;

export default EditableTestCaseItem;
