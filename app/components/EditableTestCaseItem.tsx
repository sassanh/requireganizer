import { Stack, StackProps } from "@mui/material";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";

import { TestCase } from "store/models";

import { animationSeconds } from "./animation";
import FragmentShell from "./FragmentShell";
import { StagedTextField } from "./TextChange";

interface EditableTestCaseItemProps extends StackProps {
  list: TestCase[];
  fragment: TestCase;
}

const EditableTestCaseItemContent = observer(function EditableTestCaseItemContent({
  list,
  fragment,
  ...props
}: EditableTestCaseItemProps) {
  const testStatus = fragment.testStatus;
  const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  };

  return (
    <FragmentShell
      list={list}
      fragment={fragment}
      highlightSx={(theme) => ({
        outline: `2px solid ${theme.vars.palette.action.focus}`,
      })}
      sx={(theme) => {
        const tint =
          testStatus === "generated" ? "46, 125, 50" : testStatus === "out-of-sync" ? "237, 108, 2" : null;
        return {
          py: 1,
          backgroundColor: tint == null ? theme.vars.palette.background.paper : `rgba(${tint}, 0.08)`,
          ...(tint == null ? {} : theme.applyStyles("dark", { backgroundColor: `rgba(${tint}, 0.15)` })),
          transition: `background-color ${animationSeconds(0.2)}s`,
        };
      }}
      {...props}
    >
      <Stack spacing={1} sx={{ flexGrow: 1 }}>
        <StagedTextField
          committed={fragment.title}
          elementId={fragment.id}
          multiline
          fullWidth
          placeholder="Test Case Title"
          size="small"
          sx={{
            "& fieldset": { border: "none" },
          }}
          slotProps={{
            input: {
              onKeyUp: handleKeyUp,
              readOnly: true,
              sx: { pl: 9, fontWeight: "bold" },
            },
          }}
        />
        <StagedTextField
          committed={fragment.steps}
          multiline
          fullWidth
          placeholder="Test Steps"
          size="small"
          sx={{
            "& fieldset": { border: "none" },
          }}
          slotProps={{
            input: {
              onKeyUp: handleKeyUp,
              readOnly: true,
              sx: { pl: 9 },
            },
          }}
        />
        <StagedTextField
          committed={fragment.expectedResult}
          multiline
          fullWidth
          placeholder="Expected Result"
          size="small"
          sx={{
            "& fieldset": { border: "none" },
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
