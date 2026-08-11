import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
} from "@mui/material";
import { useState } from "react";

interface ValidationErrorAlertProps {
  message: string;
  details: string | null;
  onClose: () => void;
}

export default function ValidationErrorAlert({
  message,
  details,
  onClose,
}: ValidationErrorAlertProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canShowDetails =
    process.env.NODE_ENV === "development" && details != null;

  return (
    <>
      <Alert severity="error" onClose={onClose} sx={{ mb: 2 }}>
        <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
          <span>{message}</span>
          {canShowDetails && (
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={() => setDetailsOpen(true)}
            >
              More details
            </Button>
          )}
        </Stack>
      </Alert>

      {canShowDetails && detailsOpen && (
        <Dialog
          fullWidth
          maxWidth="lg"
          open
          onClose={() => setDetailsOpen(false)}
        >
          <DialogTitle>AI error details</DialogTitle>
          <DialogContent dividers>
            <Box
              component="pre"
              sx={{
                m: 0,
                maxHeight: "70vh",
                overflow: "auto",
                overflowWrap: "anywhere",
                whiteSpace: "pre-wrap",
                fontFamily: "monospace",
                fontSize: "0.8rem",
              }}
            >
              {details}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDetailsOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
