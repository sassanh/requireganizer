import { Alert, Box, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";

import { artifactElementId, CodeBlock } from "components";
import { jsonEqual, useStagedContent } from "components/changeQueue";
import { useShownStore } from "presentation";
import { useStore } from "store";

const ProjectSetupView = () => {
  const store = useStore();
  const shown = useShownStore();
  const setup = useStagedContent(
    "projectSetup",
    artifactElementId("projectSetup"),
    shown.projectSetup,
    jsonEqual,
  );
  useStagedContent(
    "scaffoldFiles",
    artifactElementId("scaffoldFiles"),
    shown.scaffoldFiles,
    jsonEqual,
  );
  if (setup == null) {
    return <Alert severity="info">Generate Project Setup after every scenario has structured test cases.</Alert>;
  }
  return (
    <Stack spacing={3} id={artifactElementId("projectSetup")}>
      {store.isProjectSetupOutdated && <Alert severity="warning">This setup is bound to stale upstream revisions and cannot be used for test generation.</Alert>}
      <Card variant="outlined">
        <CardContent component={Stack} spacing={1}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="h5">Build configuration</Typography>
            <Chip label={`revision ${setup.revision}`} />
          </Stack>
          <Typography><strong>Package manager:</strong> {setup.configuration.packageManager}</Typography>
          <Typography><strong>Test framework:</strong> {setup.configuration.testFramework}</Typography>
          <Typography><strong>Build:</strong> <code>{setup.configuration.buildCommand}</code></Typography>
          <Typography><strong>Test:</strong> <code>{setup.configuration.testCommand}</code></Typography>
        </CardContent>
      </Card>
      <Box id={artifactElementId("scaffoldFiles")}>
        <Typography variant="h5">Validated scaffold manifest</Typography>
        <CodeBlock code={JSON.stringify(setup.manifest, null, 2)} language="json" />
        <Alert severity="success">
          {setup.files.length} scaffold files include hash-verified approved contracts and unimplemented product seams. Application behavior is not fabricated.
        </Alert>
      </Box>
    </Stack>
  );
};

export default observer(ProjectSetupView);
