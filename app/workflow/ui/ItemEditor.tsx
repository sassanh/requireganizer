"use client";

import { Add, Close } from "@mui/icons-material";
import { Alert, Autocomplete, Box, Button, Checkbox, Dialog, FormControlLabel, IconButton, InputAdornment, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, useEffect, useState } from "react";

import type { FieldDefinition, FieldPlace, ItemsFieldDefinition } from "../definition";
import { chosenItems, type FieldValue, flagValue, type RecordContent, recordsValue, recordValue, textsValue, textValue } from "../records";
import { perform, useWorkflowView } from "./context";
import ItemChip, { ItemOption } from "./ItemChip";

interface Option {
  id: string;
  label: string;
}

/**
 * A field's prefix, such as "The system must", set over the start of its
 * first line: the text indents its first line by the prefix's width, so the
 * two read as one sentence and the text wraps under the prefix.
 */
function prefixedSlots(prefix: string, width: number, onWidth: (width: number) => void) {
  return {
    input: {
      startAdornment: (
        <Box
          component="span"
          ref={(element: HTMLSpanElement | null) => {
            if (element != null) onWidth(element.offsetWidth);
          }}
          sx={{ position: "absolute", top: "8.5px", left: "14px", lineHeight: "1.4375em", color: "text.secondary", fontWeight: 600, pointerEvents: "none" }}
        >
          {prefix}
        </Box>
      ),
    },
    htmlInput: { style: { textIndent: width === 0 ? undefined : `${width + 4}px` } },
  };
}

/**
 * The items an items field chooses: one choice to begin with, and as many
 * more as the writer adds.
 */
const ItemsChoice = observer(function ItemsChoice({
  field,
  value,
  offered,
  onChange,
}: {
  field: ItemsFieldDefinition;
  value: readonly string[];
  /** The only items it offers where it sits, when its kind narrows them. */
  offered: readonly string[] | null;
  onChange: (value: string[]) => void;
}) {
  const { module, workflow } = useWorkflowView();
  const stage = workflow.stageOfKind(field.of);
  const options = module
    .itemsOf(stage)
    .filter(({ id, kind, removal }) => kind === field.of && removal == null && (offered == null || offered.includes(id) || value.includes(id)));
  const [adding, setAdding] = useState(false);
  const slots = value.length === 0 || adding ? [...value, ""] : [...value];
  const canAddMore = !field.single;
  const nameOf = (id: string) => `${module.codeOf(id) ?? ""} ${textValue(module.locate(id)?.item.content[field.shows])}`;
  const unchosen = options.filter(({ id }) => !slots.includes(id));
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        {field.label}
      </Typography>
      {slots.map((chosen, index) => (
        <Stack key={index} direction="row" sx={{ gap: 1, alignItems: "center" }}>
          <TextField
            select
            size="small"
            sx={{ flexGrow: 1 }}
            label={workflow.kind(field.of).label}
            value={chosen}
            onChange={(event) => {
              setAdding(false);
              onChange(slots.map((slot, slotIndex) => (slotIndex === index ? event.target.value : slot)).filter((slot) => slot !== ""));
            }}
          >
            {options
              .filter(({ id }) => id === chosen || !slots.includes(id))
              .map(({ id }) => (
                <MenuItem key={id} value={id}>
                  {nameOf(id)}
                </MenuItem>
              ))}
          </TextField>
          {slots.length > 1 && (
            <IconButton
              size="small"
              aria-label={`Remove this ${workflow.kind(field.of).label.toLowerCase()}`}
              onClick={() => {
                if (chosen === "") setAdding(false);
                else onChange(value.filter((id) => id !== chosen));
              }}
            >
              <Close fontSize="small" />
            </IconButton>
          )}
        </Stack>
      ))}
      {canAddMore && value.length === slots.length && unchosen.length > 0 && (
        <Button size="small" startIcon={<Add />} sx={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
          Add another {workflow.kind(field.of).label.toLowerCase()}
        </Button>
      )}
    </Stack>
  );
});

/** A choice among values, with none when the field is optional. */
function Select({ label, value, values, required, onChange, describe = (option) => option }: {
  label: string;
  value: string;
  values: readonly string[];
  required: boolean;
  onChange: (value: string | null) => void;
  describe?: (option: string) => string;
}) {
  const shown = value === "" || values.includes(value) ? values : [value, ...values];
  return (
    <TextField select label={label} size="small" sx={{ minWidth: 200 }} value={value} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}>
      {!required && <MenuItem value="">None</MenuItem>}
      {shown.map((option) => (
        <MenuItem key={option} value={option}>
          {describe(option)}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** A list of texts, one field each, as many as the writer adds. */
function TextsEditor({ label, value, onChange }: { label: string; value: readonly string[]; onChange: (value: string[]) => void }) {
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {value.map((entry, index) => (
        <Stack key={index} direction="row" sx={{ gap: 1, alignItems: "center" }}>
          <TextField size="small" sx={{ flexGrow: 1 }} value={entry} onChange={(event) => onChange(value.map((current, position) => (position === index ? event.target.value : current)))} />
          <IconButton size="small" aria-label="Remove this entry" onClick={() => onChange(value.filter((_entry, position) => position !== index))}>
            <Close fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Button size="small" startIcon={<Add />} sx={{ alignSelf: "flex-start" }} onClick={() => onChange([...value, ""])}>
        Add
      </Button>
    </Stack>
  );
}

interface Placement {
  content: RecordContent;
  path: FieldPlace["path"];
}

/**
 * The fields of a record, each as its type is written: the item's own
 * fields at the top, and a record's fields within it. A field that narrows
 * its values where it sits offers only those.
 */
const FieldsEditor = observer(function FieldsEditor({
  fields,
  record,
  placement,
  onChange,
  autoFocus = false,
}: {
  fields: readonly FieldDefinition[];
  record: RecordContent;
  placement: Placement;
  onChange: (record: RecordContent) => void;
  autoFocus?: boolean;
}) {
  const { module, workflow } = useWorkflowView();
  const place: FieldPlace = { content: placement.content, path: placement.path, record, module: module.reader };
  const set = (name: string, value: FieldValue) => onChange({ ...record, [name]: value });
  const [prefixWidths, setPrefixWidths] = useState<Record<string, number>>({});
  return (
    <Stack spacing={1.5}>
      {fields.map((field, index) => {
        const value = record[field.name] ?? null;
        switch (field.type) {
          case "text":
            if (field.offered != null) {
              return <Select key={field.name} label={field.label} value={textValue(value)} values={field.offered(place).values} required={field.required} onChange={(chosen) => set(field.name, chosen)} />;
            }
            return (
              <TextField
                key={field.name}
                label={field.label}
                helperText={field.description}
                multiline
                minRows={field.prefix == null && placement.path.length === 0 ? 2 : 1}
                size="small"
                autoFocus={autoFocus && index === 0}
                value={textValue(value)}
                onChange={(event) => set(field.name, event.target.value)}
                slotProps={field.prefix == null ? undefined : prefixedSlots(field.prefix, prefixWidths[field.name] ?? 0, (width) => setPrefixWidths((widths) => (widths[field.name] === width ? widths : { ...widths, [field.name]: width })))}
              />
            );
          case "choice": {
            const offered = field.offered?.(place).values;
            return (
              <Select key={field.name} label={field.label} value={textValue(value)} values={field.options.filter((option) => offered == null || offered.includes(option))} required={field.required} onChange={(chosen) => set(field.name, chosen)} />
            );
          }
          case "flag":
            return (
              <FormControlLabel key={field.name} label={field.label} control={<Checkbox size="small" checked={flagValue(value)} onChange={(event) => set(field.name, event.target.checked)} />} />
            );
          case "texts":
            return <TextsEditor key={field.name} label={field.label} value={textsValue(value)} onChange={(texts) => set(field.name, texts)} />;
          case "items":
            return (
              <ItemsChoice key={field.name} field={field} value={chosenItems(value)} offered={field.offered?.(place).values ?? null} onChange={(chosen) => set(field.name, chosen)} />
            );
          case "record": {
            const nested = recordValue(value);
            if (nested == null) {
              return (
                <Button key={field.name} size="small" startIcon={<Add />} sx={{ alignSelf: "flex-start" }} onClick={() => set(field.name, {})}>
                  {field.label}
                </Button>
              );
            }
            return (
              <Box key={field.name} sx={{ pl: 1.5, borderLeft: 2, borderColor: "divider" }}>
                <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {field.label}
                  </Typography>
                  <IconButton size="small" aria-label={`Remove ${field.label.toLowerCase()}`} onClick={() => set(field.name, null)}>
                    <Close fontSize="small" />
                  </IconButton>
                </Stack>
                <FieldsEditor fields={field.fields} record={nested} placement={placement} onChange={(changed) => set(field.name, changed)} />
              </Box>
            );
          }
          case "records": {
            const records = recordsValue(value);
            return (
              <Stack key={field.name} spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  {field.label}
                </Typography>
                {records.map((entry, position) => (
                  <Box key={position} sx={{ pl: 1.5, borderLeft: 2, borderColor: "divider" }}>
                    <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                        {field.entry.charAt(0).toUpperCase()}
                        {field.entry.slice(1)} {position + 1}
                      </Typography>
                      <IconButton size="small" aria-label={`Remove ${field.entry} ${position + 1}`} onClick={() => set(field.name, records.filter((_entry, current) => current !== position))}>
                        <Close fontSize="small" />
                      </IconButton>
                    </Stack>
                    <FieldsEditor
                      fields={field.fields}
                      record={entry}
                      placement={{ content: placement.content, path: [...placement.path, { field: field.name, entry: field.entry, index: position, record: entry }] }}
                      onChange={(changed) => set(field.name, records.map((current, index) => (index === position ? changed : current)))}
                    />
                  </Box>
                ))}
                <Button size="small" startIcon={<Add />} sx={{ alignSelf: "flex-start" }} onClick={() => set(field.name, [...records, {}])}>
                  Add {field.entry}
                </Button>
              </Stack>
            );
          }
        }
      })}
    </Stack>
  );
});

/** What the editor writes: a new item of `kind` in `stage`, or a change to `itemId`. */
export interface EditorTarget {
  stage: string;
  kind: string;
  itemId: string | null;
}

/**
 * Write one item of a stage in a side panel, so the list keeps its layout
 * and stays readable beside it, or over the whole screen on a narrow one:
 * a new one of `kind`, or a change to `itemId`.
 * Its fields come from its kind, its references from the stages its stage
 * builds on, and its dependencies from its own stage and other modules.
 */
const ItemEditor = observer(function ItemEditor({
  target: { stage, kind, itemId },
  full,
  confirmingDiscard,
  onSaved,
  onCancel,
  onDiscard,
  onKeepEditing,
  onDirtyChange,
}: {
  target: EditorTarget;
  /** Over the whole screen, on a narrow one. */
  full: boolean;
  /** Leaving was asked with unsaved changes: the editor asks whether to discard them. */
  confirmingDiscard: boolean;
  onSaved: () => void;
  /** Asks to leave: Cancel, Escape or the close button. */
  onCancel: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { module, workflow } = useWorkflowView();
  const definition = workflow.kind(kind);
  const current = itemId == null ? null : module.versionOf(itemId);
  const [content, setContent] = useState<RecordContent>(() =>
    Object.fromEntries(
      definition.fields.map((field) => [
        field.name,
        current == null ? (field.type === "items" ? [] : field.type === "choice" ? (field.initial ?? null) : null) : (current.content[field.name] ?? null),
      ]),
    ),
  );
  const [references, setReferences] = useState<string[]>(() => [...(current?.references ?? [])]);
  const [dependencies, setDependencies] = useState<string[]>(() => [...(current?.dependencies ?? [])]);
  const [initial] = useState(() => JSON.stringify({ content, references, dependencies }));
  const dirty = JSON.stringify({ content, references, dependencies }) !== initial;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const option = (id: string, label: string): Option => ({ id, label });
  const chosenKinds = workflow.chosenKinds(kind);
  const kindsNotOfferedAsReferences = [...chosenKinds, ...(definition.referencesSingle ?? []), ...(definition.mayNotReference ?? [])];
  const referenceOptions: Option[] = workflow.basisStages(stage).flatMap((basis) =>
    module.itemsOf(basis)
      .filter(({ kind: candidate, removal }) => removal == null && !kindsNotOfferedAsReferences.includes(candidate))
      .map((item) => option(item.id, `${module.codeOf(item.id)} ${module.textOf(item.id)}`)),
  );
  const counted = [...chosenKinds, ...(definition.dependsOnSingle ?? [])];
  const ownOptions: Option[] = module.itemsOf(stage)
    .filter(({ id, kind: candidate, removal }) => id !== itemId && removal == null && !counted.includes(candidate))
    .map((item) => option(item.id, `${module.codeOf(item.id)} ${module.textOf(item.id)}`));
  const otherOptions: Option[] = module.linkedModules.flatMap((linked) =>
    linked.lookup
      .listItems()
      .filter((item) => item.stage === stage || workflow.buildsOn(stage, item.stage))
      .map((item) => option(item.id, module.namedItem(item.id)?.name ?? item.code)),
  );
  const dependencyOptions = [...ownOptions, ...otherOptions];
  const labelOf = (options: Option[], id: string) => options.find((candidate) => candidate.id === id) ?? option(id, module.codeOf(id) ?? id);

  const save = async () => {
    const saved = await perform(
      () =>
        module.writeItems([
          itemId == null
            ? { type: "add", stage, kind, content, references, dependencies }
            : { type: "change", item: itemId, content, references, dependencies },
        ]),
      "The item could not be saved.",
    );
    if (saved) onSaved();
  };

  const panel: ReactNode = (
    <Stack
      sx={{ height: "100%", minHeight: 0 }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onCancel();
      }}
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, p: 1.5, pb: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flexGrow: 1 }}>
          {itemId == null ? `Add ${definition.label.toLowerCase()}` : `Edit ${module.codeOf(itemId)}`}
        </Typography>
        <Tooltip title="Close (Esc)">
          <IconButton size="small" onClick={onCancel}><Close fontSize="small" /></IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: 1.5 }}>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <FieldsEditor fields={definition.fields} record={content} placement={{ content, path: [] }} onChange={(changed) => setContent({ ...changed })} autoFocus />
          {referenceOptions.length > 0 && (
            <Autocomplete
              multiple
              size="small"
              options={referenceOptions}
              value={references.map((id) => labelOf(referenceOptions, id))}
              isOptionEqualToValue={(left, right) => left.id === right.id}
              onChange={(_event, value) => setReferences(value.map(({ id }) => id))}
              renderValue={(chosen, getItemProps) => chosen.map(({ id }, index) => {
                const { key, onDelete } = getItemProps({ index });
                return <ItemChip key={key} itemId={id} opens={false} onDelete={onDelete} />;
              })}
              renderOption={({ key, ...props }, { id }) => <li key={key} {...props}><ItemOption itemId={id} /></li>}
              renderInput={(params) => <TextField {...params} label="References" />}
            />
          )}
          {dependencyOptions.length > 0 && (
            <Autocomplete
              multiple
              size="small"
              options={dependencyOptions}
              value={dependencies.map((id) => labelOf(dependencyOptions, id))}
              isOptionEqualToValue={(left, right) => left.id === right.id}
              onChange={(_event, value) => setDependencies(value.map(({ id }) => id))}
              renderValue={(chosen, getItemProps) => chosen.map(({ id }, index) => {
                const { key, onDelete } = getItemProps({ index });
                return <ItemChip key={key} itemId={id} opens={false} onDelete={onDelete} />;
              })}
              renderOption={({ key, ...props }, { id }) => <li key={key} {...props}><ItemOption itemId={id} /></li>}
              renderInput={(params) => <TextField {...params} label="Dependencies" />}
            />
          )}
        </Stack>
      </Box>
      <Stack spacing={1} sx={{ p: 1.5 }}>
        {confirmingDiscard ? (
          <Alert
            severity="warning"
            action={
              <Stack direction="row" sx={{ gap: 1 }}>
                <Button color="inherit" size="small" onClick={onKeepEditing}>Keep editing</Button>
                <Button color="inherit" size="small" onClick={onDiscard}>Discard</Button>
              </Stack>
            }
          >
            Discard your changes?
          </Alert>
        ) : (
          <Stack direction="row" sx={{ gap: 1, justifyContent: "flex-end" }}>
            <Button onClick={onCancel}>Cancel</Button>
            <Button variant="contained" onClick={() => void save()}>
              {itemId == null ? `Add ${definition.label.toLowerCase()}` : "Save"}
            </Button>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
  if (full) return <Dialog open fullScreen onClose={onCancel}>{panel}</Dialog>;
  return (
    <Paper square variant="outlined" sx={{ width: 480, flexShrink: 0, borderTop: 0, borderBottom: 0, borderRight: 0, minHeight: 0 }}>
      {panel}
    </Paper>
  );
});

export default ItemEditor;
