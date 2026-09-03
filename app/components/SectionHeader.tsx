import { ArrowRight, ExpandMore, Refresh } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { generateNextShortcut, prepareGenerateAction } from "actions/actions";
import { actionHint } from "actions/shortcutText";
import {
  isEditableTarget,
  isOverlayTarget,
  useShortcut,
  type ShortcutBinding,
} from "hooks/shortcuts";
import {
  GENERATOR_ACTION_BY_WORKFLOW_STAGE,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_LABELS,
  Status,
  WorkflowStage,
  generateStep,
  useStore,
} from "store";

import GenerationButton from "./GenerationButton";
import css from "./SectionHeader.module.css";

export interface HeaderProps {
  step: WorkflowStage;
}

/** The visible stage page, read live: tabs are driven by ?step=. */
function activeStepFromUrl(): string {
  return new URLSearchParams(window.location.search).get("step") ?? "";
}

const Header: React.FunctionComponent<HeaderProps> = ({
  step,
}: HeaderProps): React.ReactElement => {
  const store = useStore();

  const stepIndex = WORKFLOW_STAGES.indexOf(step);
  const nextStep = stepIndex < WORKFLOW_STAGES.length - 1 ? WORKFLOW_STAGES[stepIndex + 1] : null;
  const currentStepGeneratorAction = store.generatorActionForStep(step);
  const nextStepGeneratorAction = nextStep
    ? GENERATOR_ACTION_BY_WORKFLOW_STAGE[nextStep]
    : null;

  const [prepareOpen, setPrepareOpen] = useState(false);
  const [modelHint, setModelHint] = useState("");
  const [hintOpen, setHintOpen] = useState(false);
  const hintFieldRef = useRef<HTMLTextAreaElement>(null);

  // The hint box is hidden until asked for; focus follows the reveal.
  useEffect(() => {
    if (hintOpen) hintFieldRef.current?.focus();
  }, [hintOpen]);

  // One opener for the button and the shortcut: the guards read the live
  // store at call time, and step never changes for a mounted header. A
  // blocked stage speaks through a message instead of a dead button.
  const requestPrepare = useCallback(() => {
    if (nextStep == null || nextStepGeneratorAction == null) return;
    const target = {
      blocked: store.isBusy,
      reason: store.cannotGenerateReason(nextStep),
      open: () => setPrepareOpen(true),
    };
    if (prepareGenerateAction.isEnabled(target)) prepareGenerateAction.run(target);
  }, [store, nextStep, nextStepGeneratorAction]);

  // Every stage page mounts a header; only the visible one's binding fires.
  const prepareBinding = useMemo<ShortcutBinding>(
    () => ({
      id: prepareGenerateAction.id,
      ...generateNextShortcut,
      when: (event) =>
        activeStepFromUrl() === step &&
        !isEditableTarget(event.target) &&
        !isOverlayTarget(event.target),
      action: requestPrepare,
    }),
    [requestPrepare, step],
  );
  useShortcut(prepareBinding);

  const confirmPrepare = () => {
    if (nextStep == null) return;
    const trimmed = modelHint.trim();
    setPrepareOpen(false);
    setModelHint("");
    generateStep(store, nextStep, trimmed === "" ? undefined : trimmed);
  };

  const listChangeText = store.stageListChangeCaption(step)?.text;
  const writtenHint = modelHint.trim().replace(/\s+/g, " ");
  const hintPreview =
    writtenHint.length > 80 ? `${writtenHint.slice(0, 80)}…` : writtenHint;

  return (
    <Stack
      sx={{
        gap: 2,
        mb: 2
      }}>
      <Stack direction="row" sx={{
        justifyContent: "space-between"
      }}>
        <div className={css.headerPrevious}>
          {currentStepGeneratorAction != null &&
          store.getStepStatus(step) === Status.Pending ? (
            <GenerationButton
              disabled={store.isBusy || !store.canGenerateStep(step)}
              variant="outlined"
              size="large"
              startIcon={<Refresh />}
              onGenerate={() => store[currentStepGeneratorAction]()}
            >
              Generate {WORKFLOW_STAGE_LABELS[step]}
            </GenerationButton>
          ) : null}
        </div>
        <div className={css.headerNext}>
          {nextStep && nextStepGeneratorAction ? (
            <>
              <Tooltip
                title={actionHint(
                  `Generate ${WORKFLOW_STAGE_LABELS[nextStep]}`,
                  generateNextShortcut,
                )}
              >
                <span>
                  <GenerationButton
                    disabled={store.isBusy}
                    variant="contained"
                    size="large"
                    autoCapitalize="off"
                    endIcon={<ArrowRight />}
                    onGenerate={requestPrepare}
                  >
                    {WORKFLOW_STAGE_LABELS[nextStep]}
                  </GenerationButton>
                </span>
              </Tooltip>
            </>
          ) : null}
        </div>
      </Stack>
      <Typography variant="h3" sx={{
        alignSelf: "center"
      }}>
        {WORKFLOW_STAGE_LABELS[step]}
      </Typography>
      {listChangeText != null ? (
        <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "center" }}>
          {listChangeText}
        </Typography>
      ) : null}
      {store.mechanicalIssuesForStage(step).map((issue, index) => (
        <Typography key={`${issue.itemId ?? "stage"}:${index}`} variant="body2" color="error">
          {issue.message}
        </Typography>
      ))}
      {nextStep != null && nextStepGeneratorAction != null ? (
        <Dialog
          open={prepareOpen}
          onClose={() => setPrepareOpen(false)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>
            Generate {WORKFLOW_STAGE_LABELS[nextStep]}
          </DialogTitle>
          <DialogContent
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            <Typography variant="body2" color="text.secondary">
              Builds {WORKFLOW_STAGE_LABELS[nextStep]} from the approved{" "}
              {WORKFLOW_STAGE_LABELS[step]}. Each item still needs your
              review before approval.
            </Typography>
            <Accordion
              disableGutters
              elevation={0}
              expanded={hintOpen}
              onChange={(_, open) => setHintOpen(open)}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="body2" color="text.secondary">
                  {hintPreview === ""
                    ? "Add a hint for the model (optional)"
                    : `Hint: ${hintPreview}`}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  label="Hint"
                  helperText="The model reads this while generating."
                  value={modelHint}
                  inputRef={hintFieldRef}
                  onChange={(event) => setModelHint(event.target.value)}
                />
              </AccordionDetails>
            </Accordion>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPrepareOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              disabled={store.isBusy}
              onClick={confirmPrepare}
            >
              Generate
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Stack>
  );
};

export default observer(Header);
