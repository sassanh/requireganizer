"use client";

import { Box } from "@mui/material";

/**
 * A label with how many it counts after it, in a small neutral pill, and,
 * with `attention`, a dot in the attention colour saying what needs the
 * spec owner there, such as "holds signable units".
 */
export default function CountedLabel({ label, count, attention = null }: { label: string; count: number; attention?: string | null }) {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      {label}
      <Box
        component="span"
        sx={{
          minWidth: 20,
          px: 0.75,
          borderRadius: 10,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: "20px",
          textAlign: "center",
          bgcolor: "action.selected",
          color: "text.primary",
        }}
      >
        {count}
      </Box>
      {attention != null && <Box component="span" role="img" aria-label={attention} sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "warning.main" }} />}
    </Box>
  );
}
