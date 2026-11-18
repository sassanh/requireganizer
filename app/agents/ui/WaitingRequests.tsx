"use client";

import { Button, List, ListItem, ListItemText, Menu, MenuItem, Stack, Typography } from "@mui/material";
import { useState } from "react";

import type { DeskView, RequestState } from "../desk";
import type { AgentId } from "../roster";
import { howLongAgo } from "./time";

/** That a request waits, and which agent has it or that none does, as a thread or a stage shows it. */
export function requestStatus(request: RequestState): string {
  return request.holder == null ? "Waits · no agent has it" : `Waits · ${request.holder.name} has it`;
}

/** Give one request to an agent of the spec owner's choice, from those it can go to now. */
function GiveButton({
  request,
  view,
  stageLabel,
  onGive,
}: {
  request: RequestState;
  view: DeskView;
  stageLabel: string;
  onGive: (key: string, agentId: AgentId) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const agents = view.agents.filter(({ id }) => request.givableTo.includes(id));
  if (request.holder == null && !request.stageOpen) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
        Can be given once {stageLabel} opens
      </Typography>
    );
  }
  if (agents.length === 0) return null;
  return (
    <>
      <Button size="small" aria-haspopup="menu" onClick={(event) => setAnchor(event.currentTarget)}>
        Give to…
      </Button>
      <Menu anchorEl={anchor} open={anchor != null} onClose={() => setAnchor(null)}>
        {agents.map((agent) => (
          <MenuItem
            key={agent.id}
            onClick={() => {
              setAnchor(null);
              onGive(request.key, agent.id);
            }}
          >
            {agent.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/**
 * Every waiting request of every module in one list, each with its module
 * and stage, its unit for a change request, when it was made, and which
 * agent has it and since when or that none does, with why the agent it was
 * last given to failed; and the ways to give, stop and withdraw it.
 */
export default function WaitingRequests({
  view,
  stageLabel,
  onGive,
  onStop,
  onWithdraw,
}: {
  view: DeskView;
  /** A stage's label in a module. */
  stageLabel: (moduleId: string, stage: string) => string;
  onGive: (key: string, agentId: AgentId) => void;
  onStop: (key: string) => void;
  /** Withdraw a request no agent has; without it the list offers no withdrawing. */
  onWithdraw?: (key: string) => void;
}) {
  if (view.requests.length === 0) return <Typography color="text.secondary">No request waits.</Typography>;
  return (
    <List aria-label="Waiting requests">
      {view.requests.map((request) => {
        const where = [request.moduleName, stageLabel(request.moduleId, request.stage)].filter((part) => part != null).join(", ");
        const holder = request.holder == null ? "No agent has it" : `${request.holder.name} has it since ${howLongAgo(request.holder.since)}`;
        return (
          <ListItem key={request.key} divider alignItems="flex-start">
            <ListItemText
              primary={request.summary}
              secondary={
                <>
                  {`${where} · made ${howLongAgo(request.madeAt)} · ${holder}`}
                  {request.failure == null ? null : <Typography component="span" variant="body2" color="error" sx={{ display: "block" }}>{request.failure}</Typography>}
                </>
              }
            />
            <Stack direction="row" sx={{ gap: 0.5, flexShrink: 0 }}>
              <GiveButton request={request} view={view} stageLabel={stageLabel(request.moduleId, request.stage)} onGive={onGive} />
              {request.holder != null ? (
                <Button size="small" onClick={() => onStop(request.key)}>
                  Stop
                </Button>
              ) : onWithdraw == null ? null : (
                <Button size="small" color="error" onClick={() => onWithdraw(request.key)}>
                  Withdraw
                </Button>
              )}
            </Stack>
          </ListItem>
        );
      })}
    </List>
  );
}
