import { Stack, type StackProps } from "@mui/material";

import type { ApprovalStatus } from "contract-domain";

import { useStagedApproval } from "./changeQueue";
import { ApprovalBar } from "./QualityState";

interface ApprovalFrameProps extends Omit<StackProps, "id"> {
  /** DOM id marking the artifact; the approval bar lives inside it. */
  elementId: string;
  /** Staged approval state. Null renders the frame without a bar. */
  approval: ApprovalStatus | null;
}

/**
 * Single home for the approval-stripe responsibilities: the relative
 * wrapper, the staged approval stamp, and the bar itself. Cards
 * (FragmentShell) and bare fields (Product Overview name/purpose) compose
 * this instead of each hand-rolling the same trio.
 */
export function ApprovalFrame({
  elementId,
  approval,
  sx,
  children,
  ...rest
}: ApprovalFrameProps) {
  const staged = useStagedApproval(elementId, approval ?? "draft");
  return (
    <Stack
      id={elementId}
      sx={[
        { position: "relative" },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      {...rest}
    >
      {approval != null ? <ApprovalBar status={staged} /> : null}
      {children}
    </Stack>
  );
}
