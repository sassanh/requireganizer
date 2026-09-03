import { Stack, type StackProps } from "@mui/material";
import { useEffect } from "react";

import type { ApprovalStatus } from "contract-domain";

import { useStagedApproval } from "./changeQueue";
import { registerCopyProvider } from "./copy";
import { ApprovalBar } from "./QualityState";

interface ApprovalFrameProps extends Omit<StackProps, "id"> {
  /** DOM id marking the artifact; the approval bar lives inside it. */
  elementId: string;
  /** Staged approval state. Null renders the frame without a bar. */
  approval: ApprovalStatus | null;
  /** Deep-link code (FEA-1) for URL copying. Absent means the frame has no fragment address. */
  "data-fragment-code"?: string;
  /** Renders this frame's content as clipboard text. Absent means the frame has nothing to copy. */
  getCopyText?: () => string;
}

/**
 * Single home for the approval-stripe responsibilities: the relative
 * wrapper, the staged approval stamp, and the bar itself. Cards
 * (FragmentShell) and bare fields (Product Overview name/purpose) compose
 * this instead of each hand-rolling the same trio.
 *
 * Every frame is also a keyboard-navigation target: tabIndex -1 keeps it
 * out of the tab order while still letting j/k focus it with the mouse
 * equivalent (a click focuses it the same way).
 */
export function ApprovalFrame({
  elementId,
  approval,
  getCopyText,
  sx,
  children,
  ...rest
}: ApprovalFrameProps) {
  const staged = useStagedApproval(elementId, approval ?? "draft");
  useEffect(() => {
    if (getCopyText == null) return;
    return registerCopyProvider(elementId, getCopyText);
  }, [elementId, getCopyText]);
  return (
    <Stack
      id={elementId}
      tabIndex={-1}
      data-navigate-card
      sx={[
        {
          position: "relative",
          // An open change-request popover portals out of the frame, so
          // focus leaves with it: keep the frame's border through :has
          // instead of drilling open state up through every parent.
          "&:has([data-comment-open])": {
            outline: "2px solid",
            outlineColor: "primary.main",
            borderColor: "transparent",
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      {...rest}
    >
      {approval != null ? <ApprovalBar status={staged} /> : null}
      {children}
    </Stack>
  );
}
