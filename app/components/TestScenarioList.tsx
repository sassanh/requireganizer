import { Alert, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";
import { useRef } from "react";

import type { TestScenario } from "store/models";

import ApprovalMark from "./ApprovalMark";
import {
  MembershipMotion,
  useMembershipTurns,
} from "./membershipPresentation";

type ScenarioPicture = {
  id: string;
  content: string;
  description: string;
  bindingKind: string;
  priority: string;
  bindingDetail: string;
};

function pictureFromSnapshot(snapshot: unknown): ScenarioPicture | null {
  if (snapshot == null || typeof snapshot !== "object") return null;
  const record = snapshot as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  if (id === "") return null;
  const binding =
    record.binding != null && typeof record.binding === "object"
      ? (record.binding as Record<string, unknown>)
      : null;
  const kind = typeof binding?.kind === "string" ? binding.kind : "unbound";
  let bindingDetail = "No binding";
  if (binding?.kind === "behavioral") {
    const interfaces = Array.isArray(binding.interfaceIds)
      ? binding.interfaceIds.length
      : 0;
    bindingDetail = `Subject ${String(binding.subjectId ?? "")} · ${interfaces} interface(s)`;
  } else if (binding?.kind === "verification") {
    bindingDetail = `Verification obligation ${String(binding.verificationObligationId ?? "")}`;
  }
  return {
    id,
    content: typeof record.content === "string" ? record.content : "",
    description:
      typeof record.description === "string" ? record.description : "",
    bindingKind: kind,
    priority: typeof record.priority === "string" ? record.priority : "",
    bindingDetail,
  };
}

function pictureFromLive(scenario: TestScenario): ScenarioPicture {
  return (
    pictureFromSnapshot({
      id: scenario.id,
      content: scenario.content,
      description: scenario.description,
      binding: scenario.binding,
      priority: scenario.priority,
    }) ?? {
      id: scenario.id,
      content: scenario.content,
      description: scenario.description,
      bindingKind: "unbound",
      priority: scenario.priority ?? "",
      bindingDetail: "No binding",
    }
  );
}

function ScenarioCard({
  picture,
  liveId,
}: {
  picture: ScenarioPicture;
  liveId?: string;
}) {
  return (
    <Card variant="outlined">
      <CardContent component={Stack} spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {picture.content}
          </Typography>
          <Chip size="small" label={picture.bindingKind} />
          <Chip size="small" label={picture.priority || "unprioritized"} />
          {liveId != null ? <ApprovalMark id={liveId} /> : null}
        </Stack>
        <Typography>{picture.description}</Typography>
        <Typography variant="caption" color="text.secondary">
          {picture.bindingDetail}
        </Typography>
      </CardContent>
    </Card>
  );
}

export function useTestScenariosPresentation(scenarios: TestScenario[]) {
  const picturesRef = useRef(new Map<string, ScenarioPicture>());
  const live = scenarios.filter((scenario) => isAlive(scenario));
  const liveIds = live.map((scenario) => scenario.id);
  for (const scenario of live) {
    // eslint-disable-next-line react-hooks/refs -- cache pictures for exiting animation before membership diff
    picturesRef.current.set(scenario.id, pictureFromLive(scenario));
  }
  const membership = useMembershipTurns(liveIds);
  const pictureFor = (id: string): ScenarioPicture | undefined => {
    const scenario = live.find((entry) => entry.id === id);
    if (scenario != null) return pictureFromLive(scenario);
    return picturesRef.current.get(id);
  };
  return { ...membership, live, liveIds, pictureFor };
}

export default observer(function TestScenarioList({
  scenarios,
}: {
  scenarios: TestScenario[];
}) {
  const { presentedIds, enteringIds, exitingIds, exitHeightFor, seqFor, itemRef, liveIds, pictureFor } =
    useTestScenariosPresentation(scenarios);

  return (
    <Stack spacing={1.5}>
      {presentedIds.length === 0 && liveIds.length === 0 && (
        <Alert severity="info">
          Generate scenarios from the approved contract suite.
        </Alert>
      )}
      {presentedIds.map((id, index) => {
        const picture = pictureFor(id);
        if (picture == null) return null;
        return (
          <MembershipMotion
            key={`${id}:${seqFor(id)}:${index}`}
            id={id}
            entering={enteringIds.has(id)}
            exiting={exitingIds.has(id)}
            exitHeight={exitHeightFor(id)}
            itemRef={itemRef}
          >
            <ScenarioCard
              picture={picture}
              liveId={liveIds.includes(id) ? id : undefined}
            />
          </MembershipMotion>
        );
      })}
    </Stack>
  );
});
