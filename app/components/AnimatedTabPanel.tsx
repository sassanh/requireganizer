import { TabPanel, TabPanelProps } from "@mui/lab";

import { WorkflowStage } from "store";

/**
 * Keep step content mounted so presenters can claim hidden ticks.
 * Navigation is a sequencer frame, not a nested coordinator.
 */
export default function AnimatedTabPanel({
  step,
  activeStep,
  onStepChange,
  children,
  sx,
  ...rest
}: {
  step: WorkflowStage;
  activeStep: WorkflowStage;
  onStepChange: (step: WorkflowStage) => void;
} & Omit<TabPanelProps, "value">) {
  void activeStep;
  void onStepChange;
  return (
    <TabPanel
      value={step}
      keepMounted
      sx={[
        {
          flexGrow: 1,
          minWidth: 0,
          minHeight: 0,
          height: "100%",
          overflowY: "auto",
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {children}
    </TabPanel>
  );
}
