"use client";

import { Chip } from "@mui/material";
import { useState } from "react";

import type { DeskView, WaitingThreadState } from "../desk";
import StopConfirmation from "./StopConfirmation";

/** Where a sign that an agent is working shows: a unit, a stage, or a module in the list of modules. */
export type WorkingPlace =
  | { kind: "unit"; moduleId: string; unitId: string }
  | { kind: "stage"; moduleId: string; stage: string }
  | { kind: "module"; moduleId: string };

/**
 * The threads agents have that a sign stands for: on a unit, its thread; on
 * a stage, the threads on it and on its units, those asking to write and to
 * review it among them; on a module, every thread of the module.
 */
export function heldAt(view: DeskView, place: WorkingPlace): WaitingThreadState[] {
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
 * Shows that an agent is working, once however many agents are, with a way
 * to stop every agent working on the threads it stands for once the spec
 * owner accepts a confirmation listing them. Nothing shows while no agent is
 * working there.
 */
export default function WorkingSign({ view, place, onStop }: { view: DeskView; place: WorkingPlace; onStop: (keys: string[]) => void }) {
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const held = heldAt(view, place);
  if (held.length === 0 && confirming == null) return null;
  const names = [...new Set(held.map(({ holder }) => holder!.name))];
  const shown = confirming == null ? [] : view.waiting.filter(({ key }) => confirming.includes(key));
  return (
    <>
      {held.length > 0 && (
        <Chip
          size="small"
          color="primary"
          variant="outlined"
          label={names.length === 1 ? `${names[0]} is working` : "Agents are working"}
          aria-label={`${names.join(", ")} working. Stop`}
          onClick={() => setConfirming(held.map(({ key }) => key))}
        />
      )}
      <StopConfirmation
        open={confirming != null}
        action={null}
        threads={shown}
        onGiveUp={() => setConfirming(null)}
        onStopAndCarryOut={(keys) => {
          setConfirming(null);
          onStop(keys);
        }}
        onCarryOut={() => setConfirming(null)}
      />
    </>
  );
}
