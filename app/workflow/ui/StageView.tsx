"use client";

import { Add, Delete, Edit, MenuBook, Restore } from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, useCallback, useRef, useState } from "react";

import type { CoverageState, ImpactState, ItemState } from "../module";
import { revisionOf, type ItemVersion } from "../records";
import { LINK_REASON_LABELS, STAGE_PROGRESS_LABELS, WAITING_CATEGORY_LABELS } from "../units";
import { perform, useWorkflowView } from "./context";
import ItemEditor, { itemExcerpt } from "./ItemEditor";
import ThreadPanel from "./ThreadPanel";
import UnitFrame, { SignatureLine } from "./UnitFrame";
import VersionDiff from "./VersionDiff";

/** How the page names an item this module links to: its code here, or "Module/CODE" in another module. */
function useLinkName(): (id: string) => string {
  const { module } = useWorkflowView();
  return (id: string) => {
    const own = module.codeOf(id);
    if (own != null) return own;
    for (const linked of module.linkedModules) {
      const code = linked.lookup.codeOf(id);
      if (code != null) return `${linked.name}/${code}`;
    }
    return "a removed item";
  };
}

interface CardControls {
  composing: string | null;
  setComposing: (unitId: string | null) => void;
  sign: (unitId: string) => void;
  stageOpen: boolean;
}

function Fields({ kind, version }: { kind: string; version: ItemVersion }) {
  const { workflow } = useWorkflowView();
  return (
    <Stack spacing={0.5}>
      {workflow.kind(kind).fields.map((field) => {
        const value = version.content[field.name];
        if (value == null || value === "") return null;
        return field.type === "priority" ? (
          <Chip key={field.name} size="small" label={value.toUpperCase()} sx={{ alignSelf: "flex-start" }} />
        ) : (
          <Typography key={field.name} variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
            {value}
          </Typography>
        );
      })}
    </Stack>
  );
}

function Links({ version }: { version: ItemVersion }) {
  const name = useLinkName();
  if (version.references.length === 0 && version.dependencies.length === 0) return null;
  return (
    <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 1, alignItems: "center" }}>
      {version.references.length > 0 && <Typography variant="caption" color="text.secondary">References</Typography>}
      {version.references.map((id) => <Chip key={id} size="small" variant="outlined" label={name(id)} />)}
      {version.dependencies.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>Depends on</Typography>}
      {version.dependencies.map((id) => <Chip key={id} size="small" variant="outlined" label={name(id)} />)}
    </Stack>
  );
}

const ItemCard = observer(function ItemCard({ state, controls }: { state: ItemState; controls: CardControls }) {
  const { module, workflow } = useWorkflowView();
  const name = useLinkName();
  const [editing, setEditing] = useState(false);
  const definition = workflow.kind(state.itemKind);
  const dependents = module.dependentsOutOfDate(state.itemId);
  const unreferenced = module.stagesNotReferencing(state.itemId);
  const signed = state.signature?.version ?? null;
  const changedSinceSigned = signed != null && revisionOf(signed) !== state.revision;
  const removed = state.phase === "removed";
  const waitingImpacts = removed
    ? workflow.stageIds.filter((stage) => module.impactStates(stage).some(({ itemId }) => itemId === state.itemId))
    : [];
  return (
    <UnitFrame
      unitId={state.unitId}
      title={
        <Stack direction="row" sx={{ alignItems: "baseline", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{state.code}</Typography>
          <Typography variant="caption" color="text.secondary">{definition.label}</Typography>
        </Stack>
      }
      approved={state.approved}
      reasons={removed ? [] : state.reasons}
      signable={module.isSignable(state.unitId)}
      signLabel={state.phase === "proposed-removal" ? "Sign removal" : state.outOfDate && state.signatureCounts ? "Sign as it is" : "Sign"}
      stageOpen={controls.stageOpen}
      composing={controls.composing === state.unitId}
      onComposingChange={(composing) => controls.setComposing(composing ? state.unitId : null)}
      onSign={() => controls.sign(state.unitId)}
      actions={
        controls.stageOpen && !removed && (
          <>
            {state.phase === "active" && (
              <Button size="small" startIcon={<Edit />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {state.phase === "active" && (
              <Button size="small" startIcon={<Delete />} onClick={() => void perform(() => module.writeItems([{ type: "remove", item: state.itemId }]), "The item could not be removed.")}>
                Remove
              </Button>
            )}
            {state.signature != null && (changedSinceSigned || state.phase === "proposed-removal") && (
              <Button size="small" startIcon={<Restore />} onClick={() => void perform(() => module.restoreSigned(state.itemId), "The signed version could not be restored.")}>
                Return to the signed version
              </Button>
            )}
          </>
        )
      }
    >
      {state.phase === "proposed-removal" && <Alert severity="warning" sx={{ mb: 1 }}>Proposed for removal: signing removes it.</Alert>}
      {removed && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Removed. It leaves the stage once every impact on its removal is signed
          {waitingImpacts.length > 0 ? `, in ${waitingImpacts.map((stage) => workflow.stage(stage).label).join(" and ")}` : ""}.
        </Alert>
      )}
      {editing ? (
        <ItemEditor stage={state.stage} kind={state.itemKind} itemId={state.itemId} onDone={() => setEditing(false)} />
      ) : (
        <>
          <Fields kind={state.itemKind} version={state.version} />
          <Links version={state.version} />
        </>
      )}
      {state.outOfDateCauses.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Out of date because {state.outOfDateCauses.map((cause) => `${name(cause.id)} is ${cause.reasons.map((reason) => LINK_REASON_LABELS[reason]).join(" and ")}`).join("; ")}.
        </Alert>
      )}
      {dependents.length > 0 && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
          Makes out of date: {dependents.map(({ module: moduleName, code }) => (moduleName == null ? code : `${moduleName}/${code}`)).join(", ")}
        </Typography>
      )}
      {unreferenced.length > 0 && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
          No item of {unreferenced.map((stage) => workflow.stage(stage).label).join(" or ")} references it.
        </Typography>
      )}
      <Box sx={{ mt: 1 }}>
        {signed == null ? (
          <Chip size="small" color="info" label="New: never signed" />
        ) : (
          <>
            <SignatureLine signature={state.signature} counts={state.signatureCounts} />
            {state.phase === "active" && changedSinceSigned && (
              <VersionDiff
                signed={signed}
                current={state.version}
                fieldLabel={(field) => definition.fields.find(({ name: fieldName }) => fieldName === field)?.label ?? field}
                name={name}
              />
            )}
          </>
        )}
      </Box>
    </UnitFrame>
  );
});

const CoverageCard = observer(function CoverageCard({ state, controls }: { state: CoverageState; controls: CardControls }) {
  const { module, workflow } = useWorkflowView();
  const covered = module.versionOf(state.itemId);
  const kind = module.locate(state.itemId)?.item.kind;
  return (
    <UnitFrame
      unitId={state.unitId}
      title={<Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Coverage of {module.codeOf(state.itemId)}</Typography>}
      approved={state.approved}
      reasons={state.reasons}
      signable={module.isSignable(state.unitId)}
      signLabel="Sign: fully covered"
      stageOpen={controls.stageOpen}
      composing={controls.composing === state.unitId}
      onComposingChange={(composing) => controls.setComposing(composing ? state.unitId : null)}
      onSign={() => controls.sign(state.unitId)}
    >
      {covered != null && kind != null && <Fields kind={kind} version={covered} />}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Signing confirms that the items of {workflow.stage(state.stage).label} referencing it cover it fully.
      </Typography>
      {state.referencing.length === 0 ? (
        <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>No item references it.</Typography>
      ) : (
        <Stack spacing={0.25} sx={{ mt: 0.5 }}>
          {state.referencing.map((id) => (
            <Typography key={id} variant="body2">
              <b>{module.codeOf(id)}</b> {itemExcerpt(module.versionOf(id)!.content)}
            </Typography>
          ))}
        </Stack>
      )}
      <Box sx={{ mt: 1 }}>
        <SignatureLine signature={state.signature} counts={state.signatureCounts} />
      </Box>
    </UnitFrame>
  );
});

const ImpactCard = observer(function ImpactCard({ state, controls }: { state: ImpactState; controls: CardControls }) {
  const { module, workflow } = useWorkflowView();
  const name = useLinkName();
  const kind = module.locate(state.itemId)?.item.kind ?? null;
  const [requesting, setRequesting] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const label = module.unitLabel(state.unitId).replace(/^impact of /, "");
  const candidates = module.itemsOf(state.stage).filter(({ removal }) => removal == null);
  const request = async () => {
    if (target == null) return;
    const sent = await perform(
      () => module.requestChange(target, `Reference ${label}: this item relies on its ${state.after == null ? "removal" : "change"} without referencing it.`),
      "The change request could not be sent.",
    );
    if (sent) {
      setRequesting(false);
      setTarget(null);
    }
  };
  const fieldLabel = (field: string) => (kind == null ? field : workflow.kind(kind).fields.find(({ name: fieldName }) => fieldName === field)?.label ?? field);
  return (
    <UnitFrame
      unitId={state.unitId}
      title={<Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Impact of {state.after == null ? `the removal of ${label}` : `the change to ${label}`}</Typography>}
      approved={state.approved}
      reasons={state.reasons}
      signable={module.isSignable(state.unitId)}
      signLabel="Sign: nothing relies on it unreferenced"
      stageOpen={controls.stageOpen}
      composing={controls.composing === state.unitId}
      onComposingChange={(composing) => controls.setComposing(composing ? state.unitId : null)}
      onSign={() => controls.sign(state.unitId)}
      actions={
        controls.stageOpen && (
          <Button size="small" onClick={() => setRequesting(!requesting)}>
            Request a missing reference
          </Button>
        )
      }
    >
      <Typography variant="body2" color="text.secondary">
        Signing confirms that no approved item of {workflow.stage(state.stage).label} relies on this {state.after == null ? "removal" : "change"} without referencing {label}.
      </Typography>
      <Stack direction={{ xs: "column", md: "row" }} sx={{ gap: 2, mt: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary">As it was</Typography>
          {kind == null ? (
            <Typography variant="body1">{itemExcerpt(state.before.content)}</Typography>
          ) : (
            <Fields kind={kind} version={state.before} />
          )}
          <Links version={state.before} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary">{state.after == null ? "Removed" : "As it is now"}</Typography>
          {state.after != null && kind != null && (
            <>
              <Fields kind={kind} version={state.after} />
              <Links version={state.after} />
            </>
          )}
        </Box>
      </Stack>
      {state.after != null && <Box sx={{ mt: 1 }}><VersionDiff signed={state.before} current={state.after} fieldLabel={fieldLabel} name={name} /></Box>}
      {requesting && (
        <Stack direction="row" sx={{ gap: 1, mt: 1, alignItems: "center" }}>
          <Autocomplete
            size="small"
            sx={{ minWidth: 320 }}
            options={candidates.map(({ id }) => id)}
            getOptionLabel={(id) => `${module.codeOf(id)} ${itemExcerpt(module.versionOf(id)?.content ?? {})}`}
            value={target}
            onChange={(_event, value) => setTarget(value)}
            renderInput={(params) => <TextField {...params} label="Item missing the reference" />}
          />
          <Button size="small" variant="contained" disabled={target == null} onClick={() => void request()}>
            Request
          </Button>
        </Stack>
      )}
      <Box sx={{ mt: 1 }}>
        <SignatureLine signature={state.signature} counts={state.signatureCounts} />
      </Box>
    </UnitFrame>
  );
});

function RulesDialog({ stage, open, onClose }: { stage: string; open: boolean; onClose: () => void }) {
  const { workflow } = useWorkflowView();
  const definition = workflow.stage(stage);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{definition.label}: published rules</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {definition.buildsOn.length === 0
            ? "Builds on no stage."
            : `Builds on ${definition.buildsOn
                .map(({ stage: basis, covers }) => `${workflow.stage(basis).label}${covers.length === 0 ? "" : `, covering its ${covers.map((kind) => workflow.kind(kind).plural.toLowerCase()).join(" and ")}`}`)
                .join("; ")}.`}
        </Typography>
        <Typography variant="body2" component="div" sx={{ whiteSpace: "pre-wrap" }}>
          {definition.rules}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * One stage: its state, progress and what waits for a signature, its
 * published rules, its items, coverages and impacts, and the threads whose
 * unit is gone. J and K move between units, S signs the focused one and C
 * opens a change request on it.
 */
const StageView = observer(function StageView({ stage }: { stage: string }) {
  const { module, workflow } = useWorkflowView();
  const definition = workflow.stage(stage);
  const summary = module.stageSummary(stage);
  const units = module.stageUnits(stage);
  const removedItems = module.itemsOf(stage).filter((item) => module.itemState(item.id)?.phase === "removed");
  const orphanThreads = module.threadsOfStage(stage).filter(({ unitId }) => module.unitState(unitId) == null);
  const [composing, setComposing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const cards = useCallback(
    () => Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-unit-card]") ?? []),
    [],
  );

  const focusedUnit = (): string | null => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-unit-card]") : null;
    return active?.dataset.unitCard ?? null;
  };

  const sign = async (unitId: string) => {
    if (!(await perform(() => module.sign(unitId), "The signature could not be given."))) return;
    const all = cards();
    const index = all.findIndex((card) => card.dataset.unitCard === unitId);
    const ordered = [...all.slice(index + 1), ...all.slice(0, Math.max(index, 0))];
    const next = ordered.find((card) => module.unitState(card.dataset.unitCard!)?.approved === false);
    next?.focus();
    next?.scrollIntoView({ block: "nearest" });
  };

  const move = (direction: 1 | -1) => {
    const all = cards();
    if (all.length === 0) return;
    const index = all.findIndex((card) => card.dataset.unitCard === focusedUnit());
    const next = all[index === -1 ? (direction === 1 ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, index + direction))];
    next?.focus();
    next?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isEditable(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const unit = focusedUnit();
    switch (event.key) {
      case "j":
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "k":
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "s":
        if (unit != null && module.isSignable(unit)) {
          event.preventDefault();
          void sign(unit);
        }
        return;
      case "c":
        if (unit != null && summary.open && module.unitState(unit) != null) {
          event.preventDefault();
          setComposing(unit);
        }
        return;
    }
  };

  const controls: CardControls = { composing, setComposing, sign: (unitId) => void sign(unitId), stageOpen: summary.open };
  const waitingParts = (Object.entries(WAITING_CATEGORY_LABELS) as [keyof typeof WAITING_CATEGORY_LABELS, string][])
    .filter(([category]) => summary.waiting[category] > 0)
    .map(([category, label]) => `${summary.waiting[category]} ${label}`);
  if (summary.waiting.coverages > 0) waitingParts.push(`${summary.waiting.coverages} ${summary.waiting.coverages === 1 ? "coverage" : "coverages"}`);
  if (summary.waiting.impacts > 0) waitingParts.push(`${summary.waiting.impacts} ${summary.waiting.impacts === 1 ? "impact" : "impacts"}`);
  const coverages = units.filter((unit): unit is CoverageState => unit.kind === "coverage");
  const impacts = units.filter((unit): unit is ImpactState => unit.kind === "impact");
  const items = units.filter((unit): unit is ItemState => unit.kind === "item");

  return (
    <Box ref={containerRef} onKeyDown={onKeyDown} sx={{ flexGrow: 1, minWidth: 0, overflowY: "auto", p: 2 }}>
      <Stack spacing={1} sx={{ mb: 2 }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="h5" sx={{ flexGrow: 1 }}>{definition.label}</Typography>
          <Chip label={summary.open ? "Open" : "Closed"} color={summary.open ? "primary" : "default"} variant="outlined" />
          <Chip label={STAGE_PROGRESS_LABELS[summary.progress]} color={summary.progress === "complete" ? "success" : summary.progress === "empty" ? "default" : "warning"} />
          <Button startIcon={<MenuBook />} onClick={() => setRulesOpen(true)}>
            Rules
          </Button>
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          <LinearProgress
            variant="determinate"
            value={summary.total === 0 ? 0 : (summary.approved / summary.total) * 100}
            color={summary.progress === "complete" ? "success" : "primary"}
            sx={{ flexGrow: 1, height: 10, borderRadius: 5 }}
          />
          <Typography variant="subtitle2">
            {summary.approved} of {summary.total} approved
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {waitingParts.length === 0 ? "Nothing waits for a signature." : `Waiting for a signature: ${waitingParts.join(", ")}.`}
          {summary.threadsWaitingForSpecOwner > 0 ? ` ${summary.threadsWaitingForSpecOwner} ${summary.threadsWaitingForSpecOwner === 1 ? "thread waits" : "threads wait"} for you.` : ""}
        </Typography>
        {!summary.open && (
          <Alert severity="info">
            Closed until {workflow.upstreamStages(stage).filter((upstream) => !module.stageComplete(upstream)).map((upstream) => workflow.stage(upstream).label).join(" and ")} {workflow.upstreamStages(stage).filter((upstream) => !module.stageComplete(upstream)).length === 1 ? "is" : "are"} complete. Its work stays readable.
          </Alert>
        )}
      </Stack>

      <Stack spacing={1.5}>
        {items.map((state) => <ItemCard key={state.unitId} state={state} controls={controls} />)}
        {removedItems.map((item) => <ItemCard key={item.id} state={module.itemState(item.id)!} controls={controls} />)}
        {summary.open && (
          <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
            {definition.kinds
              .filter((kind) => !kind.single || !module.itemsOf(stage).some((item) => item.kind === kind.kind && item.removal == null))
              .map((kind) => (
                <Button key={kind.kind} startIcon={<Add />} variant={adding === kind.kind ? "contained" : "outlined"} onClick={() => setAdding(adding === kind.kind ? null : kind.kind)}>
                  Add {kind.label.toLowerCase()}
                </Button>
              ))}
          </Stack>
        )}
        {adding != null && summary.open && <ItemEditor stage={stage} kind={adding} itemId={null} onDone={() => setAdding(null)} />}

        {coverages.length > 0 && <Typography variant="h6" sx={{ pt: 2 }}>Coverage</Typography>}
        {coverages.map((state) => <CoverageCard key={state.unitId} state={state} controls={controls} />)}

        {impacts.length > 0 && <Typography variant="h6" sx={{ pt: 2 }}>Impacts</Typography>}
        {impacts.map((state) => <ImpactCard key={state.unitId} state={state} controls={controls} />)}

        {orphanThreads.length > 0 && <Typography variant="h6" sx={{ pt: 2 }}>Threads on removed units</Typography>}
        {orphanThreads.map((thread) => (
          <Box key={thread.id}>
            <Typography variant="subtitle2">{thread.removedUnit ?? module.unitLabel(thread.unitId)}</Typography>
            <ThreadPanel unitId={null} threads={[thread]} stageOpen={summary.open} composing={false} onComposingChange={() => {}} />
          </Box>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 3 }}>
        Keyboard: J or ↓ next, K or ↑ previous, S sign, C request a change.
      </Typography>
      <RulesDialog stage={stage} open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </Box>
  );
});

export default StageView;
