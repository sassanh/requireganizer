import { Build, CheckCircle, Close } from "@mui/icons-material";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";

import { useStore } from "store";

const ProjectConfigDialog: React.FunctionComponent = observer(() => {
  const store = useStore();

  if (store.projectConfig == null) return null;

  return (
    <Dialog
      open={store.isProjectConfigDialogOpen}
      onClose={() => store.setProjectConfigDialogOpen(false)}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        Project Configuration
        <IconButton
          aria-label="Close"
          onClick={() => store.setProjectConfigDialogOpen(false)}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mb: 2
          }}>
          {store.projectConfigLocked
            ? "Scaffold has been generated. Configuration is locked."
            : "Review and fill in all <placeholder> values, then generate the scaffold."}
        </Typography>
        <TextField
          multiline
          fullWidth
          value={store.projectConfig}
          onChange={(e) => store.setProjectConfig(e.target.value)}
          disabled={store.projectConfigLocked || store.isBusy}
          slotProps={{
            input: {
              sx: {
                fontFamily: "monospace",
                fontSize: "0.85rem",
                lineHeight: 1.5,
              },
            },
          }}
          minRows={20}
        />
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        {store.projectConfigLocked ? (
          <Button
            variant="outlined"
            color="success"
            startIcon={<CheckCircle />}
            disabled
          >
            Scaffold Generated
          </Button>
        ) : (
          <Button
            variant="contained"
            color="primary"
            startIcon={<Build />}
            disabled={store.isBusy}
            onClick={() => store.generateScaffold()}
          >
            Generate Scaffold
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});

export default ProjectConfigDialog;
