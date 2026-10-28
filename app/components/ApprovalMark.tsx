import { Restore } from "@mui/icons-material";
import { Chip, IconButton, Stack, Tooltip } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";

import { approveAction } from "actions/actions";
import { ActionView } from "actions/ActionView";
import type { ModelVerdict } from "contract-domain";
import { getUserFacingErrorMessage } from "lib/errors";
import { type Store, useStore } from "store";

import CommentButton from "./CommentButton";
import { DecisionDialog } from "./DecisionDialog";
import { notify } from "./notices";

type PendingDecision =
  | { kind: "approve"; verdict: ModelVerdict }
  | { kind: "change"; verdict: ModelVerdict; comment: string };

/**
 * The person's change request joins the unit's thread; when Requireganizer's
 * AI answers change requests, it starts on the thread at once.
 */
async function askForChange(store: Store, unitId: string, text: string): Promise<void> {
  try {
    const threadId = await store.requestChange(unitId, text);
    const unit = store.reviewUnit(unitId);
    if (store.threadAnswerer === "requireganizer" && unit != null) {
      void store.answerThread(unit.stage, threadId);
    }
  } catch (error) {
    notify(getUserFacingErrorMessage(error, "Unable to send the change request."), "error");
  }
}

/**
 * Every review action on one unit: approve, request a change, restore the
 * signed version, and the reviewer model's verdict. A person acting
 * against a current model verdict decides explicitly first.
 */
const ApprovalMark = observer(function ApprovalMark({ id }: { id: string }) {
  const store = useStore();
  const [decision, setDecision] = useState<PendingDecision | null>(null);
  // Resolves the comment box's pending submit when a decision dialog closes.
  const decisionResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const unit = store?.reviewUnit(id);
  if (store == null || unit == null) return null;
  const canApprove = store.canApprove(id);
  const verdict = store.currentVerdictOf(id);
  const editable = store.stageIsEditable(unit.stage);
  const approvedBy = unit.approved ? unit.signature?.reviewer : null;

  const settleDecision = (confirmed: boolean) => {
    decisionResolver.current?.(confirmed);
    decisionResolver.current = null;
  };
  const approve = async (): Promise<boolean> => {
    if (verdict?.verdict === "reject") {
      setDecision({ kind: "approve", verdict });
      return false;
    }
    await store.approve(id);
    return true;
  };
  const requestChange = (comment: string): boolean | Promise<boolean> => {
    if (verdict?.verdict === "approve") {
      setDecision({ kind: "change", verdict, comment });
      // Keep the typed comment until the person confirms or cancels.
      return new Promise<boolean>((resolve) => {
        decisionResolver.current = resolve;
      });
    }
    void askForChange(store, id, comment);
    return true;
  };

  return (
    <Stack ref={rootRef} direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
      {verdict != null && !unit.approved ? (
        <Tooltip title={`${verdict.reason} — ${verdict.model}`}>
          <Chip
            size="small"
            variant="outlined"
            color={verdict.verdict === "approve" ? "success" : "warning"}
            label={verdict.verdict === "approve" ? "Model approves" : "Model asks for a change"}
          />
        </Tooltip>
      ) : null}
      {approvedBy?.kind === "model" ? (
        <Tooltip title={`Approved by ${approvedBy.model}`}>
          <Chip size="small" variant="outlined" label="Model-approved" />
        </Tooltip>
      ) : null}
      {store.canRestore(id) ? (
        <Tooltip title="Restore the signed version">
          <IconButton size="small" color="primary" onClick={() => void store.restoreSigned(id)}>
            <Restore fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {canApprove ? (
        <ActionView
          variant="textbutton"
          action={approveAction}
          target={{
            blocked: store.isBusy,
            approvable: canApprove,
            approve,
            frame: () => rootRef.current?.closest<HTMLElement>("[data-navigate-card]") ?? null,
          }}
          size="small"
          buttonVariant="contained"
        />
      ) : null}
      {store.takesChangeRequests(id) ? (
        <CommentButton
          unitId={id}
          disabled={!editable || store.isBusy}
          onSubmit={requestChange}
        />
      ) : null}
      <DecisionDialog
        verdict={decision?.verdict ?? null}
        confirmLabel={decision?.kind === "change" ? "Request the change anyway" : "Approve anyway"}
        onClose={() => {
          settleDecision(false);
          setDecision(null);
        }}
        onConfirm={async () => {
          if (decision == null) return;
          if (decision.kind === "change") {
            void askForChange(store, id, decision.comment);
            settleDecision(true);
            return;
          }
          try {
            await store.approve(id, { decided: true });
            notify("Approved");
            settleDecision(true);
          } catch (error) {
            notify(getUserFacingErrorMessage(error, "Unable to approve."), "error");
            settleDecision(false);
          }
        }}
      />
    </Stack>
  );
});

export default ApprovalMark;
