import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";

import type { ModelVerdict } from "contract-domain";

/**
 * A person's action contradicts the reviewer model's verdict on the same
 * state: neither side wins by default, so the person decides here with the
 * model's reason in view.
 */
export function DecisionDialog({
  verdict,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  verdict: ModelVerdict | null;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={verdict != null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {verdict?.verdict === "reject"
          ? "The reviewer model recommends a change"
          : "The reviewer model approved this"}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>{verdict?.reason}</DialogContentText>
        <DialogContentText variant="caption">{verdict?.model}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
