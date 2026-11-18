"use client";

import { Check, Comment } from "@mui/icons-material";
import { Box, Button, Chip, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, useRef } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { signShortcut, threadShortcut } from "actions/actions";

import { signerLabel, type SignatureRecord } from "../records";
import { waitsForSpecOwner } from "../threads";
import { NOT_APPROVED_REASON_LABELS, type NotApprovedReason } from "../units";
import { useWorkflowView } from "./context";
import { FRAME_PLACEHOLDER_HEIGHT, useFrameContentShown } from "./frameSchedule";
import { Slot } from "./slots";
import { THREAD_BUTTON } from "./ThreadView";

/** Who gave a signature and when, and whether it still counts. */
export function SignatureLine({ signature, counts, what = "Signed" }: { signature: SignatureRecord | null; counts: boolean; what?: string }) {
  if (signature == null) {
    return <Typography variant="caption" color="text.secondary">Never signed</Typography>;
  }
  return (
    <Typography variant="caption" color={counts ? "text.secondary" : "warning.main"}>
      {what} by {signerLabel(signature.signer)}{signature.at == null ? "" : ` on ${new Date(signature.at).toLocaleString()}`}
      {counts ? "" : " · no longer counts: what it covered has changed"}
    </Typography>
  );
}

/**
 * The frame every unit of a stage shows in: its approval and every reason
 * it is not approved, its signature, and the sign and thread actions,
 * reachable from the keyboard while the frame has focus. The thread opens
 * outside the frame, so new messages never change the frame's height.
 * A reason with a note shows it on hover and on keyboard focus. In a
 * preview, the frame says what bringing its state back would do to the
 * unit, and offers no signing. In a stage of many units the frame is there
 * from the start, to focus and to scroll to, and shows its content when the
 * stage's schedule says so.
 */
const UnitFrame = observer(function UnitFrame({
  unitId,
  title,
  labels,
  approved,
  reasons,
  reasonNotes = {},
  signable,
  signLabel = "Sign",
  stageOpen,
  onOpenThread,
  onSign,
  actions,
  children,
}: {
  unitId: string;
  title: ReactNode;
  /** Chips about the unit itself, such as its priority, shown before its approval. */
  labels?: ReactNode;
  approved: boolean;
  reasons: readonly NotApprovedReason[];
  reasonNotes?: Partial<Record<NotApprovedReason, ReactNode>>;
  signable: boolean;
  signLabel?: string;
  stageOpen: boolean;
  /** Opens the unit's threads beside the given element. */
  onOpenThread: (anchor: HTMLElement) => void;
  onSign: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { module, preview } = useWorkflowView();
  const frame = useRef<HTMLDivElement>(null);
  const contentShown = useFrameContentShown(unitId, frame);
  const mark = preview?.of(unitId) ?? null;
  const threads = module.threadsOf(unitId);
  const open = threads.find(({ resolution }) => resolution == null);
  const waitsForYou = open != null && waitsForSpecOwner(open);
  const threadTitle = open == null ? "" : waitsForYou ? "Waits for you" : "Open thread";
  const threadLabel = threads.length > 0 ? "Thread" : "Request a change";
  return (
    <Paper
      ref={frame}
      variant="outlined"
      tabIndex={0}
      data-unit-card={unitId}
      sx={{
        p: 1.5,
        borderLeft: 4,
        borderLeftColor: approved ? "success.main" : "warning.main",
        outline: "none",
        "&:focus-visible, &:focus-within": { boxShadow: (theme) => `0 0 0 2px ${theme.vars.palette.primary.main}` },
        minHeight: contentShown ? undefined : FRAME_PLACEHOLDER_HEIGHT,
      }}
    >
      {contentShown && (
      <>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>{title}</Box>
        {mark?.change === "add" && <Chip size="small" color="success" variant="outlined" label="Would be added" />}
        {mark?.change === "change" && (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={`Would change: ${[
              mark.content ? "text" : null,
              mark.signature ? "signature" : null,
              mark.threads ? "threads" : null,
              mark.place == null ? null : `place, ${mark.place.now} now`,
            ]
              .filter((part) => part != null)
              .join(", ")}`}
          />
        )}
        {labels}
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
      <Slot name="unitNotes" props={{ unitId, preview: preview != null }} />
      {/* The actions keep a line of their own, right-aligned just under the content, so the text keeps the full width. */}
      <Stack data-unit-actions direction="row" sx={{ alignItems: "center", gap: 0.5, justifyContent: "flex-end", mt: 0.5 }}>
        {actions}
        <Slot name="unit" props={{ unitId, preview: preview != null }} />
        {(stageOpen || threads.length > 0) && (
          <ActionTooltip name={threadTitle === "" ? threadLabel : threadTitle} shortcut={threadShortcut}>
            <Button
              {...{ [THREAD_BUTTON]: true }}
              size="small"
              color={waitsForYou ? "warning" : "primary"}
              startIcon={<Comment />}
              onClick={(event) => onOpenThread(event.currentTarget.closest<HTMLElement>("[data-unit-actions]") ?? event.currentTarget)}
            >
              {threadLabel}
            </Button>
          </ActionTooltip>
        )}
        {signable && preview == null && (
          <ActionTooltip name={signLabel} shortcut={signShortcut}>
            <Button size="small" variant="contained" startIcon={<Check />} onClick={onSign}>
              {signLabel}
            </Button>
          </ActionTooltip>
        )}
      </Stack>
      </>
      )}
    </Paper>
  );
});

export default UnitFrame;
