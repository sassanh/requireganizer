import {
  CheckBox,
  Lock,
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
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { AnimatedTabPanel, SectionHeader, StructuralFragments, TestCaseScenarioAccordions, TestScenarioList } from "components";
import { presentationMs, presentationSeconds } from "components/animation";
import {
  HIGHLIGHT_HOLD_MILLISECONDS,
  HIGHLIGHT_MILLISECONDS,
  useStagedContent,
} from "components/changeQueue";
import { ITEM_MOTION_SECONDS } from "components/itemMotion";
import { scrollPresentationIntoView } from "components/scrollFollower";
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
import { isEnumMember } from "utilities";

import AutomatedTests from "./AutomatedTests";
import BoundaryDesign from "./BoundaryDesign";
import CodePlaceholder from "./CodePlaceholder";
import InterfaceContracts from "./InterfaceContracts";
import ProductOverview from "./ProductOverview";
import ProjectSetup from "./ProjectSetup";

const ICONS = {
  [Status.Pending]: Timer,
  [Status.Outdated]: NewReleases,
  [Status.Completed]: CheckBox,
  [Status.Locked]: Lock,
};

const ICON_COLOR = {
  [Status.Pending]: "text.disabled",
  [Status.Outdated]: "warning.main",
  [Status.Completed]: "success.main",
  [Status.Locked]: "text.disabled",
} as const;

const SELECTED_ICON_COLOR = {
  [Status.Pending]: "text.secondary",
  [Status.Outdated]: "warning.dark",
  [Status.Completed]: "success.dark",
  [Status.Locked]: "text.secondary",
} as const;

function MovingIcon({
  status,
  start,
  end,
  durationSeconds,
}: {
  status: Status;
  start: string;
  end: string;
  durationSeconds: number;
}) {
  const Icon = ICONS[status];
  const [moved, setMoved] = useState(start === end);
  useEffect(() => {
    if (start === end) return;
    const frame = requestAnimationFrame(() => setMoved(true));
    return () => cancelAnimationFrame(frame);
  }, [start, end]);
  return (
    <Box
      component="span"
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: moved ? end : start,
        transitionProperty: "transform",
        transitionDuration: `${durationSeconds}s`,
        transitionTimingFunction: "ease-in-out",
      }}
    >
      <Icon sx={{ color: ICON_COLOR[status] }} />
    </Box>
  );
}

function SlidingStatusIcon({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const slide = isPresenting();
  const [settled, setSettled] = useState(status);
  const [departing, setDeparting] = useState<Status | null>(null);
  // Render-phase handoff, not an effect: the arriving icon takes the new
  // status and the previous one becomes the departing layer for one slide.
  if (settled !== status) {
    setDeparting(settled);
    setSettled(status);
  }
  useEffect(() => {
    if (departing == null) return;
    const timer = setTimeout(
      () => setDeparting(null),
      presentationMs(ITEM_MOTION_SECONDS * 1000),
    );
    return () => clearTimeout(timer);
  }, [departing]);
  const durationSeconds = presentationSeconds(slide ? ITEM_MOTION_SECONDS : 0);
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
      <MovingIcon
        key={settled}
        status={settled}
        start={slide ? "translateY(-100%)" : "none"}
        end="none"
        durationSeconds={durationSeconds}
      />
      {departing != null && slide ? (
        <MovingIcon
          status={departing}
          start="none"
          end="translateY(100%)"
          durationSeconds={durationSeconds}
        />
      ) : null}
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
  const store = useStore();
  const shown = useShownStore();
  const locked = store.stageIsLocked(tabStep);
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
    const timer = setTimeout(() => setStatusPulse(false), presentationMs(HIGHLIGHT_MILLISECONDS));
    return () => {
      clearTimeout(timer);
      setStatusPulse(false);
    };
  }, [status]);

  const pulsing = navigatePulse || statusPulse;
  return (
    <Tab
      {...tabProps}
      data-factory-tab={tabStep}
      disabled={store.isBusy || locked}
      {...(locked ? {} : { href: `?step=${tabStep}` })}
      value={tabStep}
      label={WORKFLOW_STAGE_LABELS[tabStep]}
      icon={<SlidingStatusIcon status={status} />}
      iconPosition="end"
      sx={[
        {
          alignSelf: "stretch",
          width: "100%",
          justifyContent: "flex-start",
          position: "relative",
          overflow: "visible",
          color: ICON_COLOR[status],
          opacity: .8,
          borderRight: "2px solid transparent",
          "&.Mui-selected": {
            borderRightColor: "currentColor",
          },
          "& .MuiTab-icon": {
            overflow: "hidden",
            marginLeft: "auto",
          },
          ...(pulsing
            ? {
                animation: `${factoryTabPop} ${presentationMs(HIGHLIGHT_MILLISECONDS)}ms ease-out`,
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
                  animation: `${factoryTabFill} ${presentationMs(HIGHLIGHT_MILLISECONDS)}ms ease-out`,
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

/** Tab fill + micro-scale. Fill lives on `::before` so MUI Tab's own
 * background/opacity styles cannot swallow it. */
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

const Factory: React.FunctionComponent<FactoryProps> = ({ activeProject }) => {
  const store = useStore();
  const shown = useShownStore();

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const step_ = searchParams.get("step");
  const requested = isEnumMember(step_, WorkflowStage) ? step_ : WorkflowStage.ProductOverview;
  const step = store.resolveOpenStep(requested);
  const stepRef = useRef(step);

  const handleStepUpdate = useCallback(
    (next: WorkflowStage) => {
      const open = store.resolveOpenStep(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("step", open);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, store],
  );

  useEffect(() => {
    if (requested === step) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", step);
    router.replace(`${pathname}?${params.toString()}`);
  }, [requested, step, router, pathname, searchParams]);
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
    if (tab != null) scrollPresentationIntoView(tab);

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
    const timer = setTimeout(finish, presentationMs(HIGHLIGHT_HOLD_MILLISECONDS));
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
            <TabList
              orientation="vertical"
              textColor="inherit"
              sx={{
                minHeight: 0,
                overflow: "visible",
                "& .MuiTabs-indicator": { display: "none" },
              }}
            >
              {Object.values(WorkflowStage).map((tabStep: WorkflowStage) => (
                <FactoryTab
                  key={tabStep}
                  tabStep={tabStep}
                  value={tabStep}
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
              onComment={store.handleComment}
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
              onComment={store.handleComment}
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
              onComment={store.handleComment}
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
