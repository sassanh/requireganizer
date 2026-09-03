import { Button, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";

import { useStore } from "store";

import CommentButton from "./CommentButton";
import { notify } from "./notices";

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
        <Button
          size="small"
          variant="contained"
          data-approve-button
          disabled={store?.isBusy === true}
          onClick={(event) => {
            event.stopPropagation();
            store.approve(id);
            notify("Approved");
          }}
        >
          Approve
        </Button>
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
