import { TabPanel, TabPanelProps } from "@mui/lab";

import { Step } from "store";

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
  step: Step;
  activeStep: Step;
  onStepChange: (step: Step) => void;
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
