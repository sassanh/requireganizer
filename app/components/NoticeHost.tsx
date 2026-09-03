import { Alert, Snackbar } from "@mui/material";
import { useEffect, useRef, useState } from "react";

import { subscribeNotices, type Notice } from "./notices";

const NOTICE_MILLISECONDS = 2500;
/** Snackbar exit fade length: the queue advances only after it finishes. */
const EXIT_MILLISECONDS = 200;

/**
 * The single host for transient action confirmations. Queues notices and
 * shows each for a short hold; the leaving toast keeps its content until
 * the fade finishes, and a notice landing mid-fade replaces it.
 */
export function NoticeHost() {
  const [queue, setQueue] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeNotices((notice) => {
      if (closeTimer.current != null) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      setQueue((current) =>
        openRef.current ? [...current, notice] : [notice],
      );
      openRef.current = true;
      setOpen(true);
    });
    return () => {
      unsubscribe();
      if (closeTimer.current != null) clearTimeout(closeTimer.current);
    };
  }, []);

  const dismiss = () => {
    openRef.current = false;
    setOpen(false);
    if (closeTimer.current != null) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setQueue((current) => current.slice(1));
      setOpen(true);
    }, EXIT_MILLISECONDS);
  };

  const current = queue[0] ?? null;
  return (
    <Snackbar
      open={open && current != null}
      autoHideDuration={NOTICE_MILLISECONDS}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      onClose={dismiss}
    >
      <Alert
        severity={current?.severity ?? "success"}
        variant="filled"
        sx={{ width: "100%" }}
      >
        {current?.message ?? ""}
      </Alert>
    </Snackbar>
  );
}
