"use client";

import { Box, Stack, Typography } from "@mui/material";

import { wordDiff } from "components/wordDiff";

import type { FieldDefinition } from "../definition";
import { chosenItems, type FieldValue, type ItemVersion, recordsValue, recordValue, textsValue, textValue } from "../records";
import { useWorkflowView } from "./context";
import ItemChip, { useItemName } from "./ItemChip";

/** Two versions of a text word by word, after the field's prefix, such as "The system must", as the item reads. */
function TextDiff({ before, after, prefix }: { before: string; after: string; prefix?: string }) {
  return (
    <Typography variant="body2" component="div" sx={{ whiteSpace: "pre-wrap" }}>
      {prefix != null && <Box component="span" sx={{ color: "text.secondary", fontWeight: 600 }}>{prefix} </Box>}
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

function LinkDiff({ label, before, after }: { label: string; before: readonly string[]; after: readonly string[] }) {
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  if (added.length === 0 && removed.length === 0) {
    return before.join() === after.join() ? null : <Typography variant="body2">{label}: reordered</Typography>;
  }
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
      <Typography variant="body2">{label}:</Typography>
      {added.length > 0 && <Typography variant="body2" sx={{ color: "success.main" }}>added</Typography>}
      {added.map((id) => <ItemChip key={id} itemId={id} />)}
      {removed.length > 0 && <Typography variant="body2" sx={{ color: "error.main" }}>removed</Typography>}
      {removed.map((id) => <ItemChip key={id} itemId={id} />)}
    </Stack>
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

/** How a version differs from an earlier one, by default the one its last signature covers, field by field and link by link. */
export default function VersionDiff({ kind, signed, current, caption = "Since the last signature" }: { kind: string; signed: ItemVersion; current: ItemVersion; caption?: string }) {
  const { workflow } = useWorkflowView();
  const name = useItemName();
  const changed = workflow
    .kind(kind)
    .fields.filter((field) => JSON.stringify(signed.content[field.name] ?? null) !== JSON.stringify(current.content[field.name] ?? null));
  return (
    <Stack spacing={0.5} sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
      <Typography variant="caption" color="text.secondary">
        {caption}
      </Typography>
      {changed.map((field) =>
        field.type === "items" ? (
          <LinkDiff key={field.name} label={field.label} before={chosenItems(signed.content[field.name])} after={chosenItems(current.content[field.name])} />
        ) : (
          <Stack key={field.name} spacing={0.25}>
            <Typography variant="caption">{field.label}</Typography>
            <TextDiff
              before={fieldText(field, signed.content[field.name] ?? null, name)}
              after={fieldText(field, current.content[field.name] ?? null, name)}
              prefix={field.type === "text" ? field.prefix : undefined}
            />
          </Stack>
        ),
      )}
      <LinkDiff label="References" before={signed.references} after={current.references} />
      <LinkDiff label="Dependencies" before={signed.dependencies} after={current.dependencies} />
    </Stack>
  );
}
