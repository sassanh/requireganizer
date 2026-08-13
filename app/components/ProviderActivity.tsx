"use client";

import {
  ChevronRight,
  DeleteOutlined,
  Download,
  InfoOutlined,
} from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Badge,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Portal,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { saveAs } from "file-saver";
import { useMemo, useState } from "react";

import {
  providerCallExportBaseName,
  providerCallsToCsv,
} from "lib/providerCallExport";
import type { ProviderCallOutcome, ProviderCallRecord } from "lib/types";

interface ProviderActivityProps {
  calls: readonly ProviderCallRecord[];
  projectName: string;
  onDelete: (id: string) => void;
  onClear: () => void;
}

const OUTCOME_LABELS: Record<ProviderCallOutcome, string> = {
  success: "Success",
  needs_input: "Needs input",
  rejected: "Rejected",
  failed: "Failed",
};

const OUTCOME_COLORS: Record<
  ProviderCallOutcome,
  "success" | "info" | "warning" | "error"
> = {
  success: "success",
  needs_input: "info",
  rejected: "warning",
  failed: "error",
};

function formatTokens(value: number | undefined): string {
  return value === undefined ? "Not reported" : value.toLocaleString();
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000
    ? `${durationMs} ms`
    : `${(durationMs / 1_000).toFixed(1)} s`;
}

function MetadataItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <Box>
      <Typography color="text.secondary" component="dt" variant="caption">
        {label}
      </Typography>
      <Typography
        component="dd"
        variant="body2"
        sx={{ m: 0, overflowWrap: "anywhere" }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export default function ProviderActivity({
  calls,
  projectName,
  onDelete,
  onClear,
}: ProviderActivityProps) {
  const [open, setOpen] = useState(false);
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
  const [callToDelete, setCallToDelete] = useState<ProviderCallRecord | null>(
    null,
  );
  const summary = useMemo(() => {
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let cacheReportedInputTokens = 0;
    let outputTokens = 0;
    let inputReported = false;
    let cacheReported = false;
    let cacheRateReported = false;
    let outputReported = false;

    for (const call of calls) {
      if (call.usage?.inputTokens !== undefined) {
        inputReported = true;
        inputTokens += call.usage.inputTokens;
      }
      if (call.usage?.outputTokens !== undefined) {
        outputReported = true;
        outputTokens += call.usage.outputTokens;
      }
      if (call.usage?.cachedInputTokens !== undefined) {
        cacheReported = true;
        cachedInputTokens += call.usage.cachedInputTokens;
        if (call.usage.inputTokens !== undefined) {
          cacheRateReported = true;
          cacheReportedInputTokens += call.usage.inputTokens;
        }
      }
    }

    return {
      inputTokens: inputReported || calls.length === 0 ? inputTokens : undefined,
      cachedInputTokens:
        cacheReported || calls.length === 0 ? cachedInputTokens : undefined,
      outputTokens:
        outputReported || calls.length === 0 ? outputTokens : undefined,
      cacheHitRate:
        !cacheRateReported || cacheReportedInputTokens === 0
          ? undefined
          : cachedInputTokens / cacheReportedInputTokens,
    };
  }, [calls]);

  const exportCalls = (format: "json" | "csv") => {
    const baseName = providerCallExportBaseName(projectName);
    const content =
      format === "json"
        ? JSON.stringify(calls, null, 2)
        : providerCallsToCsv(calls);
    const type =
      format === "json"
        ? "application/json;charset=utf-8"
        : "text/csv;charset=utf-8";
    saveAs(new Blob([content], { type }), `${baseName}.${format}`);
  };

  return (
    <>
      <Portal>
        <Tooltip title="AI provider activity">
          <IconButton
            aria-label="Open AI provider activity"
            color="primary"
            onClick={() => setOpen(true)}
            sx={(theme) => ({
              position: "fixed",
              top: "calc(env(safe-area-inset-top, 0px) + 16px)",
              right: "calc(env(safe-area-inset-right, 0px) + 16px)",
              zIndex: theme.zIndex.tooltip + 1,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
              boxShadow: 3,
              "&:hover": {
                bgcolor: "action.hover",
              },
            })}
          >
            <Badge badgeContent={calls.length} color="secondary" max={99}>
              <InfoOutlined />
            </Badge>
          </IconButton>
        </Tooltip>
      </Portal>

      <Dialog
        fullWidth
        maxWidth="md"
        open={open}
        onClose={() => setOpen(false)}
        sx={(theme) => ({ zIndex: theme.zIndex.tooltip + 2 })}
      >
        <DialogTitle>AI provider activity</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography color="text.secondary" variant="body2">
              This project report is stored in this browser. It contains request
              metadata, not prompts or model responses.
            </Typography>

            <Box
              sx={{
                display: "grid",
                gap: 1,
                gridTemplateColumns: {
                  xs: "repeat(2, minmax(0, 1fr))",
                  sm: "repeat(4, minmax(0, 1fr))",
                  md: "repeat(5, minmax(0, 1fr))",
                },
              }}
            >
              {[
                ["Calls", calls.length.toLocaleString()],
                ["Input tokens", formatTokens(summary.inputTokens)],
                ["Cached input", formatTokens(summary.cachedInputTokens)],
                [
                  "Cache hit rate",
                  summary.cacheHitRate === undefined
                    ? "Not reported"
                    : `${(summary.cacheHitRate * 100).toFixed(1)}%`,
                ],
                ["Output tokens", formatTokens(summary.outputTokens)],
              ].map(([label, value]) => (
                <Paper key={label} variant="outlined" sx={{ p: 1.5 }}>
                  <Typography color="text.secondary" variant="caption">
                    {label}
                  </Typography>
                  <Typography variant="h6">{value}</Typography>
                </Paper>
              ))}
            </Box>

            {calls.length === 0 ? (
              <Typography>No provider calls have been recorded for this project.</Typography>
            ) : (
              <Stack spacing={1}>
                {[...calls].reverse().map((call) => (
                  <Box key={call.id} sx={{ position: "relative" }}>
                    <Accordion
                      disableGutters
                      variant="outlined"
                      sx={{
                        "&::before": { display: "none" },
                      }}
                    >
                    <AccordionSummary
                      expandIcon={<ChevronRight />}
                      sx={{
                        minHeight: 64,
                        pl: 6,
                        pr: 7,
                        "&.Mui-expanded": { minHeight: 64 },
                        "& .MuiAccordionSummary-expandIconWrapper": {
                          left: 12,
                          position: "absolute",
                          transform: "rotate(0deg)",
                        },
                        "& .MuiAccordionSummary-expandIconWrapper.Mui-expanded": {
                          transform: "rotate(90deg)",
                        },
                      }}
                    >
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          sx={{
                            alignItems: { xs: "flex-start", sm: "center" },
                            gap: 1,
                            minWidth: 0,
                            pr: 1,
                            width: "100%",
                          }}
                        >
                          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Typography noWrap variant="subtitle1">
                              {call.operation}
                            </Typography>
                            <Typography
                              color="text.secondary"
                              variant="caption"
                            >
                              {new Date(call.startedAt).toLocaleString()} · Attempt{" "}
                              {call.attempt}
                            </Typography>
                          </Box>
                          <Stack
                            direction="row"
                            sx={{ alignItems: "center", gap: 2, flexShrink: 0 }}
                          >
                            <Typography color="text.secondary" variant="body2">
                              {formatDuration(call.durationMs)}
                            </Typography>
                            <Typography color="text.secondary" variant="body2">
                              {call.usage?.totalTokens === undefined
                                ? "Tokens not reported"
                                : `${formatTokens(call.usage.totalTokens)} tokens`}
                            </Typography>
                          </Stack>
                          <Chip
                            color={OUTCOME_COLORS[call.outcome]}
                            label={OUTCOME_LABELS[call.outcome]}
                            size="small"
                          />
                        </Stack>
                    </AccordionSummary>

                    <AccordionDetails
                      sx={{
                        borderColor: "divider",
                        borderTop: "1px solid",
                        pt: 2,
                      }}
                    >
                      <Box
                        component="dl"
                        sx={{
                          display: "grid",
                          gap: 1.5,
                          gridTemplateColumns: {
                            xs: "repeat(2, minmax(0, 1fr))",
                            sm: "repeat(4, minmax(0, 1fr))",
                          },
                          m: 0,
                        }}
                      >
                        <MetadataItem
                          label="Time"
                          value={new Date(call.startedAt).toLocaleString()}
                        />
                        <MetadataItem
                          label="Duration"
                          value={formatDuration(call.durationMs)}
                        />
                        <MetadataItem label="Provider" value={call.provider} />
                        <MetadataItem label="Model" value={call.model} />
                        <MetadataItem
                          label="Authentication"
                          value={call.authenticationMode === "configured"
                            ? "Configured API key"
                            : call.authenticationMode === "anonymous"
                              ? "No configured API key"
                              : "Not reported"}
                        />
                        <MetadataItem
                          label="Attempt"
                          value={call.attempt.toString()}
                        />
                        <MetadataItem
                          label="Selected tool"
                          value={call.toolName ?? "None"}
                        />
                        <MetadataItem
                          label="Tool calls"
                          value={call.toolCallCount.toString()}
                        />
                        <MetadataItem
                          label="Input tokens"
                          value={formatTokens(call.usage?.inputTokens)}
                        />
                        <MetadataItem
                          label="Cached input"
                          value={formatTokens(call.usage?.cachedInputTokens)}
                        />
                        <MetadataItem
                          label="Cache write"
                          value={formatTokens(call.usage?.cacheWriteTokens)}
                        />
                        <MetadataItem
                          label="Output tokens"
                          value={formatTokens(call.usage?.outputTokens)}
                        />
                        <MetadataItem
                          label="Total tokens"
                          value={formatTokens(call.usage?.totalTokens)}
                        />
                        <MetadataItem
                          label="Finish reason"
                          value={call.finishReason ?? "Not reported"}
                        />
                        <MetadataItem
                          label="HTTP status"
                          value={call.httpStatus?.toString() ?? "Not reported"}
                        />
                        <MetadataItem
                          label="Error code"
                          value={call.errorCode ?? "None"}
                        />
                        <MetadataItem
                          label="Response ID"
                          value={call.responseId ?? "Not reported"}
                        />
                        <MetadataItem
                          label="Request ID"
                          value={call.requestId ?? "Not reported"}
                        />
                        <MetadataItem
                          label="Harness contract"
                          value={`v${call.protocolVersion} / ${call.promptVersion}`}
                        />
                        <MetadataItem
                          label="Adapters"
                          value={call.adapterIds?.join(", ") || "Not applicable"}
                        />
                        <MetadataItem
                          label="Interface revisions"
                          value={call.interfaceContractRevisionIds?.join(", ") || "Not applicable"}
                        />
                        <MetadataItem
                          label="Subject revisions"
                          value={call.subjectContractRevisionIds?.join(", ") || "Not applicable"}
                        />
                      </Box>
                    </AccordionDetails>
                    </Accordion>
                    <Tooltip title="Delete call">
                      <IconButton
                        aria-label={`Delete ${call.operation} call`}
                        color="error"
                        size="small"
                        onClick={() => setCallToDelete(call)}
                        sx={{
                          position: "absolute",
                          right: 12,
                          top: 32,
                          transform: "translateY(-50%)",
                          zIndex: 1,
                        }}
                      >
                        <DeleteOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions
          sx={{ gap: 1, p: 2, flexWrap: "wrap", justifyContent: "flex-end" }}
        >
          <Button
            color="error"
            disabled={calls.length === 0}
            onClick={() => setClearConfirmationOpen(true)}
            startIcon={<DeleteOutlined />}
            variant="outlined"
          >
            Delete all
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Button
            disabled={calls.length === 0}
            onClick={() => exportCalls("json")}
            startIcon={<Download />}
            variant="outlined"
          >
            Export JSON
          </Button>
          <Button
            disabled={calls.length === 0}
            onClick={() => exportCalls("csv")}
            startIcon={<Download />}
            variant="outlined"
          >
            Export CSV
          </Button>
          <Button
            onClick={() => setOpen(false)}
            variant="contained"
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={callToDelete !== null}
        onClose={() => setCallToDelete(null)}
        sx={(theme) => ({ zIndex: theme.zIndex.tooltip + 3 })}
      >
        <DialogTitle>Delete provider call?</DialogTitle>
        <DialogContent>
          <Typography>
            {callToDelete == null
              ? "This provider call will be permanently deleted."
              : `The ${callToDelete.operation} call from ${new Date(
                  callToDelete.startedAt,
                ).toLocaleString()} will be permanently deleted.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCallToDelete(null)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              if (callToDelete != null) onDelete(callToDelete.id);
              setCallToDelete(null);
            }}
            variant="contained"
          >
            Delete call
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={clearConfirmationOpen}
        onClose={() => setClearConfirmationOpen(false)}
        sx={(theme) => ({ zIndex: theme.zIndex.tooltip + 3 })}
      >
        <DialogTitle>Delete all provider calls?</DialogTitle>
        <DialogContent>
          <Typography>
            All AI provider activity recorded for this project will be
            permanently deleted from this browser.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearConfirmationOpen(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              onClear();
              setClearConfirmationOpen(false);
            }}
            variant="contained"
          >
            Delete all
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
