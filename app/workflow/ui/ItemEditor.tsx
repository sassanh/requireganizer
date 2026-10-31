"use client";

import { Autocomplete, Button, MenuItem, Stack, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { PRIORITIES } from "../definition";
import type { ItemContent } from "../records";
import { perform, useWorkflowView } from "./context";

interface Option {
  id: string;
  label: string;
}

/** The text an item shows in a list of choices: its code and the start of its first text field. */
export function itemExcerpt(content: ItemContent): string {
  const text = Object.values(content).find((value): value is string => typeof value === "string" && value.length > 2) ?? "";
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

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
  const [content, setContent] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(definition.fields.map((field) => [field.name, current?.content[field.name] ?? (field.type === "text" ? "" : null)])),
  );
  const [references, setReferences] = useState<string[]>(() => [...(current?.references ?? [])]);
  const [dependencies, setDependencies] = useState<string[]>(() => [...(current?.dependencies ?? [])]);

  const option = (id: string, label: string): Option => ({ id, label });
  const referenceOptions: Option[] = workflow.basisStages(stage).flatMap((basis) =>
    module.itemsOf(basis)
      .filter(({ removal }) => removal == null)
      .map((item) => option(item.id, `${module.codeOf(item.id)} ${itemExcerpt(item.content)}`)),
  );
  const ownOptions: Option[] = module.itemsOf(stage)
    .filter(({ id, removal }) => id !== itemId && removal == null)
    .map((item) => option(item.id, `${module.codeOf(item.id)} ${itemExcerpt(item.content)}`));
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
      {definition.fields.map((field) =>
        field.type === "text" ? (
          <TextField
            key={field.name}
            label={field.label}
            multiline
            minRows={2}
            size="small"
            autoFocus
            value={content[field.name] ?? ""}
            onChange={(event) => setContent({ ...content, [field.name]: event.target.value })}
          />
        ) : (
          <TextField
            key={field.name}
            select
            label={field.label}
            size="small"
            sx={{ maxWidth: 160 }}
            value={content[field.name] ?? ""}
            onChange={(event) => setContent({ ...content, [field.name]: event.target.value === "" ? null : event.target.value })}
          >
            {!field.required && <MenuItem value="">None</MenuItem>}
            {PRIORITIES.map((priority) => (
              <MenuItem key={priority} value={priority}>
                {priority.toUpperCase()}
              </MenuItem>
            ))}
          </TextField>
        ),
      )}
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
