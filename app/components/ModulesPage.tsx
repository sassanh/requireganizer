"use client";

import { Add, MoreVert } from "@mui/icons-material";
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  type Theme,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { ModuleWorkingSign } from "agents/ui";
import type { ModuleSummary } from "project-session";
import { useProject } from "projectContext";
import type { Store } from "store";
import { useWaitsForSpecOwner } from "workflow/ui";

import { NameField, RenameButton } from "./RenameableName";

/** The grid module cards show in, as many columns as fit. */
const MODULE_GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gridAutoRows: "1fr", gap: 2, alignItems: "stretch" } as const;

/** A module card's surface: filled and rounder, unlike the outlined cards inside a stage. */
const MODULE_SURFACE = {
  borderRadius: 3,
  bgcolor: (theme: Theme) => `rgba(${theme.vars.palette.primary.mainChannel} / 0.08)`,
} as const;

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : "That did not work. Try again.";
}

/**
 * One strip segment per stage, each opening the module on that stage: filled
 * when complete, and for the first that is not, orange and filled as far as
 * its units are approved.
 */
const StageStrip = observer(function StageStrip({ store, onOpenStage }: { store: Store; onOpenStage: (stage: string) => void }) {
  const stages = store.workflow.stageIds.map((stage) => {
    const summary = store.stageSummary(stage);
    return { stage, label: store.workflow.stage(stage).label, complete: summary.progress === "complete", approved: summary.approved, total: summary.total };
  });
  const edge = stages.find(({ complete }) => !complete) ?? null;
  const completed = stages.filter(({ complete }) => complete).length;
  return (
    <Stack sx={{ gap: 0.75 }}>
      <Stack direction="row" sx={{ gap: 0.5 }}>
        {stages.map(({ stage, label, complete, approved, total }) => {
          const current = stage === edge?.stage;
          const state = complete ? "complete" : current ? `${approved} of ${total} approved` : "not complete";
          const filled = total === 0 ? 0 : (100 * approved) / total;
          return (
            <Tooltip key={stage} title={`Open ${label}: ${state}`}>
              <ButtonBase
                aria-label={`Open ${label}, ${state}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenStage(stage);
                }}
                sx={{
                  flex: 1,
                  height: 14,
                  borderRadius: 7,
                  bgcolor: complete ? "primary.main" : "transparent",
                  ...(current ? { backgroundImage: (theme: Theme) => `linear-gradient(to right, ${theme.vars.palette.warning.main} ${filled}%, transparent ${filled}%)` } : {}),
                  border: 1,
                  borderColor: complete ? "primary.main" : current ? "warning.main" : "divider",
                  "&:hover, &.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 1 },
                }}
              />
            </Tooltip>
          );
        })}
      </Stack>
      <Typography variant="body2">{edge == null ? "Every stage complete" : edge.label}</Typography>
      <Typography variant="caption" color="text.secondary">
        {completed} of {stages.length} stages complete
      </Typography>
    </Stack>
  );
});

/** What in a module waits for the spec owner: units to sign and threads; nothing shows when nothing does. */
const WaitingBadges = observer(function WaitingBadges({ store }: { store: Store }) {
  const waitsForSpecOwner = useWaitsForSpecOwner();
  const toSign = store.workflow.stageIds.reduce((total, stage) => total + Object.values(store.stageSummary(stage).signable).reduce((sum, count) => sum + count, 0), 0);
  const threads = store.threads.filter((thread) => thread.resolution == null && waitsForSpecOwner(thread)).length;
  if (toSign === 0 && threads === 0) return null;
  return (
    <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
      {toSign > 0 && <Chip size="small" color="warning" variant="outlined" label={`${toSign} to sign`} />}
      {threads > 0 && <Chip size="small" color="warning" variant="outlined" label={`${threads} ${threads === 1 ? "thread waits" : "threads wait"}`} />}
    </Stack>
  );
});

/** A module of the list: its name, how far its spec has come and what waits; it opens the module. */
function ModuleCard({ module, onOpen, onError }: { module: ModuleSummary; onOpen: (id: string, stage?: string) => void; onError: (message: string) => void }) {
  const { moduleStore, renameModule, archiveModule } = useProject();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const store = moduleStore(module.id);
  const archive = () => {
    setMenuAnchor(null);
    archiveModule(module.id).catch((caught: unknown) => onError(errorText(caught)));
  };
  return (
    <Paper
      elevation={0}
      role="button"
      tabIndex={0}
      aria-label={`Open ${module.name}`}
      onClick={() => {
        if (!renaming) onOpen(module.id);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen(module.id);
      }}
      sx={{
        ...MODULE_SURFACE,
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        cursor: "pointer",
        outline: "none",
        "&:hover": { bgcolor: (theme) => `rgba(${theme.vars.palette.primary.mainChannel} / 0.14)` },
        "&:focus-visible": { boxShadow: (theme) => `0 0 0 2px ${theme.vars.palette.primary.main}` },
      }}
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, minWidth: 0 }}>
        {renaming ? (
          <Box sx={{ flexGrow: 1 }} onClick={(event) => event.stopPropagation()}>
            <NameField name={module.name} label="Module" rename={(name) => renameModule(module.id, name)} onDone={() => setRenaming(false)} />
          </Box>
        ) : (
          <Typography variant="h6" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {module.name}
          </Typography>
        )}
        {module.active && <Chip size="small" color="primary" label="Open" />}
        <ModuleWorkingSign moduleId={module.id} />
        <IconButton
          size="small"
          aria-label={`Actions for ${module.name}`}
          onClick={(event) => {
            event.stopPropagation();
            setMenuAnchor(event.currentTarget);
          }}
        >
          <MoreVert fontSize="small" />
        </IconButton>
      </Stack>
      {store != null && <StageStrip store={store} onOpenStage={(stage) => onOpen(module.id, stage)} />}
      {store != null && <WaitingBadges store={store} />}
      <Menu anchorEl={menuAnchor} open={menuAnchor != null} onClose={() => setMenuAnchor(null)} onClick={(event) => event.stopPropagation()}>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            setRenaming(true);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem disabled={module.active} onClick={archive}>
          <ListItemText primary="Archive" secondary={module.active ? "Open another module first" : null} />
        </MenuItem>
      </Menu>
    </Paper>
  );
}

/** The field that adds a module; Enter adds, Escape cancels. */
function NewModuleCard({ onError }: { onError: (message: string | null) => void }) {
  const { addModule } = useProject();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    try {
      await addModule(draft);
      setDraft("");
      setAdding(false);
      setError(null);
      onError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  if (!adding) {
    return (
      <Button
        startIcon={<Add />}
        onClick={() => setAdding(true)}
        sx={{ ...MODULE_SURFACE, bgcolor: "transparent", border: 2, borderStyle: "dashed", borderColor: (theme: Theme) => `rgba(${theme.vars.palette.primary.mainChannel} / 0.5)`, height: "100%" }}
      >
        New module
      </Button>
    );
  }
  return (
    <Paper elevation={0} sx={{ ...MODULE_SURFACE, p: 2 }}>
      <TextField
        autoFocus
        fullWidth
        size="small"
        label="Module name"
        value={draft}
        error={error != null}
        helperText={error}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") void add();
          if (event.key === "Escape") {
            event.stopPropagation();
            setAdding(false);
            setError(null);
          }
        }}
      />
    </Paper>
  );
}

/** The archived modules, each renamable and with a way to bring it back. */
function ArchivedModules({ onError }: { onError: (message: string) => void }) {
  const { archivedModules, bringBackModule, renameModule } = useProject();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  if (archivedModules.length === 0) return null;
  return (
    <Stack sx={{ gap: 1 }}>
      <Button sx={{ alignSelf: "flex-start" }} onClick={() => setOpen((shown) => !shown)}>
        {open ? "Hide archived modules" : `Archived modules (${archivedModules.length})`}
      </Button>
      {open &&
        archivedModules.map((module) => (
          <Paper key={module.id} variant="outlined" sx={{ px: 2, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
            {renamingId === module.id ? (
              <Box sx={{ flexGrow: 1 }}>
                <NameField name={module.name} label="Module" rename={(name) => renameModule(module.id, name)} onDone={() => setRenamingId(null)} />
              </Box>
            ) : (
              <>
                <Typography noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                  {module.name}
                </Typography>
                <RenameButton name={module.name} label="Module" onClick={() => setRenamingId(module.id)} />
              </>
            )}
            <Button size="small" onClick={() => bringBackModule(module.id).catch((caught: unknown) => onError(errorText(caught)))}>
              Bring back
            </Button>
          </Paper>
        ))}
    </Stack>
  );
}

/** The product's modules as cards, each opening its module, with the archived ones on request. */
export default function ModulesPage({ onOpen }: { onOpen: (id: string, stage?: string) => void }) {
  const { activeProject, modules } = useProject();
  const [error, setError] = useState<string | null>(null);
  return (
    <Stack sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: { xs: 2, md: 3 }, py: 3, gap: 3 }}>
      <Typography variant="h5">{activeProject?.name} modules</Typography>
      {error != null && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}
      <Box sx={MODULE_GRID}>
        {modules.map((module) => (
          <ModuleCard key={module.id} module={module} onOpen={onOpen} onError={setError} />
        ))}
        <NewModuleCard onError={setError} />
      </Box>
      <ArchivedModules onError={setError} />
    </Stack>
  );
}
