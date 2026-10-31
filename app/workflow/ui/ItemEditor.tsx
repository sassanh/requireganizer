"use client";

import { Add, Close } from "@mui/icons-material";
import { Autocomplete, Box, Button, Checkbox, FormControlLabel, IconButton, InputAdornment, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import type { FieldDefinition, FieldPlace, ItemsFieldDefinition } from "../definition";
import { chosenItems, type FieldValue, flagValue, type RecordContent, recordsValue, recordValue, textsValue, textValue } from "../records";
import { perform, useWorkflowView } from "./context";

interface Option {
  id: string;
  label: string;
}

/** The start of an item's text, as a list of choices shows it after its code. */
export function itemExcerpt(text: string): string {
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
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
                slotProps={field.prefix == null ? undefined : { input: { startAdornment: <InputAdornment position="start">{field.prefix}</InputAdornment> } }}
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

/**
 * Write one item of a stage: a new one of `kind`, or a change to `itemId`.
 * Its fields come from its kind, its references from the stages its stage
 * builds on, and its dependencies from its own stage and other modules.
 */
const ItemEditor = observer(function ItemEditor({
  stage,
  kind,
  itemId,
  onDone,
}: {
  stage: string;
  kind: string;
  itemId: string | null;
  onDone: () => void;
}) {
  const { module, workflow } = useWorkflowView();
  const definition = workflow.kind(kind);
  const current = itemId == null ? null : module.versionOf(itemId);
  const [content, setContent] = useState<RecordContent>(() =>
    Object.fromEntries(definition.fields.map((field) => [field.name, current?.content[field.name] ?? (field.type === "items" ? [] : null)])),
  );
  const [references, setReferences] = useState<string[]>(() => [...(current?.references ?? [])]);
  const [dependencies, setDependencies] = useState<string[]>(() => [...(current?.dependencies ?? [])]);

  const option = (id: string, label: string): Option => ({ id, label });
  const chosenKinds = workflow.chosenKinds(kind);
  const referenceOptions: Option[] = workflow.basisStages(stage).flatMap((basis) =>
    module.itemsOf(basis)
      .filter(({ kind: candidate, removal }) => removal == null && !chosenKinds.includes(candidate))
      .map((item) => option(item.id, `${module.codeOf(item.id)} ${itemExcerpt(module.textOf(item.id))}`)),
  );
  const counted = [...chosenKinds, ...(definition.dependsOnSingle ?? [])];
  const ownOptions: Option[] = module.itemsOf(stage)
    .filter(({ id, kind: candidate, removal }) => id !== itemId && removal == null && !counted.includes(candidate))
    .map((item) => option(item.id, `${module.codeOf(item.id)} ${itemExcerpt(module.textOf(item.id))}`));
  const otherOptions: Option[] = module.linkedModules.flatMap((linked) =>
    linked.lookup
      .listItems()
      .filter((item) => item.stage === stage || workflow.buildsOn(stage, item.stage))
      .map((item) => option(item.id, `${linked.name}/${item.code}`)),
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
    if (saved) onDone();
  };

  return (
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
          renderInput={(params) => <TextField {...params} label="Dependencies" />}
        />
      )}
      <Stack direction="row" sx={{ gap: 1 }}>
        <Button size="small" variant="contained" onClick={() => void save()}>
          {itemId == null ? `Add ${definition.label.toLowerCase()}` : "Save"}
        </Button>
        <Button size="small" onClick={onDone}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
});

export default ItemEditor;
