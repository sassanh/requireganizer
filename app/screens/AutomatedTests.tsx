import { Build, CheckCircle, SyncProblem } from "@mui/icons-material";
import { Alert, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { isAlive } from "mobx-state-tree";

import { GenerationButton } from "components";
import ApprovalMark from "components/ApprovalMark";
import {
  MembershipMotion,
  useMembershipTurns,
} from "components/membershipPresentation";
import { useTestScenariosPresentation } from "components/TestScenarioList";
import { useShownStore } from "presentation";
import { useStore } from "store";
import type { TestCase, TestScenario } from "store/models";

const TestCaseRows = observer(function TestCaseRows({
  scenario,
}: {
  scenario: TestScenario;
}) {
  const store = useStore();
  const liveCases = scenario.testCases.filter((testCase) => isAlive(testCase));
  const { presentedIds, enteringIds, exitingIds, exitHeightFor, seqFor, itemRef } =
    useMembershipTurns(liveCases.map((testCase) => testCase.id));

  return (
    <>
      {presentedIds.map((id, index) => {
        const testCase = liveCases.find((entry) => entry.id === id);
        if (testCase == null) return null;
        return (
          <MembershipMotion
            key={`${id}:${seqFor(id)}:${index}`}
            id={id}
            entering={enteringIds.has(id)}
            exiting={exitingIds.has(id)}
            exitHeight={exitHeightFor(id)}
            itemRef={itemRef}
          >
            <TestCaseRow testCase={testCase} scenario={scenario} busy={store.isBusy} />
          </MembershipMotion>
        );
      })}
    </>
  );
});

function TestCaseRow({
  testCase,
  scenario,
  busy,
}: {
  testCase: TestCase;
  scenario: TestScenario;
  busy: boolean;
}) {
  const store = useStore();
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={1}
      sx={{ alignItems: { md: "center" } }}
    >
      {testCase.testStatus === "generated" ? (
        <CheckCircle color="success" />
      ) : testCase.testStatus === "out-of-sync" ? (
        <SyncProblem color="warning" />
      ) : (
        <Build color="disabled" />
      )}
      <Stack sx={{ flexGrow: 1 }}>
        <Typography>{testCase.title}</Typography>
        <Typography variant="caption" color="text.secondary">
          revision {testCase.revision} · {testCase.definition?.kind}
        </Typography>
      </Stack>
      <ApprovalMark id={testCase.id} />
      <Chip
        size="small"
        label={testCase.testStatus}
        color={
          testCase.testStatus === "generated"
            ? "success"
            : testCase.testStatus === "out-of-sync"
              ? "warning"
              : "default"
        }
      />
      <GenerationButton
        size="small"
        variant="outlined"
        disabled={busy || testCase.approval !== "approved"}
        onGenerate={() => {
          const realScenario = store.testScenarios.find(
            (entry) => entry.id === scenario.id,
          );
          const realCase = realScenario?.testCases.find(
            (entry) => entry.id === testCase.id,
          );
          if (realScenario != null && realCase != null) {
            store.generateTestCode({
              testCase: realCase,
              testScenario: realScenario,
            });
          }
        }}
      >
        {testCase.testStatus === "generated" ? "Regenerate" : "Generate test"}
      </GenerationButton>
    </Stack>
  );
}

const AutomatedTestsView = () => {
  const store = useStore();
  const shown = useShownStore();
  const { presentedIds, enteringIds, exitingIds, exitHeightFor, seqFor, itemRef, live, pictureFor } =
    useTestScenariosPresentation(shown.testScenarios);

  if (store.projectSetup == null || store.isProjectSetupOutdated) {
    return (
      <Alert severity="info">
        A current Project Setup is required before automated tests can be generated.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Each generated file uses the exact scenario, structured trace, contract revisions, harness binding, and manifest-controlled target path.
      </Alert>
      {presentedIds.map((id, index) => {
        const scenario = live.find((entry) => entry.id === id);
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
            <Card variant="outlined">
              <CardContent component={Stack} spacing={1.5}>
                <Typography variant="h6">{picture.content}</Typography>
                {scenario != null && <TestCaseRows scenario={scenario} />}
              </CardContent>
            </Card>
          </MembershipMotion>
        );
      })}
    </Stack>
  );
};

export default observer(AutomatedTestsView);
