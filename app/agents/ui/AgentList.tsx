"use client";

import { Add, Delete, Edit } from "@mui/icons-material";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemText, Stack, TextField, Typography } from "@mui/material";
import { type FormEvent, useState } from "react";

import type { RunAgent } from "../internal/runAgents";
import type { AgentId, AgentView } from "../roster";

type RunAgentDraft = Omit<RunAgent, "id">;

/** The actions on agents the spec owner takes; each rejects with what is wrong, such as a name another agent has. */
export interface AgentActions {
  nameCodingAgent: (agentId: AgentId, name: string) => Promise<void>;
  addRunAgent: (agent: RunAgentDraft) => Promise<void>;
  changeRunAgent: (agentId: AgentId, agent: RunAgentDraft) => Promise<void>;
  removeRunAgent: (agentId: AgentId) => Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One field form, submitted with Enter, that names a connected coding agent that has no name. */
function NameField({ agentId, onName }: { agentId: AgentId; onName: AgentActions["nameCodingAgent"] }) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onName(agentId, name).then(() => setName(""), (error: unknown) => setProblem(errorText(error)));
  };
  return (
    <Stack component="form" direction="row" onSubmit={submit} sx={{ gap: 1, alignItems: "flex-start" }}>
      <TextField size="small" label="Name it" value={name} onChange={(event) => setName(event.target.value)} error={problem != null} helperText={problem} />
      <Button type="submit" size="small">
        Name
      </Button>
    </Stack>
  );
}

/** Adds or changes an agent Requireganizer runs: its name, its AI provider and its model. */
function RunAgentDialog({
  initial,
  onSave,
  onClose,
}: {
  /** The agent changed, or null to add one. */
  initial: (AgentView & { kind: "run" }) | null;
  onSave: (agent: RunAgentDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initial?.model ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ name, model, provider: { baseUrl, apiKey } }).then(onClose, (error: unknown) => setProblem(errorText(error)));
  };
  return (
    <Dialog open onClose={onClose} aria-labelledby="run-agent-title" fullWidth maxWidth="sm">
      <form onSubmit={submit}>
        <DialogTitle id="run-agent-title">{initial == null ? "Add an agent" : `Change ${initial.name}`}</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            <TextField autoFocus label="Name" value={name} onChange={(event) => setName(event.target.value)} required />
            <TextField label="AI provider address" placeholder="https://openrouter.ai/api/v1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
            <TextField label="API key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} helperText={initial == null ? undefined : "Leave empty to keep the one it has."} />
            <TextField label="Model" value={model} onChange={(event) => setModel(event.target.value)} required />
            {problem != null && <Typography color="error" variant="body2" sx={{ whiteSpace: "pre-line" }}>{problem}</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            {initial == null ? "Add" : "Save"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/**
 * Every agent: each available agent by its name and each connected coding
 * agent that has no name as unnamed, with a way to name it; and the agents
 * Requireganizer runs, to add, change and remove.
 */
export default function AgentList({ agents, actions }: { agents: readonly AgentView[]; actions: AgentActions }) {
  const [editing, setEditing] = useState<(AgentView & { kind: "run" }) | "new" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Stack sx={{ gap: 1 }}>
      <List dense aria-label="Agents">
        {agents.length === 0 && <ListItem><ListItemText secondary="No agent is available. Add one, or connect a coding agent." /></ListItem>}
        {agents.map((agent) => (
          <ListItem
            key={agent.id}
            secondaryAction={
              agent.kind === "run" ? (
                <>
                  <IconButton size="small" aria-label={`Change ${agent.name}`} onClick={() => setEditing(agent)}>
                    <Edit fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label={`Remove ${agent.name}`} onClick={() => actions.removeRunAgent(agent.id).catch((error: unknown) => setProblem(errorText(error)))}>
                    <Delete fontSize="small" />
                  </IconButton>
                </>
              ) : undefined
            }
          >
            {agent.kind === "coding" && agent.name == null ? (
              <Stack sx={{ gap: 0.5 }}>
                <Typography variant="body2">Unnamed coding agent</Typography>
                <NameField agentId={agent.id} onName={actions.nameCodingAgent} />
              </Stack>
            ) : (
              <ListItemText primary={agent.name} secondary={agent.kind === "run" ? `${agent.model} · ${agent.provider}` : "Coding agent"} />
            )}
          </ListItem>
        ))}
      </List>
      {problem != null && <Typography color="error" variant="body2">{problem}</Typography>}
      <Button size="small" startIcon={<Add />} sx={{ alignSelf: "flex-start" }} onClick={() => setEditing("new")}>
        Add an agent
      </Button>
      {editing != null && (
        <RunAgentDialog
          initial={editing === "new" ? null : editing}
          onSave={(agent) => (editing === "new" ? actions.addRunAgent(agent) : actions.changeRunAgent(editing.id, agent))}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
