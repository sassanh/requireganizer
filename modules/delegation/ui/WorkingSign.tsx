"use client";

import { Chip } from "@mui/material";
import { useState } from "react";

import { attempt } from "components/notices";

import type { DelegationView, WaitingView } from "../host";
import Confirmation from "./Confirmation";
import { useDelegation } from "./context";

/** Where an agent work sign shows: a unit, a stage, or a module in the list of modules. */
export type WorkingPlace =
  | { kind: "unit"; moduleId: string; unitId: string }
  | { kind: "stage"; moduleId: string; stage: string }
  | { kind: "module"; moduleId: string };

/**
 * The threads agents have that a sign stands for: on a unit, its thread; on
 * a stage, the threads on it and on its units; on a module, every thread of
 * the module.
 */
export function heldAt(view: DelegationView, place: WorkingPlace): WaitingView[] {
  return view.waiting.filter((waiting) => {
    if (waiting.holder == null || waiting.moduleId !== place.moduleId) return false;
    switch (place.kind) {
      case "unit":
        return waiting.thread.unitId === place.unitId;
      case "stage":
        return waiting.stage === place.stage;
      case "module":
        return true;
    }
  });
}

/**
 * The one agent work sign, however many agents are working where it shows,
 * with a way to stop the agents on all the threads it stands for once the
 * spec owner confirms. Nothing shows while no agent is working there.
 */
export default function WorkingSign({ place }: { place: WorkingPlace }) {
  const { client, view } = useDelegation();
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const held = heldAt(view, place);
  if (held.length === 0 && confirming == null) return null;
  return (
    <>
      {held.length > 0 && (
        <Chip
          size="small"
          color="primary"
          variant="outlined"
          label={new Set(held.map(({ holder }) => holder!.agentId)).size === 1 ? "An agent is working" : "Agents are working"}
          aria-label="Agents are working here. Stop them"
          onClick={() => setConfirming(held.map(({ key }) => key))}
        />
      )}
      {confirming != null && (
        <Confirmation
          action={null}
          threads={view.waiting.filter(({ key }) => confirming.includes(key))}
          onGiveUp={() => setConfirming(null)}
          onCarryOut={(keys) => {
            setConfirming(null);
            attempt(() => client.stopAgents(keys), "The agents could not be stopped.");
          }}
        />
      )}
    </>
  );
}

/** The agent work sign of a module, in the list of modules or beside its name. */
export function ModuleWorkingSign({ moduleId }: { moduleId: string }) {
  return <WorkingSign place={{ kind: "module", moduleId }} />;
}
