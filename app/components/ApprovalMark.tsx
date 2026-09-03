import { Stack } from "@mui/material";
import { observer } from "mobx-react-lite";

import { approveAction } from "actions/actions";
import { ActionView } from "actions/ActionView";
import { useStore } from "store";

import CommentButton from "./CommentButton";

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
  const status = store?.approvalOf(id);
  if (status == null) return null;
  const canApprove = store?.canApprove(id) === true;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
      {canApprove ? (
        <ActionView
          variant="textbutton"
          action={approveAction}
          target={{
            blocked: store?.isBusy === true,
            approvable: canApprove,
            approve: () => store?.approve(id),
          }}
          size="small"
          buttonVariant="contained"
        />
      ) : null}
      {onRequestChange != null ? (
        <CommentButton
          disabled={requestChangeDisabled || store?.isBusy === true}
          onSubmit={onRequestChange}
        />
      ) : null}
    </Stack>
  );
});

export default ApprovalMark;
