"use client";

import { CheckCircle, Lock, RadioButtonUnchecked, Timelapse } from "@mui/icons-material";
import { Box, LinearProgress, List, ListItemButton, Stack, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";

import type { StageSummary } from "../module";
import type { StageProgress } from "../units";
import { STAGE_PROGRESS_LABELS } from "../units";
import { useWorkflowView } from "./context";
import { useIdleSince } from "./frameSchedule";
import { useThreadsWithAgent } from "./slots";

const PROGRESS_ICONS: Record<StageProgress, typeof CheckCircle> = {
  empty: RadioButtonUnchecked,
  "in-progress": Timelapse,
  complete: CheckCircle,
};

const PROGRESS_COLORS: Record<StageProgress, "disabled" | "warning" | "success"> = {
  empty: "disabled",
  "in-progress": "warning",
  complete: "success",
};

/** One stage to choose: its label and what a preview marks in it, then, once known, its state and its approvals. */
function StageButton({
  stage,
  selected,
  onSelect,
  summary,
}: {
  stage: string;
  selected: string;
  onSelect: (stage: string) => void;
  summary: StageSummary | null;
}) {
  const { module, workflow, preview } = useWorkflowView();
  const threadsWithAgent = useThreadsWithAgent();
  const isSelected = stage === selected;
  const marked = preview?.count(stage) ?? 0;
  const waitingThreads = summary == null ? 0 : module.threadsWaitingForSpecOwner(stage, threadsWithAgent).length;
  const ProgressIcon = summary == null ? null : PROGRESS_ICONS[summary.progress];
  return (
    <ListItemButton
      selected={isSelected}
      aria-current={isSelected ? "page" : undefined}
      onClick={() => onSelect(stage)}
      sx={{ borderRadius: 1, mb: 0.5, alignItems: "stretch", flexDirection: "column", gap: 0.5, borderLeft: 3, borderColor: isSelected ? "primary.light" : "transparent" }}
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: isSelected ? 700 : 500 }}>
          {workflow.stage(stage).label}
        </Typography>
        {waitingThreads > 0 && (
          <Tooltip title={`${waitingThreads} ${waitingThreads === 1 ? "thread waits" : "threads wait"} for you`}>
            <Box
              component="span"
              sx={{ minWidth: 20, px: 0.75, borderRadius: 10, bgcolor: "warning.main", color: "warning.contrastText", fontSize: 12, lineHeight: "20px", textAlign: "center" }}
            >
              {waitingThreads}
            </Box>
          </Tooltip>
        )}
        {marked > 0 && (
          <Tooltip title="What bringing this state back would add, change or remove here">
            <Box
              component="span"
              aria-label={`${marked} marked`}
              sx={{ minWidth: 20, px: 0.75, borderRadius: 10, bgcolor: "info.main", color: "info.contrastText", fontSize: 12, lineHeight: "20px", textAlign: "center" }}
            >
              {marked}
            </Box>
          </Tooltip>
        )}
        {summary != null && !summary.open && (
          <Tooltip title="Closed until the stages it builds on are complete">
            <Lock fontSize="small" color="disabled" />
          </Tooltip>
        )}
        {summary != null && ProgressIcon != null && (
          <Tooltip title={STAGE_PROGRESS_LABELS[summary.progress]}>
            <ProgressIcon fontSize="small" color={PROGRESS_COLORS[summary.progress]} />
          </Tooltip>
        )}
      </Stack>
      {summary != null && (
        <>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
            <LinearProgress
              variant="determinate"
              value={summary.total === 0 ? 0 : (summary.approved / summary.total) * 100}
              color={summary.progress === "complete" ? "success" : "primary"}
              sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
              aria-label={`${summary.approved} of ${summary.total} approved`}
            />
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 44, textAlign: "right" }}>
              {summary.approved}/{summary.total}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {summary.open ? "Open" : "Closed"} · {STAGE_PROGRESS_LABELS[summary.progress]}
          </Typography>
        </>
      )}
    </ListItemButton>
  );
}

/**
 * Every stage with its state on both axes and its approvals, and whether the
 * module is complete. A preview shows its stages first and their state once
 * the page is idle: working it out derives every unit of every stage.
 */
const StageNavigation = observer(function StageNavigation({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (stage: string) => void;
}) {
  const { module, workflow, preview } = useWorkflowView();
  const stateShown = useIdleSince(preview == null ? null : module);
  const summaries = stateShown ? workflow.stageIds.map((stage) => module.stageSummary(stage)) : null;
  const needsAttention = summaries?.filter(({ open, progress }) => open && progress !== "complete") ?? [];
  return (
    <Stack sx={{ width: 280, flexShrink: 0, gap: 1, p: 1.5, overflowY: "auto" }}>
      {summaries != null && (
        <Stack
          direction="row"
          sx={{ alignItems: "center", gap: 1, p: 1, borderRadius: 1, bgcolor: module.isComplete ? "success.light" : "action.hover" }}
        >
          {module.isComplete ? <CheckCircle color="success" /> : <Timelapse color="warning" />}
          <Typography variant="subtitle2">{module.isComplete ? "Every stage is complete" : "Not every stage is complete"}</Typography>
        </Stack>
      )}
      {needsAttention.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
          Open and not complete: {needsAttention.map(({ stage }) => workflow.stage(stage).label).join(", ")}
        </Typography>
      )}
      <List disablePadding>
        {workflow.stageIds.map((stage, index) => (
          <StageButton key={stage} stage={stage} selected={selected} onSelect={onSelect} summary={summaries?.[index] ?? null} />
        ))}
      </List>
    </Stack>
  );
});

export default StageNavigation;
