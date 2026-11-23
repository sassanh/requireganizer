"use client";

import { ExpandMore } from "@mui/icons-material";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Dialog, DialogContent, DialogTitle, Divider, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";

import { getUserFacingErrorMessage } from "lib/errors";

import type { AgentId, ContextPart } from "../record";
import { agentLabel } from "../view";
import { useAgents } from "./context";

const at = (time: string) => new Date(time).toLocaleString();

function Block({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <Box
      component="pre"
      sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: "action.hover", color: error ? "error.main" : undefined, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 320, overflowY: "auto" }}
    >
      {text}
    </Box>
  );
}

type Shown = { heading: string; text: string; error?: boolean };

/** What one message of the context shows: what the agent was asked, what it reasoned, said and called, and what each call got back. */
function shownOf(message: unknown): Shown[] {
  if (message == null || typeof message !== "object") return [];
  const { role, content, toolName, isError, errorMessage } = message as Record<string, unknown>;
  const blocks = Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
  const texts = typeof content === "string" ? content : blocks.flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : [])).join("\n\n");
  switch (role) {
    case "user":
      return [{ heading: "Asked", text: texts }];
    case "toolResult":
      return [{ heading: `${String(toolName)} ${isError === true ? "refused" : "got back"}`, text: texts, error: isError === true }];
    case "assistant":
      return [
        ...blocks.flatMap((block): Shown[] => {
          if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim().length > 0) return [{ heading: "Reasoned", text: block.thinking }];
          if (block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0) return [{ heading: "Said", text: block.text }];
          if (block.type === "toolCall") return [{ heading: `Called ${String(block.name)}`, text: JSON.stringify(block.arguments, null, 2) }];
          return [];
        }),
        ...(typeof errorMessage === "string" ? [{ heading: "The AI provider failed", text: errorMessage, error: true }] : []),
      ];
    default:
      return [];
  }
}

function PartMessages({ part }: { part: ContextPart }) {
  const shown = part.messages.flatMap(shownOf);
  if (shown.length === 0) return <Typography color="text.secondary">Nothing yet.</Typography>;
  return (
    <Stack spacing={1.5} divider={<Divider flexItem />}>
      {shown.map((entry, index) => (
        <Stack key={index} spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            {entry.heading}
          </Typography>
          <Block text={entry.text} error={entry.error} />
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * An internal agent's context: each run, what it was about and when, with
 * what the agent was asked, reasoned, said and called and what each call got
 * back. The runs about `topic` open; the others stay folded.
 */
export default function ContextDialog({ agentId, topic, onClose }: { agentId: AgentId; topic: string | null; onClose: () => void }) {
  const { client, view } = useAgents();
  const [parts, setParts] = useState<ContextPart[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    client.readContext(agentId).then(
      (read) => {
        if (current) setParts(read);
      },
      (error: unknown) => {
        if (current) setProblem(getUserFacingErrorMessage(error, "The context could not be read."));
      },
    );
    return () => {
      current = false;
    };
  }, [client, agentId]);
  const agent = view.agents.find(({ id }) => id === agentId);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle>Context of {agent == null ? "an agent" : agentLabel(agent)}</DialogTitle>
      <DialogContent dividers>
        {problem != null && <Alert severity="error">{problem}</Alert>}
        {parts != null && parts.length === 0 && <Typography color="text.secondary">The agent has done nothing yet.</Typography>}
        {parts?.map((part, index) => (
          <Accordion key={index} defaultExpanded={topic == null ? index === parts.length - 1 : part.topic.key === topic} disableGutters>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="body2">
                {part.topic.label} · {at(part.from)} – {part.until == null ? "running" : at(part.until)}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <PartMessages part={part} />
            </AccordionDetails>
          </Accordion>
        ))}
      </DialogContent>
    </Dialog>
  );
}
