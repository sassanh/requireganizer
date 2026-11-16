"use client";

import { Box, CircularProgress, Tooltip, Typography } from "@mui/material";
import { Fragment, type ReactElement, useEffect, useState } from "react";

import type { AskDifference, ModuleChange, ModuleDifference, PreviewTarget, StateDifference, ThreadDifference, UnitDifference } from "history";
import { getUserFacingErrorMessage } from "lib/errors";
import { useProject } from "projectContext";
import { WORKFLOW } from "store";

/** What a list reads: what a step changed, or what bringing an earlier state back would change. */
type Reading = "step" | "bringing back";

const CHANGE_SIGNS: Record<UnitDifference["change"], { sign: string; color: string; name: Record<Reading, string> }> = {
  add: { sign: "+", color: "success.main", name: { step: "added", "bringing back": "would be added" } },
  change: { sign: "~", color: "warning.main", name: { step: "changed", "bringing back": "would change" } },
  remove: { sign: "−", color: "error.main", name: { step: "removed", "bringing back": "would be removed" } },
};

const MODULE_SIGNS: Record<ModuleChange, { sign: string; color: string; name: Record<Reading, string> }> = {
  add: { sign: "+", color: "success.main", name: { step: "added", "bringing back": "would be added" } },
  remove: { sign: "−", color: "error.main", name: { step: "removed", "bringing back": "would be removed" } },
  archive: { sign: "−", color: "error.main", name: { step: "archived", "bringing back": "would be archived" } },
  "bring back": { sign: "+", color: "success.main", name: { step: "brought back from the archive", "bringing back": "would be brought back from the archive" } },
  rename: { sign: "~", color: "warning.main", name: { step: "renamed", "bringing back": "would be renamed" } },
};

const ASK_SIGNS: Record<AskDifference["change"], { sign: string; color: string; name: Record<Reading, string> }> = {
  ask: { sign: "+", color: "success.main", name: { step: "asked of the coding agent", "bringing back": "would be asked of the coding agent" } },
  withdraw: { sign: "−", color: "error.main", name: { step: "no longer asked of the coding agent", "bringing back": "would no longer be asked of the coding agent" } },
};

/**
 * A module as a change to it names it. A renamed one reads from its name in
 * the state compared with, before a step or now, to the other one's.
 */
function moduleLabel(module: ModuleDifference): string {
  return module.change === "rename" ? `${module.nameNow} → ${module.nameThen}` : module.nameThen;
}

/** What of a changed unit differs, as the list names it. */
export function differingParts(unit: Extract<UnitDifference, { change: "change" }>): string {
  return [unit.content ? "text" : null, unit.signature ? "signature" : null, unit.threads ? "threads" : null, unit.place == null ? null : "place"]
    .filter((part) => part != null)
    .join(", ");
}

/**
 * What a step added, changed or removed, or what bringing an earlier state
 * back would, each by its module, its stage and its code, and each thread
 * on a removed item by what that item said, grouped by stage under its
 * module where the project has several.
 */
export default function DifferenceList({
  difference,
  withModules,
  reading,
}: {
  difference: StateDifference;
  withModules: boolean;
  reading: Reading;
}) {
  const projectWide = difference.modules.length > 0 || difference.modulesEnabled != null;
  if (!projectWide && difference.asks.length === 0 && difference.units.length === 0 && difference.threads.length === 0) {
    if (reading === "step") return null;
    return (
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {difference.same ? "Same as now" : "Nothing it lists differs from now"}
      </Typography>
    );
  }
  const groups: { module: string; moduleName: string; stage: string; asks: AskDifference[]; units: UnitDifference[]; threads: ThreadDifference[] }[] = [];
  const groupOf = (moduleId: string, moduleName: string, stage: string) => {
    let group = groups.find((entry) => entry.module === moduleId && entry.stage === stage);
    if (group == null) {
      group = { module: moduleId, moduleName, stage, asks: [], units: [], threads: [] };
      groups.push(group);
    }
    return group;
  };
  for (const ask of difference.asks) groupOf(ask.moduleId, ask.module, ask.stage).asks.push(ask);
  for (const unit of difference.units) groupOf(unit.moduleId, unit.module, unit.stage).units.push(unit);
  for (const thread of difference.threads) groupOf(thread.moduleId, thread.module, thread.stage).threads.push(thread);
  const turned = difference.modulesEnabled == null ? null : `modules ${difference.modulesEnabled ? "on" : "off"}`;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1.5, rowGap: 0.25, mt: 0.5, pl: 1, borderLeft: 2, borderColor: "divider" }}>
      {projectWide && (
        <>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Modules
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0.25, minWidth: 0 }}>
            {turned != null && (
              <Typography variant="caption" sx={{ color: "warning.main", whiteSpace: "nowrap" }} aria-label={reading === "step" ? `Turned ${turned}` : `Would turn ${turned}`}>
                ~ {turned}
              </Typography>
            )}
            {difference.modules.map((module) => {
              const { sign, color, name } = MODULE_SIGNS[module.change];
              return (
                <Typography key={`${module.moduleId} ${module.change}`} variant="caption" sx={{ color, whiteSpace: "nowrap" }} aria-label={`${moduleLabel(module)} ${name[reading]}`}>
                  {sign} {moduleLabel(module)}
                  {module.change === "archive" || module.change === "bring back" ? ` (${name.step})` : ""}
                </Typography>
              );
            })}
          </Box>
        </>
      )}
      {groups.map((group, index) => (
        <Fragment key={`${group.module} ${group.stage}`}>
          {withModules && group.module !== groups[index - 1]?.module && (
            <Typography variant="caption" sx={{ gridColumn: "1 / -1", color: "text.secondary", fontWeight: 600 }}>
              {group.moduleName}
            </Typography>
          )}
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {WORKFLOW.stage(group.stage).label}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0.25, minWidth: 0 }}>
            {group.asks.map((ask) => {
              const { sign, color, name } = ASK_SIGNS[ask.change];
              return (
                <Typography key={`ask ${ask.change}`} variant="caption" sx={{ color, whiteSpace: "nowrap" }} aria-label={`Writing ${WORKFLOW.stage(ask.stage).label} ${name[reading]}`}>
                  {sign} writing it {ask.change === "ask" ? "asked" : "no longer asked"}
                </Typography>
              );
            })}
            {group.units.map((unit) => {
              const { sign, color, name } = CHANGE_SIGNS[unit.change];
              const parts = unit.change === "change" ? ` (${differingParts(unit)})` : "";
              return (
                <Typography key={unit.unitId} variant="caption" sx={{ color, whiteSpace: "nowrap" }} aria-label={`${unit.label} ${name[reading]}${parts}`}>
                  {sign} {unit.label}
                  {parts}
                </Typography>
              );
            })}
            {group.threads.map((thread) => (
              <Tooltip key={thread.threadId} title={thread.text} describeChild>
                <Typography
                  variant="caption"
                  tabIndex={0}
                  sx={{ color: "warning.main", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}
                  aria-label={`The thread on the removed item “${thread.text}” ${CHANGE_SIGNS.change.name[reading]}`}
                >
                  ~ thread on “{thread.text}”
                </Typography>
              </Tooltip>
            ))}
          </Box>
        </Fragment>
      ))}
    </Box>
  );
}

/**
 * The edges a difference overlay keeps within: the window's, not those of
 * the panel that scrolls its button, so it flips or shifts to show whole.
 */
function viewportModifiers() {
  const options = { boundary: document.documentElement, rootBoundary: "viewport" as const, padding: 8 };
  return [
    { name: "flip", options: { ...options, fallbackPlacements: ["bottom", "top"] } },
    { name: "preventOverflow", options: { ...options, altAxis: true } },
  ];
}

/**
 * The button that brings back an earlier state, showing, while pointed at
 * or focused by keyboard, what bringing it back would add, change or
 * remove, read when shown. Escape closes the overlay alone.
 */
export function DifferenceFromNowOverlay({ target, children }: { target: PreviewTarget; children: ReactElement }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [open]);

  return (
    <Tooltip
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      describeChild
      placement="left"
      title={<DifferenceFromNow target={target} />}
      slotProps={{
        popper: { modifiers: open ? viewportModifiers() : [] },
        tooltip: { sx: { maxWidth: "min(440px, calc(100vw - 32px))", maxHeight: "min(480px, calc(100vh - 32px))", overflowY: "auto" } },
      }}
    >
      {children}
    </Tooltip>
  );
}

/** What bringing an earlier state back would add, change or remove, read each time it is shown. */
function DifferenceFromNow({ target }: { target: PreviewTarget }) {
  const { differenceFromNow, modulesEnabled } = useProject();
  const [read, setRead] = useState<{ difference: StateDifference } | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    differenceFromNow(target).then(
      (difference) => {
        if (!cancelled) setRead({ difference });
      },
      (error: unknown) => {
        if (!cancelled) setRead({ error: getUserFacingErrorMessage(error, "Could not compare it with now.") });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [differenceFromNow, target]);

  if (read == null) return <CircularProgress size={16} aria-label="Comparing with now" />;
  if ("error" in read) return <Typography variant="caption">{read.error}</Typography>;
  const { difference } = read;
  const empty = difference.units.length === 0 && difference.threads.length === 0;
  return (
    <>
      {!empty && (
        <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
          Bringing it back would add (+), change (~) or remove (−)
        </Typography>
      )}
      <DifferenceList difference={difference} withModules={modulesEnabled} reading="bringing back" />
    </>
  );
}
