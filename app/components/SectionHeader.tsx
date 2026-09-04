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
  GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE,
  GENERATOR_ACTION_BY_WORKFLOW_STAGE,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_LABELS,
  Status,
  WorkflowStage,
  generateStep,
  refreshStep,
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
  const [refreshTarget, setRefreshTarget] = useState<WorkflowStage | null>(null);
  const [modelHint, setModelHint] = useState("");
  const [hintOpen, setHintOpen] = useState(false);
  const hintFieldRef = useRef<HTMLTextAreaElement>(null);

  // The hint box is hidden until asked for; focus follows the reveal.
  useEffect(() => {
    if (hintOpen) hintFieldRef.current?.focus();
  }, [hintOpen]);

  // One opener for the button and the shortcut: the guards read the live
  // store at call time, and step never changes for a mounted header. A
  // stale prerequisite refreshes through the dialog instead of dying in
  // an error message; anything else blocked speaks through a message.
  const openRefreshDialog = useCallback((target: WorkflowStage) => {
    setRefreshTarget(target);
    setPrepareOpen(true);
  }, []);

  const closePrepare = useCallback(() => {
    setPrepareOpen(false);
    setRefreshTarget(null);
  }, []);

  const requestPrepare = useCallback(() => {
    if (store.isBusy) return;
    if (nextStep == null || nextStepGeneratorAction == null) return;
    const stale = store.stalePrerequisite(nextStep);
    if (stale != null) {
      openRefreshDialog(stale);
      return;
    }
    setRefreshTarget(null);
    const target = {
      blocked: store.isBusy,
      reason: store.cannotGenerateReason(nextStep),
      open: () => setPrepareOpen(true),
    };
    if (prepareGenerateAction.isEnabled(target)) prepareGenerateAction.run(target);
  }, [store, nextStep, nextStepGeneratorAction, openRefreshDialog]);

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
    const trimmed = modelHint.trim();
    const hint = trimmed === "" ? undefined : trimmed;
    if (refreshTarget != null) {
      const target = refreshTarget;
      closePrepare();
      setModelHint("");
      refreshStep(store, target, hint);
      return;
    }
    if (nextStep == null) return;
    closePrepare();
    setModelHint("");
    generateStep(store, nextStep, hint);
  };

  const listChangeText = store.stageListChangeCaption(step)?.text;
  const generateLabel =
    nextStep == null ? "" : WORKFLOW_STAGE_LABELS[nextStep];
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
      {store.canRefreshStep(step) ? (
        <Stack direction="row" sx={{ gap: 2, alignSelf: "center", alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {(() => {
              const input = GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE[step];
              return input == null
                ? `Its inputs changed since ${WORKFLOW_STAGE_LABELS[step]} was generated.`
                : `${WORKFLOW_STAGE_LABELS[input]} changed since ${WORKFLOW_STAGE_LABELS[step]} was generated.`;
            })()}
          </Typography>
          <GenerationButton
            disabled={store.isBusy}
            variant="outlined"
            startIcon={<Refresh />}
            onGenerate={() => openRefreshDialog(step)}
          >
            Refresh with AI
          </GenerationButton>
        </Stack>
      ) : null}
      {store.mechanicalIssuesForStage(step).map((issue, index) => (
        <Typography key={`${issue.itemId ?? "stage"}:${index}`} variant="body2" color="error">
          {issue.message}
        </Typography>
      ))}
      {(nextStep != null && nextStepGeneratorAction != null) || refreshTarget != null ? (
        <Dialog
          open={prepareOpen}
          onClose={closePrepare}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>
            {refreshTarget != null
              ? `Refresh ${WORKFLOW_STAGE_LABELS[refreshTarget]}`
              : `Generate ${generateLabel}`}
          </DialogTitle>
          <DialogContent
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            {refreshTarget != null ? (
              <Typography variant="body2" color="text.secondary">
                Brings {WORKFLOW_STAGE_LABELS[refreshTarget]} in line with
                the current inputs. Untouched items keep their approvals;
                changed items return to draft for your review.
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Builds {generateLabel} from the approved{" "}
                {WORKFLOW_STAGE_LABELS[step]}. Each item still needs your
                review before approval.
              </Typography>
            )}
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
            <Button onClick={closePrepare}>Cancel</Button>
            <Button
              variant="contained"
              disabled={store.isBusy}
              onClick={confirmPrepare}
            >
              {refreshTarget != null ? "Refresh" : "Generate"}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Stack>
  );
};

export default observer(Header);
