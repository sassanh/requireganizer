"use client";

import { Chip } from "@mui/material";
import { useState } from "react";

import type { DeskView, RequestState } from "../desk";
import RequestConfirmation from "./RequestConfirmation";

/** Where a sign that an agent is working shows: a unit, a stage, or a module in the list of modules. */
export type WorkingPlace =
  | { kind: "unit"; moduleId: string; unitId: string }
  | { kind: "stage"; moduleId: string; stage: string }
  | { kind: "module"; moduleId: string };

/**
 * The requests agents have that a sign stands for: on a unit, its change
 * request; on a stage, its units' change requests and its requests to
 * write and to review; on a module, every request of the module.
 */
export function requestsAt(view: DeskView, place: WorkingPlace): RequestState[] {
  return view.requests.filter((request) => {
    if (request.holder == null || request.moduleId !== place.moduleId) return false;
    switch (place.kind) {
      case "unit":
        return request.thread?.unitId === place.unitId;
      case "stage":
        return request.stage === place.stage;
      case "module":
        return true;
    }
  });
}

/**
 * Shows that an agent is working, once however many agents are, with a way
 * to stop every request it stands for once the spec owner accepts a
 * confirmation listing them. Nothing shows while no agent is working there.
 */
export default function WorkingSign({ view, place, onStop }: { view: DeskView; place: WorkingPlace; onStop: (keys: string[]) => void }) {
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const requests = requestsAt(view, place);
  if (requests.length === 0 && confirming == null) return null;
  const names = [...new Set(requests.map(({ holder }) => holder!.name))];
  const shown = confirming == null ? [] : view.requests.filter(({ key }) => confirming.includes(key));
  return (
    <>
      {requests.length > 0 && (
        <Chip
          size="small"
          color="primary"
          variant="outlined"
          label={names.length === 1 ? `${names[0]} is working` : "Agents are working"}
          aria-label={`${names.join(", ")} working. Stop`}
          onClick={() => setConfirming(requests.map(({ key }) => key))}
        />
      )}
      <RequestConfirmation
        open={confirming != null}
        action={null}
        requests={shown}
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
