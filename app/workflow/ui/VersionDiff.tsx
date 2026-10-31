"use client";

import { Box, Stack, Typography } from "@mui/material";

import { wordDiff } from "components/wordDiff";

import type { FieldDefinition } from "../definition";
import { chosenItems, type FieldValue, type ItemVersion, recordsValue, recordValue, textsValue, textValue } from "../records";
import { useWorkflowView } from "./context";

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

/** A structured field's value as lines of text, each chosen item by name, so that two versions diff word by word. */
function fieldText(field: FieldDefinition, value: FieldValue, name: (id: string) => string, indent = ""): string {
  const fieldsText = (fields: readonly FieldDefinition[], record: Record<string, FieldValue>, inner: string) =>
    fields
      .filter((nested) => {
        const nestedValue = record[nested.name] ?? null;
        return nestedValue != null && nestedValue !== false && !(Array.isArray(nestedValue) && nestedValue.length === 0);
      })
      .map((nested) => `${inner}${nested.label}: ${fieldText(nested, record[nested.name] ?? null, name, `${inner}  `).trimStart()}`)
      .join("\n");
  switch (field.type) {
    case "items":
      return chosenItems(value).map(name).join(", ");
    case "texts":
      return textsValue(value).join(", ");
    case "flag":
      return value === true ? "yes" : "no";
    case "record": {
      const record = recordValue(value);
      return record == null ? "none" : `\n${fieldsText(field.fields, record, indent)}`;
    }
    case "records":
      return recordsValue(value)
        .map((record, index) => `\n${indent}${field.entry} ${index + 1}\n${fieldsText(field.fields, record, `${indent}  `)}`)
        .join("");
    default:
      return textValue(value);
  }
}

/** How a version differs from the one its last signature covers, field by field and link by link. */
export default function VersionDiff({
  kind,
  signed,
  current,
  name,
}: {
  kind: string;
  signed: ItemVersion;
  current: ItemVersion;
  name: (id: string) => string;
}) {
  const { workflow } = useWorkflowView();
  const changed = workflow
    .kind(kind)
    .fields.filter((field) => JSON.stringify(signed.content[field.name] ?? null) !== JSON.stringify(current.content[field.name] ?? null));
  return (
    <Stack spacing={0.5} sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
      <Typography variant="caption" color="text.secondary">
        Since the last signature
      </Typography>
      {changed.map((field) =>
        field.type === "items" ? (
          <LinkDiff key={field.name} label={field.label} before={chosenItems(signed.content[field.name])} after={chosenItems(current.content[field.name])} name={name} />
        ) : (
          <Stack key={field.name} spacing={0.25}>
            <Typography variant="caption">{field.label}</Typography>
            <TextDiff before={fieldText(field, signed.content[field.name] ?? null, name)} after={fieldText(field, current.content[field.name] ?? null, name)} />
          </Stack>
        ),
      )}
      <LinkDiff label="References" before={signed.references} after={current.references} name={name} />
      <LinkDiff label="Dependencies" before={signed.dependencies} after={current.dependencies} name={name} />
    </Stack>
  );
}
