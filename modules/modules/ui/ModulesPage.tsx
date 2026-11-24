"use client";

import { Add, DragIndicator, MoreVert } from "@mui/icons-material";
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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { NameField, RenameButton } from "components/RenameableName";
import { ModuleWorkingSign } from "delegation/ui";
import { isEditableTarget, isOverlayTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";
import type { ModuleSummary } from "modules";
import { useProject } from "projectContext";
import type { Store } from "store";
import { unitInPlaceOf } from "workflow";
import { useWaitsForSpecOwner } from "workflow/ui";

import { arrangeShortcut } from "./shortcuts";

/**
 * The lists of the page a focus can be in, each cell marked with
 * `data-module-cell` set to its list and `data-module-id` to its module,
 * and its element to focus with `data-cell-focus`.
 */
type CellList = "modules" | "new" | "archived";

/** The element to focus in a cell of a list, or null while the cell is not shown. */
function cellFocus(root: HTMLElement, list: CellList, id: string): HTMLElement | null {
  const cell = root.querySelector<HTMLElement>(`[data-module-cell="${list}"][data-module-id="${CSS.escape(id)}"]`);
  if (cell == null) return null;
  return cell.matches("[data-cell-focus]") ? cell : cell.querySelector<HTMLElement>("[data-cell-focus]");
}


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

/** A module of the list: its name, how far its spec has come and what waits; it opens the module, and the open one is framed. */
function ModuleCard({ module, onOpen, onError }: { module: ModuleSummary; onOpen: (id: string, stage?: string) => void; onError: (message: string) => void }) {
  const { moduleStore, renameModule, archiveModule } = useProject();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  /** Rename waits for the menu to close: the menu gives the focus back to its button as it closes, which would close the name field. */
  const renameOnClose = useRef(false);
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
      data-module-cell="modules"
      data-module-id={module.id}
      data-cell-focus
      aria-label={module.active ? `${module.name}, the open module` : `Open ${module.name}`}
      aria-current={module.active ? "true" : undefined}
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
        border: 2,
        borderColor: module.active ? "primary.main" : "transparent",
        "&:hover": { bgcolor: (theme) => `rgba(${theme.vars.palette.primary.mainChannel} / 0.14)` },
        "&:focus-visible": { boxShadow: (theme) => `0 0 0 2px ${theme.vars.palette.primary.main}` },
      }}
    >
      <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1, minWidth: 0 }}>
        {renaming ? (
          <Box sx={{ flexGrow: 1 }} onClick={(event) => event.stopPropagation()}>
            <NameField name={module.name} label="Module" rename={(name) => renameModule(module.id, name)} onDone={() => setRenaming(false)} />
          </Box>
        ) : (
          <Typography variant="h6" sx={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}>
            {module.name}
          </Typography>
        )}
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
      {/* Hidden while empty: most modules are neither open nor worked on. */}
      <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap", alignItems: "center", "&:empty": { display: "none" } }}>
        <ModuleWorkingSign moduleId={module.id} />
      </Stack>
      {store != null && <StageStrip store={store} onOpenStage={(stage) => onOpen(module.id, stage)} />}
      {store != null && <WaitingBadges store={store} />}
      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor != null}
        onClose={() => setMenuAnchor(null)}
        onClick={(event) => event.stopPropagation()}
        slotProps={{
          transition: {
            onExited: () => {
              if (!renameOnClose.current) return;
              renameOnClose.current = false;
              setRenaming(true);
            },
          },
        }}
      >
        <MenuItem
          onClick={() => {
            renameOnClose.current = true;
            setMenuAnchor(null);
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
  return (
    <Box data-module-cell="new" data-module-id="new" sx={{ display: "flex", flexDirection: "column" }}>
      {adding ? (
        <Paper elevation={0} sx={{ ...MODULE_SURFACE, p: 2, flexGrow: 1 }}>
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
      ) : (
        <Button
          data-cell-focus
          startIcon={<Add />}
          onClick={() => setAdding(true)}
          sx={{ ...MODULE_SURFACE, bgcolor: "transparent", border: 2, borderStyle: "dashed", borderColor: (theme: Theme) => `rgba(${theme.vars.palette.primary.mainChannel} / 0.5)`, flexGrow: 1 }}
        >
          New module
        </Button>
      )}
    </Box>
  );
}

/**
 * The module held while arranging, by the pointer or the keyboard, and the
 * place in the list it would take if let go; once let go there, the list it
 * was let go in, whose order shows until the list comes back in the new one.
 */
interface Held {
  id: string;
  place: number;
  by: "pointer" | "keyboard";
  droppedIn: readonly ModuleSummary[] | null;
}

/** Hides text from sight but not from screen readers. */
const VISUALLY_HIDDEN = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

/** How many tiles the grid's first row holds: how far one row up or down moves. */
function columnsOf(grid: HTMLElement): number {
  const tiles = Array.from(grid.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  const firstRow = tiles[0]?.offsetTop;
  return Math.max(1, tiles.filter((tile) => tile.offsetTop === firstRow).length);
}

/** h, j, k and l, which move through the grid as the arrow keys do. */
const LETTER_ARROWS: Readonly<Record<string, string>> = { h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight" };

/**
 * The place in a grid of `count` cells a key moves to from `place`, or null
 * for a key that does not move: the arrows and h, j, k and l by direction,
 * g and Home to the first cell, G and End to the last.
 */
function placeAfterKey(pressed: string, place: number, count: number, columns: number): number | null {
  const key = LETTER_ARROWS[pressed] ?? pressed;
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, place - 1);
    case "ArrowRight":
      return Math.min(count - 1, place + 1);
    case "ArrowUp":
      return place - columns >= 0 ? place - columns : place;
    case "ArrowDown":
      return place + columns < count ? place + columns : place;
    case "Home":
    case "g":
      return 0;
    case "End":
    case "G":
      return count - 1;
    default:
      return null;
  }
}

/** The modules with one moved to `place`, the others keeping their order. */
function withMoved(modules: readonly ModuleSummary[], id: string, place: number): readonly ModuleSummary[] {
  const moved = modules.find((module) => module.id === id);
  if (moved == null) return modules;
  const others = modules.filter((module) => module !== moved);
  return [...others.slice(0, place), moved, ...others.slice(place)];
}

/** The place in the grid a point is over: the tile it is on, or else the nearest one. */
function placeAt(grid: HTMLElement, clientX: number, clientY: number): number | null {
  const bounds = grid.getBoundingClientRect();
  const x = clientX - bounds.left;
  const y = clientY - bounds.top;
  let nearest: { place: number; distance: number } | null = null;
  // Layout offsets, unlike client rectangles, ignore the transforms tiles slide with.
  Array.from(grid.children).forEach((child, place) => {
    if (!(child instanceof HTMLElement)) return;
    const dx = Math.max(child.offsetLeft - x, 0, x - (child.offsetLeft + child.offsetWidth));
    const dy = Math.max(child.offsetTop - y, 0, y - (child.offsetTop + child.offsetHeight));
    const distance = Math.hypot(dx, dy);
    if (nearest == null || distance < nearest.distance) nearest = { place, distance };
  });
  return (nearest as { place: number } | null)?.place ?? null;
}

/** Slide each child of `grid` from where it was to where the new order puts it, unless motion is reduced. */
function useSlidingTiles(grid: React.RefObject<HTMLDivElement | null>, order: string): void {
  const positions = useRef(new Map<string, { left: number; top: number }>());
  useLayoutEffect(() => {
    const element = grid.current;
    if (element == null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const child of Array.from(element.children)) {
      if (!(child instanceof HTMLElement) || child.dataset.moduleId == null) continue;
      const now = { left: child.offsetLeft, top: child.offsetTop };
      const before = positions.current.get(child.dataset.moduleId);
      if (!still && before != null && (before.left !== now.left || before.top !== now.top)) {
        child.animate([{ transform: `translate(${before.left - now.left}px, ${before.top - now.top}px)` }, { transform: "none" }], { duration: 180, easing: "ease-out" });
      }
      positions.current.set(child.dataset.moduleId, now);
    }
  }, [grid, order]);
}

/**
 * The modules as tiles to drag, or to move from the keyboard: Space or Enter
 * picks the focused tile up, the arrow keys, Home and End move it, Space or
 * Enter lets it go and Escape puts it back. The held tile takes the place it
 * is moved to, the others making room, so the list shows the order it would
 * have; letting go keeps that order. Nothing opens while arranging.
 */
function ArrangedModules({
  modules,
  grid,
  tileKeysRef,
  startFocus,
  onError,
}: {
  modules: readonly ModuleSummary[];
  grid: React.RefObject<HTMLDivElement | null>;
  /** Where the tiles' own keys are handed to the page, which hears every key first. */
  tileKeysRef: React.RefObject<((event: KeyboardEvent) => boolean) | null>;
  /** The module whose tile takes the focus as arranging starts, unless the focus is on a tile already. */
  startFocus: string | null;
  onError: (message: string) => void;
}) {
  const { moveModule } = useProject();
  const [kept, setHeld] = useState<Held | null>(null);
  useEffect(() => {
    if (grid.current == null || grid.current.contains(document.activeElement) || startFocus == null) return;
    const tile = Array.from(grid.current.children).find((child) => child instanceof HTMLElement && child.dataset.moduleId === startFocus);
    if (tile instanceof HTMLElement) tile.focus();
    // Only as arranging starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [announcement, setAnnouncement] = useState("");
  const held = kept?.droppedIn != null && kept.droppedIn !== modules ? null : kept;
  const shown = held == null ? modules : withMoved(modules, held.id, held.place);
  const order = shown.map(({ id }) => id).join();
  useSlidingTiles(grid, order);
  /** The tile to give the focus back to once the new order is laid out: moving a tile in the page takes the focus from it. */
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocus.current;
    refocus.current = null;
    if (id == null || grid.current == null) return;
    const tile = Array.from(grid.current.children).find((child) => child instanceof HTMLElement && child.dataset.moduleId === id);
    if (tile instanceof HTMLElement && document.activeElement !== tile) tile.focus();
  }, [grid, order]);
  /** Stops following the pointer of the tile held, while one is. */
  const stopFollowing = useRef<(() => void) | null>(null);
  useEffect(() => () => stopFollowing.current?.(), []);
  /** Let a held module go at `place`, keeping the order shown while the list comes back in it. */
  const drop = (id: string, place: number, by: Held["by"]) => {
    if (place === modules.findIndex((module) => module.id === id)) {
      setHeld(null);
      return;
    }
    setHeld({ id, place, by, droppedIn: modules });
    moveModule(id, place).catch((caught: unknown) => {
      refocus.current = id;
      setHeld(null);
      onError(errorText(caught));
    });
  };
  /**
   * Pick up, let go, move or put back the focused tile from the keyboard;
   * true when the key did one of them. Moving the focus between tiles is the
   * page's, as between cards.
   */
  const onTileKey = (event: KeyboardEvent): boolean => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const index = focused == null || focused.parentElement !== grid.current ? -1 : shown.findIndex(({ id }) => id === focused.dataset.moduleId);
    const tile = shown[index];
    if (tile == null) return false;
    const placeText = (place: number) => `place ${place + 1} of ${modules.length}`;
    if (held == null) {
      if (event.key !== " " && event.key !== "Enter") return false;
      setHeld({ id: tile.id, place: index, by: "keyboard", droppedIn: null });
      setAnnouncement(`Picked up ${tile.name}, ${placeText(index)}. Move it with the arrow keys, Space to drop, Escape to cancel.`);
      return true;
    }
    if (held.id !== tile.id || held.by !== "keyboard" || held.droppedIn != null) return false;
    if (event.key === " " || event.key === "Enter") {
      drop(tile.id, held.place, "keyboard");
      setAnnouncement(`Dropped ${tile.name} at ${placeText(held.place)}.`);
      return true;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") refocus.current = tile.id;
      setHeld(null);
      setAnnouncement(`Put ${tile.name} back at ${placeText(modules.findIndex(({ id }) => id === tile.id))}.`);
      // Tab goes on to move the focus.
      return event.key === "Escape";
    }
    if (grid.current == null) return false;
    const place = placeAfterKey(event.key, held.place, modules.length, columnsOf(grid.current));
    if (place == null) return false;
    if (place !== held.place) {
      refocus.current = tile.id;
      setHeld({ ...held, place });
      setAnnouncement(`${tile.name}, ${placeText(place)}.`);
    }
    return true;
  };
  useLayoutEffect(() => {
    tileKeysRef.current = onTileKey;
  });
  useEffect(
    () => () => {
      tileKeysRef.current = null;
    },
    [tileKeysRef],
  );
  /**
   * Hold a module and follow its pointer on the window, not on its tile:
   * the browser lets go of a pointer held by an element the new order moves.
   */
  const hold = (id: string, start: number, pointerId: number) => {
    let place = start;
    setHeld({ id, place, by: "pointer", droppedIn: null });
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId || grid.current == null) return;
      const over = placeAt(grid.current, event.clientX, event.clientY);
      if (over == null || over === place) return;
      place = over;
      setHeld({ id, place, by: "pointer", droppedIn: null });
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stop();
      if (event.type === "pointercancel") {
        setHeld(null);
        return;
      }
      drop(id, place, "pointer");
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stopFollowing.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    stopFollowing.current = stop;
  };
  return (
    <Stack sx={{ gap: 1.5 }}>
      <Typography variant="body2" color="text.secondary">
        Drag a module to move it, or press Space on it, move it with the arrow keys or H, J, K and L, and press Space again.
      </Typography>
      <Box role="status" aria-live="polite" sx={VISUALLY_HIDDEN}>
        {announcement}
      </Box>
      <Box ref={grid} sx={{ ...MODULE_GRID, position: "relative" }}>
        {shown.map((module, index) => {
          const holding = held?.id === module.id && held.droppedIn == null;
          return (
            <Paper
              key={module.id}
              data-module-cell="modules"
              data-module-id={module.id}
              data-cell-focus
              elevation={holding ? 6 : 0}
              tabIndex={0}
              role="button"
              aria-roledescription="movable module"
              aria-pressed={holding}
              aria-label={`${module.name}, place ${index + 1} of ${shown.length}`}
              onPointerDown={(event) => {
                if (event.button !== 0 || held != null) return;
                event.preventDefault();
                hold(module.id, index, event.pointerId);
              }}
              sx={{
                ...MODULE_SURFACE,
                p: 2,
                display: "flex",
                alignItems: "center",
                gap: 1,
                cursor: holding ? "grabbing" : "grab",
                border: 2,
                borderColor: module.active ? "primary.main" : "transparent",
                touchAction: "none",
                userSelect: "none",
                position: "relative",
                zIndex: holding ? 1 : 0,
                outline: holding ? 2 : 0,
                outlineStyle: "solid",
                outlineColor: "primary.main",
                "&:focus-visible": { boxShadow: (theme) => `0 0 0 2px ${theme.vars.palette.primary.main}` },
              }}
            >
              <DragIndicator fontSize="small" color="action" />
              <Typography variant="h6" sx={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {module.name}
              </Typography>
            </Paper>
          );
        })}
      </Box>
    </Stack>
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
          <Paper key={module.id} data-module-cell="archived" data-module-id={module.id} variant="outlined" sx={{ px: 2, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
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
            <Button size="small" data-cell-focus onClick={() => bringBackModule(module.id).catch((caught: unknown) => onError(errorText(caught)))}>
              Bring back
            </Button>
          </Paper>
        ))}
    </Stack>
  );
}

/**
 * The product's modules as cards in the order the spec owner arranged them,
 * each opening its module, with the archived ones on request; arranging
 * turns the cards into tiles to drag into another order.
 */
export default function ModulesPage({ onOpen }: { onOpen: (id: string, stage?: string) => void }) {
  const { activeProject, modules } = useProject();
  const [error, setError] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const arrangeable = modules.length > 1;
  const page = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const activeId = modules.find((module) => module.active)?.id ?? null;

  // The list opens with the focus on the open module, the one it was opened from.
  useEffect(() => {
    if (activeId != null && page.current != null) cellFocus(page.current, "modules", activeId)?.focus();
    // Only as the page opens: later the focus is the spec owner's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The element with the focus, the cell it is in and the order of that cell's list, as the page last saw them. */
  const focusedRef = useRef<{ element: HTMLElement; list: CellList; id: string; order: string[] } | null>(null);
  const onFocus = (event: React.FocusEvent) => {
    const element = event.target instanceof HTMLElement ? event.target : null;
    // A menu a cell opens is outside the page: the focus is still the cell's.
    if (element == null || page.current?.contains(element) !== true) return;
    const cell = element.closest<HTMLElement>("[data-module-cell]");
    if (cell == null) {
      focusedRef.current = null;
      return;
    }
    const list = cell.dataset.moduleCell as CellList;
    const order = Array.from(page.current.querySelectorAll<HTMLElement>(`[data-module-cell="${list}"]`)).map((each) => each.dataset.moduleId ?? "");
    focusedRef.current = { element, list, id: cell.dataset.moduleId ?? "", order };
  };
  // When the element with the focus is gone, such as a card archived, a row
  // brought back or a name field closed, the focus goes to its cell, else to
  // the cell now in its place in the same list, else to its module in the
  // other list.
  useEffect(() => {
    const root = page.current;
    if (root == null) return;
    const observer = new MutationObserver(() => {
      const focus = focusedRef.current;
      if (focus == null || focus.element.isConnected) return;
      if (document.activeElement != null && document.activeElement !== document.body) return;
      const inPlace = unitInPlaceOf(focus.id, focus.order, (id) => cellFocus(root, focus.list, id) != null);
      const target =
        cellFocus(root, focus.list, focus.id) ??
        (inPlace == null ? null : cellFocus(root, focus.list, inPlace)) ??
        cellFocus(root, focus.list === "archived" ? "modules" : "archived", focus.id);
      target?.focus();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Arranging starts with the focus on the module that has it, else on the open module.
  const [arrangeFocus, setArrangeFocus] = useState<string | null>(null);
  const toggleArranging = useCallback(() => {
    const focus = focusedRef.current;
    setArrangeFocus(focus?.list === "modules" && focus.element === document.activeElement ? focus.id : activeId);
    setArranging((shown) => !shown);
  }, [activeId]);

  // The page hears each key before the rest of the app, so its own keys
  // act here and nowhere else: a held tile's keys first; then the arrows,
  // h, j, k, l, g and G, which move the focus between the cards or the
  // tiles; and Escape, which ends arranging, and else goes back to the open
  // module.
  const tileKeysRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target) || isOverlayTarget(event.target) || grid.current == null) return;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (arranging && tileKeysRef.current?.(event) === true) {
        handled();
        return;
      }
      if (event.key === "Escape" && !event.shiftKey) {
        handled();
        if (arranging) toggleArranging();
        else if (activeId != null) onOpen(activeId);
        return;
      }
      const key = event.key;
      const cells = Array.from(grid.current.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      const current = cells.findIndex((cell) => cell.contains(document.activeElement));
      // With the focus on no card, Home and End scroll the page, g and G go to the first and last card, and the other keys to the open module.
      const fromNowhere = current === -1;
      if (fromNowhere && (key === "Home" || key === "End")) return;
      const place = placeAfterKey(key, fromNowhere ? 0 : current, cells.length, columnsOf(grid.current));
      if (place == null) return;
      handled();
      const toOpenModule = fromNowhere && key !== "g" && key !== "G";
      const cell = toOpenModule ? cells.find((candidate) => candidate.dataset.moduleId === activeId) : cells[place];
      (cell?.matches("[data-cell-focus]") ? cell : cell?.querySelector<HTMLElement>("[data-cell-focus]"))?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeId, arranging, toggleArranging, onOpen]);

  const arrangeBinding = useMemo<ShortcutBinding>(
    () => ({
      id: "arrange-modules",
      ...arrangeShortcut,
      when: (event) => arrangeable && !isEditableTarget(event.target) && !isOverlayTarget(event.target),
      action: toggleArranging,
    }),
    [arrangeable, toggleArranging],
  );
  useShortcut(arrangeBinding);

  return (
    <Stack ref={page} onFocus={onFocus} sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: { xs: 2, md: 3 }, py: 3, gap: 3 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 2 }}>
        <Typography variant="h5" sx={{ flexGrow: 1, minWidth: 0 }}>
          {activeProject?.name} modules
        </Typography>
        {arrangeable && (
          <ActionTooltip name={arranging ? "Done arranging" : "Arrange modules"} shortcut={arrangeShortcut}>
            <Button variant={arranging ? "contained" : "text"} onClick={toggleArranging}>
              {arranging ? "Done" : "Arrange"}
            </Button>
          </ActionTooltip>
        )}
      </Stack>
      {error != null && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}
      {arranging && arrangeable ? (
        <ArrangedModules modules={modules} grid={grid} tileKeysRef={tileKeysRef} startFocus={arrangeFocus} onError={setError} />
      ) : (
        <>
          <Box ref={grid} sx={MODULE_GRID}>
            {modules.map((module) => (
              <ModuleCard key={module.id} module={module} onOpen={onOpen} onError={setError} />
            ))}
            <NewModuleCard onError={setError} />
          </Box>
          <ArchivedModules onError={setError} />
        </>
      )}
    </Stack>
  );
}
