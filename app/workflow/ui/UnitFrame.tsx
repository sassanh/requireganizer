"use client";

import { Check, Comment } from "@mui/icons-material";
import { Box, Button, Chip, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { signerLabel, type SignatureRecord } from "../records";
import { waitsForSpecOwner } from "../threads";
import { NOT_APPROVED_REASON_LABELS, type NotApprovedReason } from "../units";
import { useWorkflowView } from "./context";
import ThreadPanel from "./ThreadPanel";

/** Who gave a signature and when, and whether it still counts. */
export function SignatureLine({ signature, counts, what = "Signed" }: { signature: SignatureRecord | null; counts: boolean; what?: string }) {
  if (signature == null) {
    return <Typography variant="caption" color="text.secondary">Never signed</Typography>;
  }
  return (
    <Typography variant="caption" color={counts ? "text.secondary" : "warning.main"}>
      {what} by {signerLabel(signature.signer)} on {new Date(signature.at).toLocaleString()}
      {counts ? "" : " · no longer counts: what it covered has changed"}
    </Typography>
  );
}

/**
 * The frame every unit of a stage shows in: its approval and every reason
 * it is not approved, its signature, its threads, and the sign and change
 * request actions, reachable from the keyboard while the frame has focus.
 * A reason with a note shows it on hover and on keyboard focus.
 */
const UnitFrame = observer(function UnitFrame({
  unitId,
  title,
  approved,
  reasons,
  reasonNotes = {},
  signable,
  signLabel = "Sign",
  stageOpen,
  composing,
  onComposingChange,
  onSign,
  actions,
  children,
}: {
  unitId: string;
  title: ReactNode;
  approved: boolean;
  reasons: readonly NotApprovedReason[];
  reasonNotes?: Partial<Record<NotApprovedReason, ReactNode>>;
  signable: boolean;
  signLabel?: string;
  stageOpen: boolean;
  composing: boolean;
  onComposingChange: (composing: boolean) => void;
  onSign: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { module } = useWorkflowView();
  const threads = module.threadsOf(unitId);
  const open = threads.find(({ resolvedAt }) => resolvedAt == null);
  const waitsForYou = open != null && waitsForSpecOwner(open);
  return (
    <Paper
      variant="outlined"
      tabIndex={0}
      data-unit-card={unitId}
      sx={{
        p: 1.5,
        borderLeft: 4,
        borderLeftColor: approved ? "success.main" : "warning.main",
        outline: "none",
        "&:focus-visible, &:focus-within": { boxShadow: (theme) => `0 0 0 2px ${theme.vars.palette.primary.main}` },
      }}
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>{title}</Box>
        {waitsForYou && <Chip size="small" color="warning" label="Thread waits for you" />}
        {approved ? (
          <Chip size="small" color="success" icon={<Check />} label="Approved" />
        ) : (
          reasons.map((reason) => {
            const chip = <Chip key={reason} size="small" variant="outlined" color="warning" label={NOT_APPROVED_REASON_LABELS[reason]} tabIndex={reasonNotes[reason] == null ? undefined : 0} />;
            return reasonNotes[reason] == null ? chip : <Tooltip key={reason} title={reasonNotes[reason]} describeChild>{chip}</Tooltip>;
          })
        )}
      </Stack>
      <Box sx={{ mt: 1 }}>{children}</Box>
      <Stack data-unit-actions direction="row" sx={{ alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
        {signable && (
          <Button size="small" variant="contained" startIcon={<Check />} onClick={onSign} title="Sign (S)">
            {signLabel}
          </Button>
        )}
        {stageOpen && open == null && (
          <Button size="small" startIcon={<Comment />} onClick={() => onComposingChange(true)} title="Request a change (C)">
            Request a change
          </Button>
        )}
        {actions}
      </Stack>
      <ThreadPanel unitId={unitId} threads={threads} stageOpen={stageOpen} composing={composing} onComposingChange={onComposingChange} />
    </Paper>
  );
});

export default UnitFrame;
