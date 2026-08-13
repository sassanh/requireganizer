import { Build, CheckCircle, SyncProblem } from "@mui/icons-material";
import { Alert, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";

import { GenerationButton } from "components";
import { useStore } from "store";

const AutomatedTestsView = () => {
  const store = useStore();
  if (store.projectSetup == null || store.isProjectSetupOutdated) {
    return <Alert severity="info">A current Project Setup is required before automated tests can be generated.</Alert>;
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info">Each generated file uses the exact scenario, structured trace, contract revisions, harness binding, and manifest-controlled target path.</Alert>
      {store.testScenarios.map((scenario) => (
        <Card key={scenario.id} variant="outlined">
          <CardContent component={Stack} spacing={1.5}>
            <Typography variant="h6">{scenario.content}</Typography>
            {scenario.testCases.map((testCase) => (
              <Stack key={testCase.id} direction={{ xs: "column", md: "row" }} spacing={1} sx={{ alignItems: { md: "center" } }}>
                {testCase.testStatus === "generated" ? <CheckCircle color="success" /> : testCase.testStatus === "out-of-sync" ? <SyncProblem color="warning" /> : <Build color="disabled" />}
                <Stack sx={{ flexGrow: 1 }}>
                  <Typography>{testCase.title}</Typography>
                  <Typography variant="caption" color="text.secondary">revision {testCase.revision} · {testCase.definition?.kind}</Typography>
                </Stack>
                <Chip size="small" label={testCase.testStatus} color={testCase.testStatus === "generated" ? "success" : testCase.testStatus === "out-of-sync" ? "warning" : "default"} />
                <GenerationButton
                  size="small"
                  variant="outlined"
                  disabled={store.isBusy}
                  onGenerate={() => store.generateTestCode({ testCase, testScenario: scenario })}
                >
                  {testCase.testStatus === "generated" ? "Regenerate" : "Generate test"}
                </GenerationButton>
              </Stack>
            ))}
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
};

export default observer(AutomatedTestsView);
