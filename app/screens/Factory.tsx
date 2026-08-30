import {
  CheckBox,
  NewReleases,
  Timer,
} from "@mui/icons-material";
import { TabContext, TabList } from "@mui/lab";
import {
  Box,
  Stack,
  Tab,
  type TabProps,
} from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { AnimatePresence, motion } from "motion/react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { AnimatedTabPanel, artifactElementId, SectionHeader, StructuralFragments, TestCaseScenarioAccordions, TestScenarioList } from "components";
import {
  HIGHLIGHT_HOLD_MILLISECONDS,
  HIGHLIGHT_MILLISECONDS,
  useStagedContent,
} from "components/changeQueue";
import { ITEM_MOTION_SECONDS } from "components/itemMotion";
import { scrollIntoViewWithMargin } from "components/scrollFollower";
import { StagedTextField } from "components/TextChange";
import {
  claim,
  complete,
  getPresentationTick,
  getPresentationVersion,
  getPresentingNavigate,
  isPresenting,
  noteVisibleStep,
  setPresentationNav,
  subscribePresentation,
  useShownStore,
} from "presentation";
import { WORKFLOW_STAGE_LABELS, Status, WorkflowStage, StructuralFragment, useStore } from "store";
import { commitTimelineSegment } from "store/timeline/controller";
import { isEnumMember } from "utilities";

import AutomatedTests from "./AutomatedTests";
import BoundaryDesign from "./BoundaryDesign";
import CodePlaceholder from "./CodePlaceholder";
import InterfaceContracts from "./InterfaceContracts";
import ProductOverview from "./ProductOverview";
import ProjectSetup from "./ProjectSetup";
import type { Store } from "../store/store";

const ICONS = {
  [Status.Pending]: Timer,
  [Status.Outdated]: NewReleases,
  [Status.Completed]: CheckBox,
};

const ICON_COLOR = {
  [Status.Pending]: "text.disabled",
  [Status.Outdated]: "warning.main",
  [Status.Completed]: "success.main",
} as const;

function SlidingStatusIcon({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const Icon = ICONS[status];
  const slide = isPresenting();
  return (
    <Box
      aria-hidden
      className={className}
      sx={{
        position: "relative",
        width: 24,
        height: 24,
        overflow: "hidden",
        flexShrink: 0,
        display: "inline-flex",
      }}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={status}
          initial={slide ? { y: "-100%" } : false}
          animate={{ y: 0 }}
          exit={{
            y: slide ? "100%" : 0,
            transition: { duration: slide ? ITEM_MOTION_SECONDS : 0 },
          }}
          transition={{
            duration: slide ? ITEM_MOTION_SECONDS : 0,
            ease: "easeInOut",
          }}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon sx={{ color: ICON_COLOR[status] }} />
        </motion.span>
      </AnimatePresence>
    </Box>
  );
}

function factoryTabNode(step: WorkflowStage): HTMLElement | null {
  return document.querySelector(`[data-factory-tab="${step}"]`);
}

const FactoryTab = observer(function FactoryTab({
  tabStep,
  navigatePulse,
  sx,
  ...tabProps
}: {
  tabStep: WorkflowStage;
  navigatePulse: boolean;
} & TabProps) {
  const shown = useShownStore();
  const status = useStagedContent(
    `tabStatus/${tabStep}`,
    undefined,
    shown.getStepStatus(tabStep),
  );
  const prevStatus = useRef(status);
  const [statusPulse, setStatusPulse] = useState(false);

  useLayoutEffect(() => {
    if (prevStatus.current === status) return;
    prevStatus.current = status;
    if (!isPresenting()) return;
    setStatusPulse(true);
    const timer = setTimeout(() => setStatusPulse(false), HIGHLIGHT_MILLISECONDS);
    return () => {
      clearTimeout(timer);
      setStatusPulse(false);
    };
  }, [status]);

  const pulsing = navigatePulse || statusPulse;
  return (
    // @ts-expect-error -- MUI Tab with href via LinkComponent (see provider.tsx)
    <Tab
      {...tabProps}
      data-factory-tab={tabStep}
      href={`?step=${tabStep}`}
      value={tabStep}
      label={WORKFLOW_STAGE_LABELS[tabStep]}
      icon={<SlidingStatusIcon status={status} />}
      iconPosition="end"
      sx={[
        {
          alignSelf: "stretch",
          justifyContent: "space-between",
          position: "relative",
          overflow: "visible",
          color: ICON_COLOR[status],
          "& .MuiTab-icon": { overflow: "hidden" },
          ...(pulsing
            ? {
                animation: `${factoryTabPop} ${HIGHLIGHT_MILLISECONDS}ms ease-out`,
              }
            : {}),
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: 1,
            zIndex: 0,
            ...(pulsing
              ? {
                  animation: `${factoryTabFill} ${HIGHLIGHT_MILLISECONDS}ms ease-out`,
                }
              : {}),
          },
          "& > *": { position: "relative", zIndex: 1 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
});

/** Same fill + micro-scale as field `pulseElement`. Fill lives on `::before`
 * so MUI Tab's own background/opacity styles cannot swallow it. */
const factoryTabPop = keyframes`
  0% { transform: scale(1); }
  35% { transform: scale(1.012); }
  70% { transform: scale(1.004); }
  100% { transform: scale(1); }
`;
const factoryTabFill = keyframes`
  0% { background-color: rgba(46, 101, 89, 0); }
  35% { background-color: rgba(46, 101, 89, 0.16); }
  70% { background-color: rgba(46, 101, 89, 0.06); }
  100% { background-color: rgba(46, 101, 89, 0); }
`;

interface FactoryProps {
  activeProject?: { id: string } | null;
}

const DescriptionField = observer(function DescriptionField({
  store,
}: {
  store: Store;
}) {
  const shown = useShownStore();
  return (
    <Box id={artifactElementId("description")}>
      <StagedTextField
        committed={shown.description || ""}
        elementId={artifactElementId("description")}
        fullWidth
        placeholder="Provide a description of the software you'd like to develop..."
        multiline
        onChange={(event) =>
          store.setDescription({ description: event.target.value })
        }
        onBlur={commitTimelineSegment}
      />
    </Box>
  );
});

const Factory: React.FunctionComponent<FactoryProps> = ({ activeProject }) => {
  const store = useStore();
  const shown = useShownStore();

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const step_ = searchParams.get("step");
  const step = isEnumMember(step_, WorkflowStage) ? step_ : WorkflowStage.Description;
  const stepRef = useRef(step);

  const handleStepUpdate = useCallback(
    (next: WorkflowStage) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("step", next);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );
  const handleStepUpdateRef = useRef(handleStepUpdate);
  const tabPulseRef = useRef({ tick: 0, completed: true });
  const presentationVersion = useSyncExternalStore(
    subscribePresentation,
    getPresentationVersion,
    getPresentationVersion,
  );
  const presentingNavigate = getPresentingNavigate();
  const tabIsPresenting = isPresenting() && presentingNavigate != null;

  useEffect(() => {
    store.eventTarget.on("stepUpdate", handleStepUpdate);
    return () => {
      store.eventTarget.off("stepUpdate", handleStepUpdate);
    };
  }, [store.eventTarget, handleStepUpdate]);

  useLayoutEffect(() => {
    stepRef.current = step;
    handleStepUpdateRef.current = handleStepUpdate;
    setPresentationNav({
      getStep: () => stepRef.current,
      requestStep: (next) => handleStepUpdateRef.current(next),
      isVisible: (next) => next === stepRef.current,
    });
    noteVisibleStep(step);
  }, [handleStepUpdate, step]);

  useLayoutEffect(() => {
    if (presentingNavigate == null || !tabIsPresenting) return;

    const tab = factoryTabNode(presentingNavigate);
    if (tab != null) scrollIntoViewWithMargin(tab);

    const tick = getPresentationTick();
    const session = tabPulseRef.current;
    if (session.tick !== tick || session.completed) {
      claim(tick);
      session.tick = tick;
      session.completed = false;
    }
    const finish = () => {
      if (session.completed || session.tick !== tick) return;
      session.completed = true;
      complete(tick);
    };
    const timer = setTimeout(finish, HIGHLIGHT_HOLD_MILLISECONDS);
    return () => {
      clearTimeout(timer);
    };
  }, [presentingNavigate, presentationVersion, tabIsPresenting]);

  return (
    <Stack
      direction="row"
      sx={{ minHeight: 0, height: "100%", width: "100%", flexGrow: 1 }}
    >
      <TabContext value={step}>
        <Stack
          direction="row"
          sx={{
            gap: 2,
            flexGrow: 1,
            minWidth: 0,
            minHeight: 0,
            height: "100%",
          }}
        >
          <Box
            sx={{
              flexShrink: 0,
              height: "100%",
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            <TabList orientation="vertical" sx={{ minHeight: 0, overflow: "visible" }}>
              {Object.values(WorkflowStage).map((tabStep: WorkflowStage) => (
                <FactoryTab
                  key={tabStep}
                  tabStep={tabStep}
                  value={tabStep}
                  disabled={store.isBusy}
                  navigatePulse={tabIsPresenting && presentingNavigate === tabStep}
                />
              ))}
            </TabList>
          </Box>
          <Box
            sx={{
              flexGrow: 1,
              minWidth: 0,
              minHeight: 0,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >

          <AnimatedTabPanel
            step={WorkflowStage.Description}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.Description} />
            <DescriptionField store={store} />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.ProductOverview}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.ProductOverview} />
            <ProductOverview />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.UserStories}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.UserStories} />
            <StructuralFragments
              fragments={shown.userStories}
              isDisabled={store.isBusy}
              structuralFragment={StructuralFragment.UserStory}
              onAddFragment={store.addUserStory}
              onComment={store.handleComment}
              onRemoveFragment={({ fragment }) => {
                const real = store.userStories.find((item) => item.id === fragment.id);
                if (real != null) store.removeUserStory({ fragment: real });
              }}
            />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.Requirements}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.Requirements} />
            <StructuralFragments
              fragments={shown.requirements}
              isDisabled={store.isBusy}
              structuralFragment={StructuralFragment.Requirement}
              onAddFragment={store.addRequirement}
              onComment={store.handleComment}
              onRemoveFragment={({ fragment }) => {
                const real = store.requirements.find((item) => item.id === fragment.id);
                if (real != null) store.removeRequirement({ fragment: real });
              }}
            />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.AcceptanceCriteria}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.AcceptanceCriteria} />
            <StructuralFragments
              fragments={shown.acceptanceCriteria}
              isDisabled={store.isBusy}
              structuralFragment={StructuralFragment.AcceptanceCriteria}
              onAddFragment={store.addAcceptanceCriteria}
              onComment={store.handleComment}
              onRemoveFragment={({ fragment }) => {
                const real = store.acceptanceCriteria.find(
                  (item) => item.id === fragment.id,
                );
                if (real != null) store.removeAcceptanceCriteria({ fragment: real });
              }}
            />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.BoundaryDesign}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.BoundaryDesign} />
            <BoundaryDesign />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.InterfaceContracts}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.InterfaceContracts} />
            <InterfaceContracts />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.TestScenarios}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.TestScenarios} />
            <TestScenarioList scenarios={shown.testScenarios} />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.TestCases}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.TestCases} />
            <TestCaseScenarioAccordions scenarios={shown.testScenarios} />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.ProjectSetup}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.ProjectSetup} />
            <ProjectSetup />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.AutomatedTests}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.AutomatedTests} />
            <AutomatedTests />
          </AnimatedTabPanel>

          <AnimatedTabPanel
            step={WorkflowStage.Code}
            activeStep={step}
            onStepChange={handleStepUpdate}
          >
            <SectionHeader step={WorkflowStage.Code} />
            <CodePlaceholder />
          </AnimatedTabPanel>
          </Box>
        </Stack>
      </TabContext>
    </Stack>
  );
};

export default observer(Factory);
