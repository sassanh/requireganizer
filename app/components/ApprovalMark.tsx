import { Restore } from "@mui/icons-material";
import { Chip, IconButton, Stack, Tooltip } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { approveAction } from "actions/actions";
import { ActionView } from "actions/ActionView";
import type { ModelVerdict } from "contract-domain";
import { useStore } from "store";

import CommentButton from "./CommentButton";
import { DecisionDialog } from "./DecisionDialog";
import { notify } from "./notices";

type PendingDecision =
  | { kind: "approve"; verdict: ModelVerdict }
  | { kind: "change"; verdict: ModelVerdict; comment: string };

/**
 * Every review action on one unit: approve, request a change, restore the
 * signed version, and the reviewer model's verdict. A person acting
 * against a current model verdict decides explicitly first.
 */
const ApprovalMark = observer(function ApprovalMark({
  id,
  onRequestChange,
  requestChangeDisabled = false,
}: {
  id: string;
  onRequestChange?: (comment: string) => void;
  requestChangeDisabled?: boolean;
}) {
  const store = useStore();
  const [decision, setDecision] = useState<PendingDecision | null>(null);
  const unit = store?.reviewUnit(id);
  if (store == null || unit == null) return null;
  const canApprove = store.canApprove(id);
  const verdict = store.currentVerdictOf(id);
  const editable = store.stageIsEditable(unit.stage);
  const approvedBy = unit.approved ? unit.approval?.reviewer : null;

  const approve = (): boolean => {
    if (verdict?.verdict === "reject") {
      setDecision({ kind: "approve", verdict });
      return false;
    }
    store.approve(id);
    return true;
  };
  const requestChange = (comment: string): boolean => {
    if (verdict?.verdict === "approve") {
      setDecision({ kind: "change", verdict, comment });
      return true;
    }
    onRequestChange?.(comment);
    return true;
  };

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
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
          <IconButton size="small" color="primary" onClick={() => store.restoreSigned(id)}>
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
          }}
          size="small"
          buttonVariant="contained"
        />
      ) : null}
      {onRequestChange != null ? (
        <CommentButton
          disabled={requestChangeDisabled || !editable || store.isBusy}
          onSubmit={requestChange}
        />
      ) : null}
      <DecisionDialog
        verdict={decision?.verdict ?? null}
        confirmLabel={decision?.kind === "change" ? "Request the change anyway" : "Approve anyway"}
        onClose={() => setDecision(null)}
        onConfirm={() => {
          if (decision == null) return;
          if (decision.kind === "change") {
            onRequestChange?.(decision.comment);
            return;
          }
          store.approve(id, { decided: true });
          notify("Approved");
        }}
      />
    </Stack>
  );
});

export default ApprovalMark;
