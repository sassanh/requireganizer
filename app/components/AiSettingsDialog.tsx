"use client";

import {
  Alert,
  AlertTitle,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import { useState } from "react";

import { DEFAULT_AI_SETTINGS, isHttpUrl, readAiSettings } from "ai-agent/settings";
import { browserAiSettings } from "lib/aiSettingsStorage";

interface AiSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function AiSettingsForm({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState(() => {
    const stored = browserAiSettings.read();
    return { ...stored, reviewerModel: stored.reviewerModel ?? "" };
  });
  const [openedWithoutKey] = useState(
    () => browserAiSettings.read().apiKey.length === 0,
  );
  const [error, setError] = useState<string | null>(null);
  const baseUrl = draft.baseUrl.trim();
  const urlInvalid = baseUrl.length > 0 && !isHttpUrl(baseUrl);
  const missingKey = draft.apiKey.trim().length === 0;

  const save = () => {
    try {
      browserAiSettings.save(readAiSettings(draft).settings);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  return (
    <>
      <DialogContent>
        <Stack sx={{ gap: 2, mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {missingKey && (
            <Alert severity="info">
              <AlertTitle>Add an API key to use AI</AlertTitle>
              This version of Requireganizer runs entirely in this browser. AI generation
              and review send requests straight from this page to the endpoint you choose,
              so they need an API key. Your key is stored only in this browser and is never
              sent to a Requireganizer server.
            </Alert>
          )}
          <TextField
            label="Endpoint URL"
            value={draft.baseUrl}
            placeholder={DEFAULT_AI_SETTINGS.baseUrl}
            error={urlInvalid}
            helperText={
              urlInvalid
                ? "Enter an http or https URL."
                : "An OpenAI-compatible Responses API that accepts requests from this page."
            }
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
          />
          <TextField
            label="API key"
            type="password"
            autoComplete="off"
            autoFocus={openedWithoutKey}
            value={draft.apiKey}
            helperText="Stored in this browser only."
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
          />
          <TextField
            label="Model"
            value={draft.model}
            placeholder={DEFAULT_AI_SETTINGS.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
          <TextField
            label="Reviewer model"
            value={draft.reviewerModel}
            helperText="Optional. Without one, every draft waits for your review."
            onChange={(event) => setDraft({ ...draft, reviewerModel: event.target.value })}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{openedWithoutKey ? "Not now" : "Cancel"}</Button>
        <Button variant="contained" disabled={urlInvalid} onClick={save}>
          Save
        </Button>
      </DialogActions>
    </>
  );
}

/** The AI endpoint, key, and models this page's project host calls. */
export default function AiSettingsDialog({ open, onClose }: AiSettingsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>AI settings</DialogTitle>
      {/* Mounted per opening, so the form starts from the stored settings. */}
      {open && <AiSettingsForm onClose={onClose} />}
    </Dialog>
  );
}
