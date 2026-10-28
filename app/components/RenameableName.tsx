import { Edit } from "@mui/icons-material";
import { IconButton, Stack, TextField, Tooltip, Typography, type TypographyProps } from "@mui/material";
import { useState } from "react";

interface NameFieldProps {
  name: string;
  /** What is being renamed, for the field's label: "Project", "Module". */
  label: string;
  /** Rejects with the reason when the name cannot be used. */
  rename: (name: string) => Promise<void>;
  /** The field is done: saved, unchanged, or cancelled. */
  onDone: () => void;
}

/**
 * The field that renames something. Enter saves, Escape or leaving it
 * unchanged cancels; a refused name keeps the field open with the reason.
 */
export function NameField({ name, label, rename, onDone }: NameFieldProps) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    if (draft.trim() === name) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      await rename(draft);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That name cannot be used.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <TextField
      autoFocus
      fullWidth
      size="small"
      label={`${label} name`}
      value={draft}
      error={error != null}
      helperText={error}
      disabled={saving}
      onChange={(event) => {
        setDraft(event.target.value);
        setError(null);
      }}
      onBlur={() => {
        if (error == null) void save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") void save();
        if (event.key === "Escape") {
          event.stopPropagation();
          onDone();
        }
      }}
    />
  );
}

interface RenameableNameProps extends Omit<NameFieldProps, "onDone"> {
  variant?: TypographyProps["variant"];
  disabled?: boolean;
}

/** A name shown as text, with a button that turns it into a `NameField`. */
export function RenameableName({ name, label, rename, variant = "body1", disabled = false }: RenameableNameProps) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <NameField name={name} label={label} rename={rename} onDone={() => setEditing(false)} />;
  }
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, minWidth: 0 }}>
      <Typography variant={variant} noWrap>
        {name}
      </Typography>
      <RenameButton name={name} label={label} disabled={disabled} onClick={() => setEditing(true)} />
    </Stack>
  );
}

export function RenameButton({
  name,
  label,
  disabled = false,
  onClick,
}: {
  name: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={`Rename ${label.toLowerCase()}`}>
      <span>
        <IconButton size="small" aria-label={`Rename ${name}`} disabled={disabled} onClick={onClick}>
          <Edit fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}
