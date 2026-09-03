import { Box, Stack, Typography } from "@mui/material";

import type { ApprovalStatus } from "contract-domain";

export function ApprovalBar({ status }: { status: ApprovalStatus }) {
  return (
    <Box
      aria-hidden
      data-approval-bar
      sx={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: "8px",
        borderStartStartRadius: 4,
        borderEndStartRadius: 4,
        bgcolor: status === "approved" ? "success.main" : "action.disabled",
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <Box
        data-approval-bar-fill
        sx={{
          position: "absolute",
          inset: 0,
          transform: "scaleY(0)",
          transformOrigin: "top",
        }}
      />
      <Box
        data-approval-bar-sweep
        sx={{
          position: "absolute",
          inset: 0,
          bgcolor: "common.white",
          opacity: 0.4,
          transform: "scaleY(0)",
          transformOrigin: "top",
        }}
      />
    </Box>
  );
}

export function QualityIssues({
  issues,
  inset = true,
}: {
  issues: readonly string[];
  inset?: boolean;
}) {
  if (issues.length === 0) return null;
  return (
    <Stack sx={{ pl: inset ? 9 : 0, pb: 0.5 }}>
      {issues.map((issue, index) => (
        <Typography key={`${index}:${issue}`} variant="caption" color="error">
          {issue}
        </Typography>
      ))}
    </Stack>
  );
}
