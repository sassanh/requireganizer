"use client";

import { Add, Close } from "@mui/icons-material";
import { Autocomplete, Button, IconButton, InputAdornment, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import type { ItemsFieldDefinition } from "../definition";
import { chosenItems, type FieldValue, textValue } from "../records";
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
  onChange,
}: {
  field: ItemsFieldDefinition;
  value: readonly string[];
  onChange: (value: string[]) => void;
}) {
  const { module, workflow } = useWorkflowView();
  const stage = workflow.stageOfKind(field.of);
  const options = module.itemsOf(stage).filter(({ kind, removal }) => kind === field.of && removal == null);
  const [adding, setAdding] = useState(false);
  const slots = value.length === 0 || adding ? [...value, ""] : [...value];
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
      {value.length === slots.length && unchosen.length > 0 && (
        <Button size="small" startIcon={<Add />} sx={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
          Add another {workflow.kind(field.of).label.toLowerCase()}
        </Button>
      )}
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
  const [content, setContent] = useState<Record<string, FieldValue>>(() =>
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
  const ownOptions: Option[] = module.itemsOf(stage)
    .filter(({ id, removal }) => id !== itemId && removal == null)
    .map((item) => option(item.id, `${module.codeOf(item.id)} ${itemExcerpt(module.textOf(item.id))}`));
  const otherOptions: Option[] = module.linkedModules.flatMap((linked) =>
    linked.lookup
      .listItems()
      .filter((item) => item.stage === stage || workflow.buildsOn(stage, item.stage))
      .map((item) => option(item.id, `${linked.name}/${item.code}`)),
  );
  const dependencyOptions = [...ownOptions, ...otherOptions];
  const labelOf = (options: Option[], id: string) => options.find((candidate) => candidate.id === id) ?? option(id, module.codeOf(id) ?? id);
  const setField = (name: string, value: FieldValue) => setContent({ ...content, [name]: value });

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
      {definition.fields.map((field, index) => {
        switch (field.type) {
          case "text":
            return (
              <TextField
                key={field.name}
                label={field.label}
                helperText={field.description}
                multiline
                minRows={field.prefix == null ? 2 : 1}
                size="small"
                autoFocus={index === 0}
                value={textValue(content[field.name])}
                onChange={(event) => setField(field.name, event.target.value)}
                slotProps={field.prefix == null ? undefined : { input: { startAdornment: <InputAdornment position="start">{field.prefix}</InputAdornment> } }}
              />
            );
          case "choice":
            return (
              <TextField
                key={field.name}
                select
                label={field.label}
                size="small"
                sx={{ maxWidth: 160 }}
                value={textValue(content[field.name])}
                onChange={(event) => setField(field.name, event.target.value === "" ? null : event.target.value)}
              >
                {!field.required && <MenuItem value="">None</MenuItem>}
                {field.options.map((choice) => (
                  <MenuItem key={choice} value={choice}>
                    {choice}
                  </MenuItem>
                ))}
              </TextField>
            );
          case "items":
            return <ItemsChoice key={field.name} field={field} value={chosenItems(content[field.name])} onChange={(value) => setField(field.name, value)} />;
        }
      })}
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
