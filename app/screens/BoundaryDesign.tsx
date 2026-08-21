import {
  Alert,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";

import { useStore } from "store";

const BoundaryDesignView = () => {
  const store = useStore();
  const design = store.boundaryDesign;

  if (design == null) {
    return <Alert severity="info">Generate a boundary design to define test subjects, interfaces, interactions, and acceptance coverage.</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={2}>
        <Typography variant="h5">Test subjects</Typography>
        {design.subjects.map((subject) => (
          <Card key={subject.id} variant="outlined">
            <CardContent component={Stack} spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Chip size="small" label={subject.classification} />
                {subject.id === design.rootSubjectId && <Chip size="small" color="primary" label="root product" />}
                <Typography variant="caption" color="text.secondary">{subject.id}</Typography>
              </Stack>
              <TextField
                label="Name"
                value={subject.name}
                disabled={store.isBusy}
                onChange={(event) => store.updateBoundaryText("subjects", subject.id, "name", event.target.value)}
              />
              <TextField
                label="Purpose"
                multiline
                value={subject.purpose}
                disabled={store.isBusy}
                onChange={(event) => store.updateBoundaryText("subjects", subject.id, "purpose", event.target.value)}
              />
              <Typography variant="body2"><strong>Responsibilities:</strong> {subject.responsibilities.join(" · ")}</Typography>
              <Typography variant="body2"><strong>Exclusions:</strong> {subject.exclusions.join(" · ") || "None declared"}</Typography>
              <Typography variant="body2"><strong>Lifecycle:</strong> Fresh/reset subject for every case</Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Stack spacing={2}>
        <Typography variant="h5">Interfaces and interactions</Typography>
        {design.interfaces.map((semanticInterface) => (
          <Card key={semanticInterface.id} variant="outlined">
            <CardContent component={Stack} spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                <Chip label={semanticInterface.visibility} size="small" />
                <Chip label={semanticInterface.direction} size="small" />
                <Chip label={semanticInterface.interactionStyle} size="small" />
                <Typography variant="caption" color="text.secondary">{semanticInterface.id}</Typography>
              </Stack>
              <TextField
                label="Interface name"
                value={semanticInterface.name}
                disabled={store.isBusy}
                onChange={(event) => store.updateBoundaryText("interfaces", semanticInterface.id, "name", event.target.value)}
              />
              <Typography color="text.secondary">Peer: {semanticInterface.peer}</Typography>
              <Divider />
              {design.interactions
                .filter(({ interfaceId }) => interfaceId === semanticInterface.id)
                .map((interaction) => (
                  <Stack key={interaction.id} spacing={0.5}>
                    <Typography variant="subtitle1">{interaction.name}</Typography>
                    <Typography>{interaction.intent}</Typography>
                    <Typography variant="body2"><strong>Input:</strong> {interaction.inputDescription}</Typography>
                    <Typography variant="body2"><strong>Output:</strong> {interaction.outputDescription}</Typography>
                    <Typography variant="caption" color="text.secondary">{interaction.id}</Typography>
                  </Stack>
                ))}
            </CardContent>
          </Card>
        ))}
      </Stack>

      {design.verificationObligations.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h5">Verification obligations</Typography>
          {design.verificationObligations.map((obligation) => (
            <Alert key={obligation.id} icon={false} severity="info">
              <strong>{obligation.name}</strong> ({obligation.kind}) — {obligation.description}
            </Alert>
          ))}
        </Stack>
      )}

      <Alert severity="success">
        {new Set(design.coverage.map(({ acceptanceCriteriaId }) => acceptanceCriteriaId)).size} acceptance criteria have explicit coverage.
      </Alert>
    </Stack>
  );
};

export default observer(BoundaryDesignView);
