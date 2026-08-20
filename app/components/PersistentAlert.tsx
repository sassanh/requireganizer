import { Alert, Snackbar } from "@mui/material";
import type { AlertColor, AlertProps } from "@mui/material";
import type { ReactNode } from "react";

interface PersistentAlertProps {
  severity?: AlertColor;
  onClose?: AlertProps["onClose"];
  children: ReactNode;
}

export default function PersistentAlert({
  severity = "error",
  onClose,
  children,
}: PersistentAlertProps) {
  return (
    <Snackbar
      open
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      sx={{
        bottom: { xs: 16, sm: 24 },
        left: { xs: 16, sm: 24 },
        right: { xs: 16, sm: "auto" },
        maxWidth: { sm: 640 },
      }}
    >
      <Alert
        severity={severity}
        variant="filled"
        onClose={onClose}
        sx={{ width: "100%", alignItems: "flex-start", boxShadow: 6 }}
      >
        {children}
      </Alert>
    </Snackbar>
  );
}
