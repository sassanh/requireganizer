"use client";

import { Box, Stack, Typography } from "@mui/material";

import { wordDiff } from "components/wordDiff";

import type { ItemVersion } from "../records";

function TextDiff({ before, after }: { before: string; after: string }) {
  return (
    <Typography variant="body2" component="div" sx={{ whiteSpace: "pre-wrap" }}>
      {wordDiff(before, after).map((hunk, index) => (
        <Box
          key={index}
          component="span"
          sx={
            hunk.kind === "insert"
              ? { bgcolor: "success.light", color: "success.contrastText" }
              : hunk.kind === "delete"
                ? { bgcolor: "error.light", color: "error.contrastText", textDecoration: "line-through" }
                : undefined
          }
        >
          {hunk.text}
        </Box>
      ))}
    </Typography>
  );
}

function LinkDiff({ label, before, after, name }: { label: string; before: readonly string[]; after: readonly string[]; name: (id: string) => string }) {
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  if (added.length === 0 && removed.length === 0) {
    return before.join() === after.join() ? null : <Typography variant="body2">{label}: reordered</Typography>;
  }
  return (
    <Typography variant="body2">
      {label}:{added.length > 0 && <Box component="span" sx={{ color: "success.main" }}> added {added.map(name).join(", ")}</Box>}
      {removed.length > 0 && <Box component="span" sx={{ color: "error.main" }}> removed {removed.map(name).join(", ")}</Box>}
    </Typography>
  );
}

/** How a version differs from the one its last signature covers, field by field and link by link. */
export default function VersionDiff({
  signed,
  current,
  fieldLabel,
  name,
}: {
  signed: ItemVersion;
  current: ItemVersion;
  fieldLabel: (field: string) => string;
  name: (id: string) => string;
}) {
  const fields = [...new Set([...Object.keys(signed.content), ...Object.keys(current.content)])].filter(
    (field) => (signed.content[field] ?? null) !== (current.content[field] ?? null),
  );
  return (
    <Stack spacing={0.5} sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
      <Typography variant="caption" color="text.secondary">
        Since the last signature
      </Typography>
      {fields.map((field) => (
        <Stack key={field} spacing={0.25}>
          <Typography variant="caption">{fieldLabel(field)}</Typography>
          <TextDiff before={signed.content[field] ?? ""} after={current.content[field] ?? ""} />
        </Stack>
      ))}
      <LinkDiff label="References" before={signed.references} after={current.references} name={name} />
      <LinkDiff label="Dependencies" before={signed.dependencies} after={current.dependencies} name={name} />
    </Stack>
  );
}
