import { Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

import { Quality } from "store";

export function qualityBarSx(quality: Quality): SxProps<Theme> {
  return {
    borderLeft: "4px solid",
    borderColor: {
      [Quality.Unchecked]: "action.disabled",
      [Quality.Good]: "success.main",
      [Quality.Bad]: "error.main",
    }[quality],
    pl: 1,
  };
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
