"use client";

import { Alert, Box, Dialog, DialogContent, DialogTitle, Divider, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";

import { getUserFacingErrorMessage } from "lib/errors";

import type { RunLog, RunLogEntry } from "../record";
import { useAgents } from "./context";

const at = (time: string) => new Date(time).toLocaleString();

/** One call or piece of reasoning of a run log. */
function Entry({ entry }: { entry: RunLogEntry }) {
  const block = (text: string, color?: string) => (
    <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: "action.hover", color, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 320, overflowY: "auto" }}>
      {text}
    </Box>
  );
  if (entry.kind === "reasoning") {
    return (
      <Stack spacing={0.5}>
        <Typography variant="caption" color="text.secondary">Reasoning · {at(entry.at)}</Typography>
        {block(entry.text)}
      </Stack>
    );
  }
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">{entry.tool} · {at(entry.at)}</Typography>
      <Typography variant="caption">Sent</Typography>
      {block(JSON.stringify(entry.sent, null, 2))}
      <Typography variant="caption">{entry.refused ? "Refused" : "Got back"}</Typography>
      {block(entry.got, entry.refused ? "error.main" : undefined)}
    </Stack>
  );
}

/**
 * One run log kept with a request: the agent and when it had the request,
 * then every call it made with what it sent and got back, and its
 * reasoning, in the order they happened. Read from the host when opened.
 */
export default function RunLogDialog({ requestKey, index, onClose }: { requestKey: string; index: number; onClose: () => void }) {
  const { client } = useAgents();
  const [log, setLog] = useState<RunLog | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    client.readRunLogs(requestKey).then(
      (logs) => {
        if (current) setLog(logs[index] ?? null);
      },
      (error: unknown) => {
        if (current) setProblem(getUserFacingErrorMessage(error, "The run log could not be read."));
      },
    );
    return () => {
      current = false;
    };
  }, [client, requestKey, index]);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle>{log == null ? "Run log" : `Run log: ${log.agent}, ${at(log.from)} – ${log.until == null ? "has it now" : at(log.until)}`}</DialogTitle>
      <DialogContent dividers>
        {problem != null && <Alert severity="error">{problem}</Alert>}
        {log != null && log.entries.length === 0 && <Typography color="text.secondary">The agent made no call while it had the request.</Typography>}
        {log != null && (
          <Stack spacing={1.5} divider={<Divider flexItem />}>
            {log.entries.map((entry, place) => (
              <Entry key={place} entry={entry} />
            ))}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
