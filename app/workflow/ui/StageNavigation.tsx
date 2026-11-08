"use client";

import { CheckCircle, Lock, LockOpen, RadioButtonUnchecked, Timelapse } from "@mui/icons-material";
import { Box, LinearProgress, List, ListItemButton, Stack, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";

import type { StageProgress } from "../units";
import { STAGE_PROGRESS_LABELS } from "../units";
import { useWorkflowView } from "./context";

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

/** Every stage with its state on both axes and its approvals, and whether the module is complete. */
const StageNavigation = observer(function StageNavigation({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (stage: string) => void;
}) {
  const { module, workflow } = useWorkflowView();
  const summaries = workflow.stageIds.map((stage) => module.stageSummary(stage));
  const needsAttention = summaries.filter(({ open, progress }) => open && progress !== "complete");
  return (
    <Stack sx={{ width: 280, flexShrink: 0, gap: 1, p: 1.5, overflowY: "auto" }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1, p: 1, borderRadius: 1, bgcolor: module.isComplete ? "success.light" : "action.hover" }}
      >
        {module.isComplete ? <CheckCircle color="success" /> : <Timelapse color="warning" />}
        <Typography variant="subtitle2">{module.isComplete ? "Every stage is complete" : "Not every stage is complete"}</Typography>
      </Stack>
      {needsAttention.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
          Open and not complete: {needsAttention.map(({ stage }) => workflow.stage(stage).label).join(", ")}
        </Typography>
      )}
      <List disablePadding>
        {summaries.map((summary) => {
          const ProgressIcon = PROGRESS_ICONS[summary.progress];
          const isSelected = summary.stage === selected;
          const percent = summary.total === 0 ? 0 : (summary.approved / summary.total) * 100;
          return (
            <ListItemButton
              key={summary.stage}
              selected={isSelected}
              aria-current={isSelected ? "page" : undefined}
              onClick={() => onSelect(summary.stage)}
              sx={{ borderRadius: 1, mb: 0.5, alignItems: "stretch", flexDirection: "column", gap: 0.5, borderLeft: 3, borderColor: isSelected ? "primary.light" : "transparent" }}
            >
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: isSelected ? 700 : 500 }}>
                  {workflow.stage(summary.stage).label}
                </Typography>
                {summary.threadsWaitingForSpecOwner > 0 && (
                  <Tooltip title={`${summary.threadsWaitingForSpecOwner} ${summary.threadsWaitingForSpecOwner === 1 ? "thread waits" : "threads wait"} for you`}>
                    <Box
                      component="span"
                      sx={{ minWidth: 20, px: 0.75, borderRadius: 10, bgcolor: "warning.main", color: "warning.contrastText", fontSize: 12, lineHeight: "20px", textAlign: "center" }}
                    >
                      {summary.threadsWaitingForSpecOwner}
                    </Box>
                  </Tooltip>
                )}
                <Tooltip title={summary.open ? "Open" : "Closed until the stages it builds on are complete"}>
                  {summary.open ? <LockOpen fontSize="small" color="action" /> : <Lock fontSize="small" color="disabled" />}
                </Tooltip>
                <Tooltip title={STAGE_PROGRESS_LABELS[summary.progress]}>
                  <ProgressIcon fontSize="small" color={PROGRESS_COLORS[summary.progress]} />
                </Tooltip>
              </Stack>
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={percent}
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
            </ListItemButton>
          );
        })}
      </List>
    </Stack>
  );
});

export default StageNavigation;
