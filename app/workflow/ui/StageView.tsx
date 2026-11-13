"use client";

import { Add, Delete, Edit, KeyboardArrowDown, KeyboardArrowUp, MenuBook, Restore, Send } from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Badge,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { Fragment, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { signShortcut, threadShortcut } from "actions/actions";
import { autoScrollBehavior } from "lib/scroll";

import { type FieldDefinition, itemsFields, type Workflow } from "../definition";
import type { CoverageState, ImpactState, ItemState, OutOfDateCause, UnitState, WorkflowModule } from "../module";
import { revisionOf, textValue, type ItemVersion } from "../records";
import { mentionMarkup } from "../threads";
import { STAGE_PROGRESS_LABELS, WAITING_CATEGORY_LABELS } from "../units";
import { answeringSx } from "./answering";
import { perform, type RevealRequest, useWorkflowNavigation, useWorkflowView } from "./context";
import ItemChip, { ItemOption, useItemLabel } from "./ItemChip";
import ItemEditor, { type EditorTarget } from "./ItemEditor";
import ThreadPanel from "./ThreadPanel";
import ThreadView, { useThreadForm } from "./ThreadView";
import UnitFrame, { SignatureLine } from "./UnitFrame";
import VersionDiff from "./VersionDiff";
import WrittenText from "./WrittenText";

interface CardControls {
  openThread: (unitId: string, anchor: HTMLElement) => void;
  edit: (itemId: string) => void;
  sign: (unitId: string) => void;
  stageOpen: boolean;
}

/** The colours that tell the options of a cued choice field apart, by the option's position. */
const CUE_COLORS = ["info", "secondary", "warning", "success", "error", "primary"] as const;

/** Each choice field's value of an item's version, such as its priority, as chips; an option of a cued field in a colour of its own. */
function ChoiceChips({ kind, version }: { kind: string; version: ItemVersion }) {
  const { workflow } = useWorkflowView();
  const choices = workflow.kind(kind).fields.flatMap((field) => (field.type === "choice" && textValue(version.content[field.name]) !== "" ? [field] : []));
  return choices.map((field) => {
    const value = textValue(version.content[field.name]);
    const position = field.options.indexOf(value);
    const cue = field.cued && position >= 0 ? CUE_COLORS[position % CUE_COLORS.length] : undefined;
    return <Chip key={field.name} size="small" label={value} color={cue} variant={cue == null ? "filled" : "outlined"} sx={{ alignSelf: "flex-start" }} />;
  });
}

/** An item's version as it reads, with each choice field's value under it unless the card shows them in its header. */
function Fields({ kind, version, choices = true }: { kind: string; version: ItemVersion; choices?: boolean }) {
  const { module, workflow } = useWorkflowView();
  const marks = module.marksOf(kind, version.content);
  const prefix = workflow.prefixOf(kind);
  return (
    <Stack spacing={0.5}>
      <WrittenText text={module.displayOf(kind, version.content)} variant="body1" lead={prefix ?? undefined} />
      {choices && <ChoiceChips kind={kind} version={version} />}
      {marks.map((mark) => (
        <Chip key={mark} size="small" color="warning" variant="outlined" label={mark} sx={{ alignSelf: "flex-start" }} />
      ))}
    </Stack>
  );
}

/**
 * Every item a version of an item links to, each as a chip: those its
 * items fields choose, under each field's label, then those it lists and
 * those it counts as linking to without listing them. With `causes`, each
 * chip of an item that makes it out of date says why.
 */
function Links({ kind, itemId, version, causes = [] }: { kind: string | null; itemId: string | null; version: ItemVersion; causes?: readonly OutOfDateCause[] }) {
  const { module } = useWorkflowView();
  const chosen = kind == null ? [] : module.chosenOf(kind, version.content);
  const shown = new Set(chosen.flatMap(({ items }) => items.map(({ id }) => id)));
  const links = kind == null
    ? { references: version.references, countedReferences: [], dependencies: version.dependencies, countedDependencies: [] }
    : module.linksOfVersion(kind, version, itemId);
  const groups: { label: string; items: { id: string; detail?: string }[] }[] = [
    ...chosen.map(({ label, items }) => ({ label, items: items.map(({ id, name }) => ({ id, detail: name })) })),
    { label: "References", items: links.references.map((id) => ({ id })) },
    { label: "Counts as referencing", items: links.countedReferences.filter((id) => !shown.has(id)).map((id) => ({ id })) },
    { label: "Depends on", items: links.dependencies.map((id) => ({ id })) },
    { label: "Counts as depending on", items: links.countedDependencies.filter((id) => !shown.has(id)).map((id) => ({ id })) },
  ].filter(({ items }) => items.length > 0);
  if (groups.length === 0) return null;
  return (
    <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 1, alignItems: "center" }}>
      {groups.map(({ label, items }, index) => (
        <Fragment key={label}>
          <Typography variant="caption" color="text.secondary" sx={{ ml: index === 0 ? 0 : 1 }}>{label}</Typography>
          {items.map((item) => {
            const cause = causes.find(({ id }) => id === item.id);
            return <ItemChip key={item.id} itemId={item.id} detail={item.detail} reasons={cause?.reasons} change={cause?.change} />;
          })}
        </Fragment>
      ))}
    </Stack>
  );
}

/** Each item that makes an out-of-date item out of date, and why, one per line. */
function CauseLines({ causes }: { causes: readonly OutOfDateCause[] }) {
  const label = useItemLabel();
  return (
    <Stack spacing={0.25}>
      {causes.map((cause) => (
        <Typography key={cause.id} variant="caption">{label(cause.id, { reasons: cause.reasons })}</Typography>
      ))}
    </Stack>
  );
}

const ItemCard = observer(function ItemCard({ state, controls }: { state: ItemState; controls: CardControls }) {
  const { module, workflow } = useWorkflowView();
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
      labels={<ChoiceChips kind={state.itemKind} version={state.version} />}
      approved={state.approved}
      reasons={removed ? [] : state.reasons}
      reasonNotes={state.outOfDateCauses.length === 0 ? {} : { "out-of-date": <CauseLines causes={state.outOfDateCauses} /> }}
      signable={module.isSignable(state.unitId)}
      signLabel={state.phase === "proposed-removal" ? "Sign removal" : state.outOfDate && state.signatureCounts ? "Sign as it is" : "Sign"}
      stageOpen={controls.stageOpen}
      onOpenThread={(anchor) => controls.openThread(state.unitId, anchor)}
      onSign={() => controls.sign(state.unitId)}
      actions={
        controls.stageOpen && !removed && (
          <>
            {state.phase === "active" && (
              <Button size="small" startIcon={<Edit />} onClick={() => controls.edit(state.itemId)}>
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
      <Fields kind={state.itemKind} version={state.version} choices={false} />
      <Links kind={state.itemKind} itemId={state.itemId} version={state.version} causes={state.outOfDateCauses} />
      {dependents.length > 0 && (
        <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 1, alignItems: "center" }}>
          <Typography variant="body2" color="warning.main">Makes out of date</Typography>
          {dependents.map(({ id }) => <ItemChip key={id} itemId={id} />)}
        </Stack>
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
              <VersionDiff kind={state.itemKind} signed={signed} current={state.version} />
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
      title={
        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Coverage of</Typography>
          <ItemChip itemId={state.itemId} />
        </Stack>
      }
      approved={state.approved}
      reasons={state.reasons}
      signable={module.isSignable(state.unitId)}
      signLabel="Sign: fully covered"
      stageOpen={controls.stageOpen}
      onOpenThread={(anchor) => controls.openThread(state.unitId, anchor)}
      onSign={() => controls.sign(state.unitId)}
    >
      {covered != null && kind != null && <Fields kind={kind} version={covered} />}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Signing confirms that these items of {workflow.stage(state.stage).label} referencing it cover it fully:
      </Typography>
      {state.referencing.length === 0 ? (
        <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>No item references it.</Typography>
      ) : (
        <Stack direction="row" sx={{ mt: 0.5, gap: 0.5, flexWrap: "wrap" }}>
          {state.referencing.map((id) => <ItemChip key={id} itemId={id} />)}
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
  const kind = module.locate(state.itemId)?.item.kind ?? null;
  const [requesting, setRequesting] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const label = module.unitLabel(state.unitId).replace(/^impact of /, "");
  const named = module.namedItem(state.itemId);
  const candidates = module.itemsOf(state.stage).filter(({ removal }) => removal == null);
  const request = async () => {
    if (target == null) return;
    const changed = named == null ? label : mentionMarkup(named.name, named.id);
    const sent = await perform(
      () => module.requestChange(target, `Reference ${changed}: this item relies on its ${state.after == null ? "removal" : "change"} without referencing it.`),
      "The change request could not be sent.",
    );
    if (sent) {
      setRequesting(false);
      setTarget(null);
    }
  };
  return (
    <UnitFrame
      unitId={state.unitId}
      title={
        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Impact of {state.after == null ? "the removal of" : "the change to"}{kind == null ? ` ${label}` : ""}</Typography>
          {kind != null && <ItemChip itemId={state.itemId} />}
        </Stack>
      }
      approved={state.approved}
      reasons={state.reasons}
      signable={module.isSignable(state.unitId)}
      signLabel="Sign: nothing relies on it unreferenced"
      stageOpen={controls.stageOpen}
      onOpenThread={(anchor) => controls.openThread(state.unitId, anchor)}
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
            <Typography variant="body1">{label}</Typography>
          ) : (
            <Fields kind={kind} version={state.before} />
          )}
          <Links kind={kind} itemId={state.itemId} version={state.before} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary">{state.after == null ? "Removed" : "As it is now"}</Typography>
          {state.after != null && kind != null && (
            <>
              <Fields kind={kind} version={state.after} />
              <Links kind={kind} itemId={state.itemId} version={state.after} />
            </>
          )}
        </Box>
      </Stack>
      {state.after != null && kind != null && <Box sx={{ mt: 1 }}><VersionDiff kind={kind} signed={state.before} current={state.after} /></Box>}
      {requesting && (
        <Stack direction="row" sx={{ gap: 1, mt: 1, alignItems: "center" }}>
          <Autocomplete
            size="small"
            sx={{ minWidth: 320 }}
            options={candidates.map(({ id }) => id)}
            getOptionLabel={(id) => `${module.codeOf(id)} ${module.textOf(id)}`}
            renderValue={(id) => <ItemChip itemId={id} opens={false} />}
            renderOption={({ key, ...props }, id) => <li key={key} {...props}><ItemOption itemId={id} /></li>}
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

function RuleFields({ fields, depth = 0 }: { fields: readonly FieldDefinition[]; depth?: number }) {
  return (
    <Stack spacing={0.5} sx={{ pl: depth === 0 ? 2 : 1 }}>
      {fields.map((field) => (
        <Box key={field.name}>
          <Typography variant="body2">
            <Box component="span" sx={{ fontWeight: 600 }}>{field.label}</Box> ({field.required ? "required" : "optional"}): {field.description}
          </Typography>
          {(field.type === "record" || field.type === "records") && <RuleFields fields={field.fields} depth={depth + 1} />}
        </Box>
      ))}
    </Stack>
  );
}

function RuleList({ rules }: { rules: readonly string[] }) {
  return (
    <Box component="ul" sx={{ pl: 3, my: 0 }}>
      {rules.map((rule, index) => (
        <Typography key={index} component="li" variant="body2" sx={{ mb: 1 }}>
          {rule}
        </Typography>
      ))}
    </Box>
  );
}

/** One item of an example, as it is shown. */
function ExampleText({ text }: { text: string }) {
  return (
    <Box sx={{ pl: 2, py: 0.5, borderLeft: 2, borderColor: "divider" }}>
      <WrittenText text={text} />
    </Box>
  );
}

/** A name with "a" or "an" in front. */
function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

/** A list of kinds as a sentence names them, such as "user stories, quality goals or constraints". */
function namedKinds(names: readonly string[], joiner: "and" | "or"): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} ${joiner} ${names.at(-1)}`;
}

/** One kind's published rules: its question first, then its stage's place, its fields and links, its rules, the shared rules and its examples. */
function RulesDialog({ stage, kind, open, onClose }: { stage: string; kind: string; open: boolean; onClose: () => void }) {
  const { workflow } = useWorkflowView();
  const stageDefinition = workflow.stage(stage);
  const definition = workflow.kind(kind);
  const published = workflow.publishedRules(kind);
  const label = (name: string) => workflow.kind(name).label.toLowerCase();
  const plural = (name: string) => workflow.kind(name).plural.toLowerCase();
  const links = new Set([
    ...(definition.covers == null ? [] : [`Its items give the coverage of the ${namedKinds(definition.covers.map(plural), "and")}.`]),
    ...(definition.mustReference == null ? [] : [`Each references at least one ${namedKinds(definition.mustReference.map(label), "or")}.`]),
    ...itemsFields(definition.fields).map(
      (field) => `Each counts as ${workflow.stageOfKind(field.of) === stage ? "depending on" : "referencing"} the ${plural(field.of)} its ${field.label} field chooses, without listing them.`,
    ),
    ...(definition.mayNotReference ?? []).map((name) => `Each references no ${label(name)}.`),
    ...(definition.referencesSingle ?? []).map((name) => `Each counts as referencing the ${label(name)}, without listing it.`),
    ...(definition.dependsOnSingle ?? []).map((name) => `Each counts as depending on the ${label(name)}, without listing it.`),
  ]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{definition.plural}: published rules</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle1">The question {definition.single ? "it answers" : "each answers"}</Typography>
        <Typography variant="body1" sx={{ fontWeight: 600, mb: 2 }}>{published.question}</Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {stageDefinition.buildsOn.length === 0
            ? `${stageDefinition.label} builds on no stage.`
            : `${stageDefinition.label} builds on ${namedKinds(stageDefinition.buildsOn.map((basis) => workflow.stage(basis).label), "and")}.`}
          {` Code ${definition.code}${definition.single ? ", one item only" : ""}.`}
        </Typography>
        {[...links].map((line) => (
          <Typography key={line} variant="body2" sx={{ mb: 1 }}>{line}</Typography>
        ))}
        <Typography variant="subtitle1" sx={{ mt: 2 }}>Fields</Typography>
        <RuleFields fields={definition.fields} />
        {published.rules.length > 0 && (
          <>
            <Typography variant="subtitle1" sx={{ mt: 2 }}>Rules</Typography>
            <RuleList rules={published.rules} />
          </>
        )}
        <Typography variant="subtitle1" sx={{ mt: 2 }}>Rules of every kind</Typography>
        <RuleList rules={published.shared} />
        <Typography variant="subtitle1" sx={{ mt: 2 }}>Examples</Typography>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="subtitle2" color="success.main" sx={{ "&::first-letter": { textTransform: "uppercase" } }}>{withArticle(label(kind))}</Typography>
            <ExampleText text={published.examples.good.text} />
            {published.examples.good.details != null && (
              <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>{published.examples.good.details}</Typography>
            )}
          </Box>
          {published.examples.traps.map((trap, index) => (
            <Box key={index}>
              <Typography variant="subtitle2" color="error.main" sx={{ "&::first-letter": { textTransform: "uppercase" } }}>
                {trap.kind === kind ? `a wrong ${label(kind)}` : `${withArticle(label(trap.kind))} that could pass for ${withArticle(label(kind))}`}
              </Typography>
              <ExampleText text={trap.text} />
              <Typography variant="body2" color="text.secondary" sx={{ pl: 2, mt: 0.5 }}>{trap.why}</Typography>
            </Box>
          ))}
        </Stack>
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
 * The kind whose tab shows a unit: an item's own kind, and a coverage's
 * covering kind. An impact belongs to the whole stage, so to no one tab.
 */
function tabOf(module: WorkflowModule, workflow: Workflow, unit: UnitState): string | null {
  switch (unit.kind) {
    case "item":
      return unit.itemKind;
    case "coverage": {
      const covered = module.locate(unit.itemId)?.item.kind;
      return covered == null ? null : workflow.coveringKind(unit.stage, covered);
    }
    case "impact":
      return null;
  }
}

/**
 * One stage: its state, progress and what waits for a signature, and, for
 * a stage holding several kinds, one tab per kind under them that stays in
 * view. A tab shows its kind's published rules, its items and the
 * coverages they give; every tab shows the stage's impacts and the threads
 * whose unit is gone. j and k move between the units shown, Shift+J and
 * Shift+K between those that wait for a signature, g and Shift+G to the
 * first and last, s signs the focused one (Shift+S then moves to the next
 * unit that waits for a signature) and c opens its threads, where a change
 * request is written. An open thread shows beside its card, docked at the
 * right, where it follows the focused card, or full screen on a narrow
 * screen.
 */
const StageView = observer(function StageView({ stage }: { stage: string }) {
  const { module, workflow } = useWorkflowView();
  const definition = workflow.stage(stage);
  const summary = module.stageSummary(stage);
  const tabbed = definition.kinds.length > 1;
  const [shownKind, setShownKind] = useState(definition.kinds[0]!.kind);
  /** Whether the shown tab holds a unit: every unit while the stage has no tabs. */
  const inShownTab = (unit: UnitState) => {
    const tab = tabOf(module, workflow, unit);
    return tab == null || tab === shownKind;
  };
  const allUnits = module.stageUnits(stage);
  const units = allUnits.filter(inShownTab);
  const removedItems = module.itemsOf(stage).filter((item) => item.kind === shownKind && module.itemState(item.id)?.phase === "removed");
  const orphanThreads = module.threadsOfStage(stage).filter(({ unitId }) => module.unitState(unitId) == null);
  /** The unit whose threads are open, where the overlay shows, and whether its box takes the focus. */
  const [thread, setThread] = useState<{ unitId: string; anchor: HTMLElement | null; autoFocus: boolean } | null>(null);
  const [chosenForm, setChosenForm] = useThreadForm();
  const narrow = useMediaQuery((theme) => theme.breakpoints.down("md"));
  const threadForm = narrow ? "full" : chosenForm;
  /** The item being written in the side panel, and the target asked for while it has unsaved changes. */
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [pendingEditor, setPendingEditor] = useState<{ next: EditorTarget | null } | null>(null);
  const editorDirty = useRef(false);
  const onEditorDirtyChange = useCallback((dirty: boolean) => {
    editorDirty.current = dirty;
  }, []);
  /** Opens, switches or closes the side panel, asking first when that would discard unsaved changes. */
  const requestEditor = (next: EditorTarget | null) => {
    if (editor != null && editorDirty.current) {
      setPendingEditor({ next });
      return;
    }
    editorDirty.current = false;
    setPendingEditor(null);
    setEditor(next);
  };
  const [rulesOpen, setRulesOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  /** The action that completed this stage, for this visit only: the page offers writing the next stage until the person leaves. */
  const [completedOn, setCompletedOn] = useState<{ module: WorkflowModule; stage: string } | null>(null);
  const complete = summary.progress === "complete";
  const justCompleted = complete && completedOn?.module === module && completedOn.stage === stage;
  /** The last progress seen, so the transition to complete is noticed once, whatever action made it. */
  const seen = useRef({ module, stage, complete });
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // A completion belongs to the visit that saw it: leaving the stage, switching module, or no longer being complete forgets it.
  useEffect(() => {
    const previous = seen.current;
    seen.current = { module, stage, complete };
    if (previous.module !== module || previous.stage !== stage) {
      setCompletedOn(null);
    } else if (complete !== previous.complete) {
      setCompletedOn(complete ? { module, stage } : null);
    }
  }, [module, stage, complete]);

  /**
   * Focus a unit's card and scroll it into view clear of the sticky header, with a margin on either side.
   * With `actionsAt`, the card's actions are put at that height instead, so they land where the
   * pointer already is, unless that would hide the top of the card under the header.
   */
  const reveal = (card: HTMLElement | undefined, actionsAt?: number) => {
    const container = containerRef.current;
    if (card == null || container == null) return;
    card.focus({ preventScroll: true });
    const margin = 16;
    const top = (headerRef.current ?? container).getBoundingClientRect().bottom + margin;
    const bottom = container.getBoundingClientRect().bottom - margin;
    const { top: cardTop, bottom: cardBottom } = card.getBoundingClientRect();
    const actions = card.querySelector("[data-unit-actions]");
    const behavior = autoScrollBehavior();
    if (actionsAt != null && actions != null) {
      container.scrollBy({ top: Math.min(actions.getBoundingClientRect().top - actionsAt, cardTop - top), behavior });
    } else if (cardTop < top) container.scrollBy({ top: cardTop - top, behavior });
    else if (cardBottom > bottom) container.scrollBy({ top: Math.min(cardBottom - bottom, cardTop - top), behavior });
  };

  /** Where a unit's actions are on screen now, if its card is shown. */
  const actionsTopOf = (unitId: string): number | undefined =>
    cards()
      .find((card) => card.dataset.unitCard === unitId)
      ?.querySelector("[data-unit-actions]")
      ?.getBoundingClientRect().top;

  // The gap between the two thresholds keeps the header from flickering as its own height changes.
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const scrolled = event.currentTarget.scrollTop;
    if (!compact && scrolled > 64) setCompact(true);
    else if (compact && scrolled < 8) setCompact(false);
  };

  const cards = useCallback(
    () => Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-unit-card]") ?? []),
    [],
  );

  const focusedUnit = (): string | null => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-unit-card]") : null;
    return active?.dataset.unitCard ?? null;
  };

  /** Sign a unit, then move to the next unit that is not approved, or with `toWaiting` the next that waits for a signature. */
  const sign = async (unitId: string, toWaiting = false) => {
    const actionsAt = actionsTopOf(unitId);
    // The order the person saw: a signature can move its own unit, such as a removed item to the end of the list.
    const orderBefore = cards().map((card) => card.dataset.unitCard!);
    if (!(await perform(() => module.sign(unitId), "The signature could not be given."))) return;
    // Find and measure the next card once the page has redrawn after the signature, so it is a card still on the page.
    requestAnimationFrame(() => {
      const shown = new Map(cards().map((card) => [card.dataset.unitCard!, card]));
      const index = orderBefore.indexOf(unitId);
      const ordered = [...orderBefore.slice(index + 1), ...orderBefore.slice(0, Math.max(index, 0))];
      const next = ordered.flatMap((id) => shown.get(id) ?? []).find((card) => {
        const state = module.unitState(card.dataset.unitCard!);
        return state != null && (toWaiting ? module.waitsForSignature(state) : !state.approved);
      });
      reveal(next, actionsAt);
    });
  };

  const move = (direction: 1 | -1) => {
    const all = cards();
    if (all.length === 0) return;
    const index = all.findIndex((card) => card.dataset.unitCard === focusedUnit());
    const next = all[index === -1 ? (direction === 1 ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, index + direction))];
    reveal(next);
  };

  /** Move to the next or previous unit that waits for a signature, wrapping around the stage. */
  const moveToWaiting = (direction: 1 | -1) => {
    const all = cards();
    const index = all.findIndex((card) => card.dataset.unitCard === focusedUnit());
    const ordered = direction === 1 ? [...all.slice(index + 1), ...all.slice(0, index + 1)] : [...all.slice(0, Math.max(index, 0)).reverse(), ...all.slice(Math.max(index, 0)).reverse()];
    const next = ordered.find((card) => {
      const state = module.unitState(card.dataset.unitCard!);
      return state != null && module.waitsForSignature(state);
    });
    reveal(next);
  };

  const openThread = (unitId: string, anchor: HTMLElement | null, autoFocus = true) => setThread({ unitId, anchor, autoFocus });

  /** Close the open thread and give the focus back to its card. */
  const closeThread = () => {
    const unitId = thread?.unitId;
    setThread(null);
    cards().find((card) => card.dataset.unitCard === unitId)?.focus({ preventScroll: true });
  };

  /** A docked thread follows the card that takes the focus; a thread shown over the stage closes, as it does on a click away. */
  const followFocus = (target: EventTarget) => {
    if (thread == null || !(target instanceof HTMLElement)) return;
    const unitId = target.closest<HTMLElement>("[data-unit-card]")?.dataset.unitCard;
    if (unitId == null || unitId === thread.unitId) return;
    setThread(threadForm === "docked" ? { unitId, anchor: null, autoFocus: false } : null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isEditable(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    // Keys act wherever the focus is on the page, except in a dialog or menu outside the stage, which has keys of its own.
    const inStage = event.target instanceof Node && containerRef.current?.contains(event.target) === true;
    if (!inStage && event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]') != null) return;
    const unit = focusedUnit();
    switch (event.key) {
      case "g":
      case "G": {
        event.preventDefault();
        const all = cards();
        const target = event.key === "g" ? all[0] : all.at(-1);
        reveal(target);
        return;
      }
      case "J":
        event.preventDefault();
        moveToWaiting(1);
        return;
      case "K":
        event.preventDefault();
        moveToWaiting(-1);
        return;
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
      case signShortcut.key:
      case signShortcut.key.toUpperCase():
        if (unit != null && module.isSignable(unit)) {
          event.preventDefault();
          void sign(unit, event.shiftKey);
        }
        return;
      case threadShortcut.key:
        if (unit != null && module.unitState(unit) != null && (summary.open || module.threadsOf(unit).length > 0)) {
          event.preventDefault();
          const card = cards().find((candidate) => candidate.dataset.unitCard === unit);
          openThread(unit, card?.querySelector<HTMLElement>("[data-unit-actions]") ?? card ?? null);
        }
        return;
    }
  };

  // An item opened where it is named, or a unit or thread message returned
  // to by the browser's history, is revealed once its card shows; a thread
  // message, in its thread, opened beside the card.
  const { revealRequest, revealed } = useWorkflowNavigation();
  // A unit to reveal in another tab shows once its tab does.
  useEffect(() => {
    if (revealRequest == null) return;
    const requested = module.unitState(revealRequest.unitId);
    const tab = requested == null || requested.stage !== stage ? null : tabOf(module, workflow, requested);
    if (tab != null) setShownKind(tab);
  }, [revealRequest, module, stage, workflow]);
  // A thread message stays to reveal until its thread, once it shows, has given it the focus.
  const messageToFocus = revealRequest?.message ?? null;
  const messageFocused = useCallback(() => {
    if (revealRequest != null) revealed(revealRequest);
  }, [revealRequest, revealed]);
  const handledRequest = useRef<RevealRequest | null>(null);
  useEffect(() => {
    if (revealRequest == null || handledRequest.current === revealRequest) return;
    const { unitId, message } = revealRequest;
    if (message != null && module.unitState(unitId) == null) {
      // The threads of a removed unit show in its stage itself, and focus the message there.
      handledRequest.current = revealRequest;
      if (!orphanThreads.some(({ id }) => id === message.threadId)) revealed(revealRequest);
      return;
    }
    const card = cards().find((candidate) => candidate.dataset.unitCard === unitId);
    if (card == null) return;
    handledRequest.current = revealRequest;
    if (message == null) {
      revealed(revealRequest);
      reveal(card);
    } else if (thread?.unitId !== unitId) {
      reveal(card);
      openThread(unitId, card.querySelector<HTMLElement>("[data-unit-actions]") ?? card, false);
    }
  });

  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDownRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // The cards keep the same controls while the stage stays open or closed, so
  // a change renders only the cards it changes; the handlers are the latest.
  const handlers = useRef({ openThread, requestEditor, sign });
  handlers.current = { openThread, requestEditor, sign };
  const stageOpen = summary.open;
  const controls = useMemo<CardControls>(
    () => ({
      openThread: (unitId, anchor) => handlers.current.openThread(unitId, anchor),
      edit: (itemId) => handlers.current.requestEditor({ stage, kind: module.itemState(itemId)!.itemKind, itemId }),
      sign: (unitId) => void handlers.current.sign(unitId),
      stageOpen,
    }),
    [stage, module, stageOpen],
  );
  const waitingParts = (Object.entries(WAITING_CATEGORY_LABELS) as [keyof typeof WAITING_CATEGORY_LABELS, string][])
    .filter(([category]) => summary.waiting[category] > 0)
    .map(([category, label]) => `${summary.waiting[category]} ${label}`);
  if (summary.waiting.coverages > 0) waitingParts.push(`${summary.waiting.coverages} ${summary.waiting.coverages === 1 ? "coverage" : "coverages"}`);
  if (summary.waiting.impacts > 0) waitingParts.push(`${summary.waiting.impacts} ${summary.waiting.impacts === 1 ? "impact" : "impacts"}`);
  const coverages = units.filter((unit): unit is CoverageState => unit.kind === "coverage");
  const impacts = units.filter((unit): unit is ImpactState => unit.kind === "impact");
  const items = units.filter((unit): unit is ItemState => unit.kind === "item");
  const waitingShown = units.some((unit) => module.waitsForSignature(unit));
  // Besides the stages offered while empty, a sign that completes this stage offers writing the stages that build on it.
  const stagesOffered = new Set(module.stagesToWriteAfter(stage));
  if (justCompleted && summary.progress === "complete") {
    for (const later of workflow.stagesBuildingOn(stage)) {
      if (module.stageOpen(later) && !module.stageComplete(later)) stagesOffered.add(later);
    }
  }
  const stagesToWrite = workflow.stageIds.filter((later) => stagesOffered.has(later));
  const progressBar = (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexGrow: 1 }}>
      <LinearProgress
        variant="determinate"
        value={summary.total === 0 ? 0 : (summary.approved / summary.total) * 100}
        color={summary.progress === "complete" ? "success" : "primary"}
        sx={{ flexGrow: 1, height: compact ? 6 : 10, borderRadius: 5 }}
      />
      <Typography variant="subtitle2" sx={{ whiteSpace: "nowrap" }}>
        {summary.approved} of {summary.total} approved
      </Typography>
      <Tooltip title="Previous unit waiting for a signature (Shift+K)">
        <span><IconButton size="small" aria-label="Previous unit waiting for a signature" disabled={!waitingShown} onClick={() => moveToWaiting(-1)}><KeyboardArrowUp fontSize="small" /></IconButton></span>
      </Tooltip>
      <Tooltip title="Next unit waiting for a signature (Shift+J)">
        <span><IconButton size="small" aria-label="Next unit waiting for a signature" disabled={!waitingShown} onClick={() => moveToWaiting(1)}><KeyboardArrowDown fontSize="small" /></IconButton></span>
      </Tooltip>
    </Stack>
  );
  const rulesButton = (
    <Button size={compact || tabbed ? "small" : "medium"} startIcon={<MenuBook />} onClick={() => setRulesOpen(true)}>
      {tabbed ? `Rules of ${workflow.kind(shownKind).plural.toLowerCase()}` : "Rules"}
    </Button>
  );
  /** Each tab's label: its kind, and, on a tab not shown, a badge counting its units not approved, which keep the stage from completing. */
  const tabLabel = (kind: string) => {
    const notApproved = allUnits.filter((unit) => tabOf(module, workflow, unit) === kind && !unit.approved).length;
    const plural = workflow.kind(kind).plural;
    return (
      <Badge
        color="warning"
        badgeContent={notApproved}
        invisible={kind === shownKind || notApproved === 0}
        aria-label={kind !== shownKind && notApproved > 0 ? `${plural}, ${notApproved} not approved` : plural}
        sx={{ pr: kind !== shownKind && notApproved > 0 ? 2 : 0, "& .MuiBadge-badge": { right: 0, top: "50%", transform: "translateY(-50%)" } }}
      >
        {plural}
      </Badge>
    );
  };

  return (
    <Stack direction="row" sx={{ flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      <Box ref={containerRef} onScroll={onScroll} onFocus={(event) => followFocus(event.target)} sx={{ flexGrow: 1, minWidth: 0, overflowY: "auto", p: 2, pt: 0 }}>
        <Stack
          ref={headerRef}
          spacing={compact ? 0.5 : 1}
          sx={{ position: "sticky", top: 0, zIndex: 2, bgcolor: "background.default", mx: -2, px: 2, pt: compact ? 1 : 2, pb: compact ? 1.5 : 2, mb: compact ? 1.5 : 0, borderBottom: 1, borderColor: compact ? "divider" : "transparent" }}
        >
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography variant={compact ? "subtitle1" : "h5"} sx={{ flexGrow: compact ? 0 : 1 }}>{definition.label}</Typography>
            {compact && progressBar}
            <Chip size={compact ? "small" : "medium"} label={summary.open ? "Open" : "Closed"} color={summary.open ? "primary" : "default"} variant="outlined" />
            <Chip size={compact ? "small" : "medium"} label={STAGE_PROGRESS_LABELS[summary.progress]} color={summary.progress === "complete" ? "success" : summary.progress === "empty" ? "default" : "warning"} />
            {!tabbed && rulesButton}
          </Stack>
          {!compact && progressBar}
          <Typography variant="body2" color="text.secondary">
            {waitingParts.length === 0 ? "Nothing waits for a signature." : `Waiting for a signature: ${waitingParts.join(", ")}.`}
            {summary.threadsWaitingForSpecOwner > 0 ? ` ${summary.threadsWaitingForSpecOwner} ${summary.threadsWaitingForSpecOwner === 1 ? "thread waits" : "threads wait"} for you.` : ""}
          </Typography>
          {stagesToWrite.map((later) => {
            const asked = module.writingAskedOfAnswerer.some((ask) => ask.stage === later);
            const writing = module.isBeingWritten(later);
            const label = workflow.stage(later).label;
            return (
              <Box key={later}>
                <Button
                  size="small"
                  variant={asked ? "outlined" : "contained"}
                  startIcon={<Send />}
                  disabled={asked}
                  aria-busy={writing || undefined}
                  sx={writing ? answeringSx : undefined}
                  onClick={() => void perform(() => module.askToWrite(later), "The coding agent could not be asked.")}
                >
                  {writing ? `The coding agent is writing ${label}` : asked ? `Asked the coding agent to write ${label}` : `Ask the coding agent to write ${label}`}
                </Button>
              </Box>
            );
          })}
          {!summary.open && !compact && (
            <Alert severity="info">
              Closed until {workflow.upstreamStages(stage).filter((upstream) => !module.stageComplete(upstream)).map((upstream) => workflow.stage(upstream).label).join(" and ")} {workflow.upstreamStages(stage).filter((upstream) => !module.stageComplete(upstream)).length === 1 ? "is" : "are"} complete. Its work stays readable.
            </Alert>
          )}
          {tabbed && (
            <Stack direction="row" sx={{ alignItems: "center", gap: 1, borderBottom: 1, borderColor: "divider" }}>
              <Tabs value={shownKind} onChange={(_event, kind: string) => setShownKind(kind)} variant="scrollable" scrollButtons="auto" sx={{ flexGrow: 1, minHeight: 40 }}>
                {definition.kinds.map((kind) => (
                  <Tab key={kind.kind} value={kind.kind} label={tabLabel(kind.kind)} sx={{ minHeight: 40, textTransform: "none" }} />
                ))}
              </Tabs>
              {rulesButton}
            </Stack>
          )}
        </Stack>

        <Stack spacing={1.5}>
          {items.map((state) => <ItemCard key={state.unitId} state={state} controls={controls} />)}
          {removedItems.map((item) => <ItemCard key={item.id} state={module.itemState(item.id)!} controls={controls} />)}
          {summary.open && (
            <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
              {definition.kinds
                .filter((kind) => kind.kind === shownKind && (!kind.single || !module.itemsOf(stage).some((item) => item.kind === kind.kind && item.removal == null)))
                .map((kind) => (
                  <Button key={kind.kind} startIcon={<Add />} variant={editor?.itemId == null && editor?.kind === kind.kind ? "contained" : "outlined"} onClick={() => requestEditor({ stage, kind: kind.kind, itemId: null })}>
                    Add {kind.label.toLowerCase()}
                  </Button>
                ))}
            </Stack>
          )}

          {coverages.length > 0 && <Typography variant="h6" sx={{ pt: 2 }}>Coverage</Typography>}
          {coverages.map((state) => <CoverageCard key={state.unitId} state={state} controls={controls} />)}

          {impacts.length > 0 && <Typography variant="h6" sx={{ pt: 2 }}>Impacts</Typography>}
          {impacts.map((state) => <ImpactCard key={state.unitId} state={state} controls={controls} />)}

          {orphanThreads.length > 0 && <Typography variant="h6" sx={{ pt: 2 }}>Threads on removed units</Typography>}
          {orphanThreads.map((orphan) => (
            <Box key={orphan.id}>
              <Typography variant="subtitle2">{orphan.removedUnit ?? module.unitLabel(orphan.unitId)}</Typography>
              <Paper variant="outlined" sx={{ p: 1.5, mt: 1 }}>
                <ThreadPanel
                  unitId={null}
                  threads={[orphan]}
                  stageOpen={summary.open}
                  focusMessage={messageToFocus}
                  onMessageFocused={messageFocused}
                />
              </Paper>
            </Box>
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 3 }}>
          Keyboard: j or ↓ next, k or ↑ previous, Shift+J or Shift+K next or previous waiting for a signature, g first, Shift+G last, s sign, Shift+S sign and go to the next waiting for a signature, c open the thread or request a change, Esc close it.
        </Typography>
        <RulesDialog stage={stage} kind={shownKind} open={rulesOpen} onClose={() => setRulesOpen(false)} />
      </Box>
      {thread != null && module.unitState(thread.unitId) != null && (
        <ThreadView
          unitId={thread.unitId}
          form={threadForm}
          anchor={thread.anchor}
          stageOpen={summary.open}
          autoFocus={thread.autoFocus}
          focusMessage={messageToFocus}
          onMessageFocused={messageFocused}
          onDock={() => setChosenForm("docked")}
          onClose={() => {
            if (threadForm === "docked") setChosenForm("overlay");
            closeThread();
          }}
        />
      )}
      {editor != null && (
        <ItemEditor
          key={`${editor.kind}:${editor.itemId ?? "new"}`}
          target={editor}
          full={narrow}
          confirmingDiscard={pendingEditor != null}
          onSaved={() => {
            editorDirty.current = false;
            setPendingEditor(null);
            setEditor(null);
          }}
          onCancel={() => requestEditor(null)}
          onDiscard={() => {
            editorDirty.current = false;
            setEditor(pendingEditor?.next ?? null);
            setPendingEditor(null);
          }}
          onKeepEditing={() => setPendingEditor(null)}
          onDirtyChange={onEditorDirtyChange}
        />
      )}
    </Stack>
  );
});

export default StageView;
