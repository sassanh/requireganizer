import ProductOverview from "./ProductOverview";
import {
  Build,
  CheckBox,
  CheckCircle,
  Close,
  Code,
  NewReleases,
  Timer,
  Visibility,
} from "@mui/icons-material";
import { Circle, ErrorOutline } from "@mui/icons-material";
import { Refresh } from "@mui/icons-material";
import { TabContext, TabList, TabPanel, TabPanelProps } from "@mui/lab";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Tab,
  TextField,
  Typography,
} from "@mui/material";
import { SectionHeader, StructuralFragments } from "components";
import { CodeBlock, CommentButton } from "components";
import { observer } from "mobx-react-lite";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import React, { useEffect } from "react";
import { STEP_LABELS, Status, Step, StructuralFragment, useStore } from "store";
import { isEnumMember } from "utilities";
import { extractTestCaseCode } from "utilities/testParser";

function StyledTabPanel({ sx, ...props }: TabPanelProps) {
  return (
    <TabPanel
      sx={[{ flexGrow: 1, minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...props}
    />
  );
}

const ICONS = {
  [Status.Pending]: Timer,
  [Status.Outdated]: NewReleases,
  [Status.Completed]: CheckBox,
};

const ProjectConfigDialog: React.FunctionComponent = observer(() => {
  const store = useStore();

  if (store.projectConfig == null) return null;

  return (
    <Dialog
      open={store.isProjectConfigDialogOpen}
      onClose={() => store.setProjectConfigDialogOpen(false)}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        Project Configuration
        <IconButton
          onClick={() => store.setProjectConfigDialogOpen(false)}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {store.projectConfigLocked
            ? "Scaffold has been generated. Configuration is locked."
            : "Review and fill in all <placeholder> values, then generate the scaffold."}
        </Typography>
        <TextField
          multiline
          fullWidth
          value={store.projectConfig}
          onChange={(e) => store.setProjectConfig(e.target.value)}
          disabled={store.projectConfigLocked || store.isBusy}
          slotProps={{
            input: {
              sx: {
                fontFamily: "monospace",
                fontSize: "0.85rem",
                lineHeight: 1.5,
              },
            },
          }}
          minRows={20}
        />
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        {store.projectConfigLocked ? (
          <Button
            variant="outlined"
            color="success"
            startIcon={<CheckCircle />}
            disabled
          >
            Scaffold Generated
          </Button>
        ) : (
          <Button
            variant="contained"
            color="primary"
            startIcon={<Build />}
            disabled={store.isBusy}
            onClick={() => store.generateScaffold()}
          >
            Generate Scaffold
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});

const CodeTabContent: React.FunctionComponent<{ step: Step }> = observer(
  ({ step }) => {
    const store = useStore();

    if (!store.projectConfigLocked) {
      return (
        <Stack alignItems="center" justifyContent="center" gap={3} py={8}>
          <Typography variant="h5" color="text.secondary">
            Project scaffold has not been generated yet.
          </Typography>
          <Typography variant="body1" color="text.secondary" textAlign="center">
            Generate the project configuration and scaffold before writing{" "}
            {step === Step.TestCode ? "test" : "application"} code.
          </Typography>
          <Stack direction="row" gap={2}>
            {store.projectConfig == null ? (
              <Button
                variant="contained"
                size="large"
                startIcon={<Build />}
                disabled={
                  store.isBusy ||
                  store.testScenarios.flatMap((ts) => ts.testCases).length === 0
                }
                onClick={() => store.generateProjectConfig()}
              >
                Generate Project Config
              </Button>
            ) : (
              <Button
                variant="contained"
                size="large"
                startIcon={<Build />}
                disabled={store.isBusy}
                onClick={() => store.setProjectConfigDialogOpen(true)}
              >
                Open Project Config
              </Button>
            )}
          </Stack>
        </Stack>
      );
    }

    if (step === Step.TestCode) {
      return (
        <Stack gap={1}>
          <Stack direction="row" justifyContent="flex-end" mb={1}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Visibility />}
              onClick={() => store.setProjectConfigDialogOpen(true)}
            >
              View Project Config
            </Button>
          </Stack>
          {store.testScenarios.map((testScenario) => (
            <Accordion
              component={Stack}
              key={testScenario.id}
              variant="outlined"
            >
              <AccordionSummary>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ width: "100%", pr: 2 }}
                  gap={2}
                >
                  <Typography variant="h6" sx={{ flexGrow: 1, pr: 2 }}>
                    {testScenario.content}
                  </Typography>
                  {/* Progressive Status Bar (Aligned Right) */}
                  <Stack
                    alignItems="flex-end"
                    sx={{
                      flexShrink: 0,
                      minWidth: 120,
                      width: "16%",
                      maxWidth: 200,
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mb: 0.5, lineHeight: 1, whiteSpace: "nowrap" }}
                    >
                      {testScenario.scenarioTestStatuses["generated-count"]} out
                      of {testScenario.scenarioTestStatuses["total-count"]}
                    </Typography>
                    <Box
                      sx={{
                        display: "flex",
                        height: 6,
                        width: "100%",
                        borderRadius: 1,
                        overflow: "hidden",
                        bgcolor: "action.hover",
                      }}
                    >
                      <Box
                        sx={{
                          width: `${testScenario.scenarioTestStatuses["generated"]}%`,
                          bgcolor: "success.main",
                          transition: "width 0.3s",
                        }}
                      />
                      <Box
                        sx={{
                          width: `${testScenario.scenarioTestStatuses["out-of-sync"]}%`,
                          bgcolor: "warning.main",
                          transition: "width 0.3s",
                        }}
                      />
                      <Box
                        sx={{
                          width: `${testScenario.scenarioTestStatuses["not-generated"]}%`,
                          bgcolor: "text.disabled",
                          transition: "width 0.3s",
                          opacity: 0.5,
                        }}
                      />
                    </Box>
                  </Stack>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack gap={1}>
                  {testScenario.testCases.map((testCase) => (
                    <Accordion
                      component={Stack}
                      key={testCase.id}
                      variant="outlined"
                      sx={[
                        (theme) => ({
                          backgroundColor:
                            testCase.testStatus === "generated"
                              ? theme.palette.mode === "dark"
                                ? "rgba(46, 125, 50, 0.15)"
                                : "rgba(46, 125, 50, 0.08)"
                              : testCase.testStatus === "out-of-sync"
                                ? theme.palette.mode === "dark"
                                  ? "rgba(237, 108, 2, 0.15)"
                                  : "rgba(237, 108, 2, 0.08)"
                                : "transparent",
                          transition: "background-color 0.2s",
                        }),
                      ]}
                    >
                      <AccordionSummary>
                        <Stack
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          sx={{ width: "100%", pr: 2 }}
                          gap={2}
                        >
                          <Typography variant="body1">
                            <strong>{testCase.title}</strong>
                          </Typography>
                          {/* Status Indicator Icon (Aligned Right) */}
                          <Box sx={{ display: "flex", alignItems: "center" }}>
                            {testCase.testStatus === "generated" ? (
                              <CheckCircle
                                color="success"
                                sx={{ fontSize: 20 }}
                              />
                            ) : testCase.testStatus === "out-of-sync" ? (
                              <ErrorOutline
                                color="warning"
                                sx={{ fontSize: 20 }}
                              />
                            ) : (
                              <Circle
                                sx={{
                                  fontSize: 16,
                                  color: "text.disabled",
                                  opacity: 0.3,
                                }}
                              />
                            )}
                          </Box>
                        </Stack>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Stack gap={2}>
                          <Box>
                            <Typography
                              variant="body2"
                              sx={{ whiteSpace: "pre-wrap", mb: 1 }}
                            >
                              <strong>Steps:</strong>
                              {"\n"}
                              {testCase.steps}
                            </Typography>
                            <Typography
                              variant="body2"
                              sx={{
                                fontStyle: "italic",
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              <strong>Expected Result:</strong>
                              {"\n"}
                              {testCase.expectedResult}
                            </Typography>
                          </Box>
                          <Divider />
                          {(() => {
                            const testCaseCode = extractTestCaseCode(
                              Array.from(store.scaffoldFiles),
                              testScenario.id,
                              testCase.id,
                              store.productOverview.programmingLanguage ||
                              "typescript",
                            );

                            return !testCaseCode ? (
                              <Button
                                variant="contained"
                                startIcon={<Code />}
                                disabled={store.isBusy}
                                onClick={() =>
                                  store.generateTestCode({
                                    testCase,
                                    testScenario,
                                  })
                                }
                                sx={{ alignSelf: "flex-start" }}
                              >
                                Generate Test Code
                              </Button>
                            ) : (
                              <Stack gap={2}>
                                <CodeBlock
                                  code={testCaseCode}
                                  language={
                                    store.productOverview.programmingLanguage ||
                                    "typescript"
                                  }
                                />
                                <Stack direction="row" gap={1}>
                                  <Button
                                    variant="outlined"
                                    startIcon={<Refresh />}
                                    disabled={store.isBusy}
                                    onClick={() =>
                                      store.generateTestCode({
                                        testCase,
                                        testScenario,
                                      })
                                    }
                                  >
                                    Regenerate
                                  </Button>
                                  <CommentButton
                                    disabled={store.isBusy}
                                    onSubmit={(comment) =>
                                      store.generateTestCode({
                                        testCase,
                                        testScenario,
                                        comment,
                                      })
                                    }
                                  />
                                </Stack>
                              </Stack>
                            );
                          })()}
                        </Stack>
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}
        </Stack>
      );
    }

    return (
      <Stack alignItems="center" justifyContent="center" gap={3} py={8}>
        <Typography variant="h5" color="text.secondary">
          Application code generation coming soon.
        </Typography>
      </Stack>
    );
  },
);

interface FactoryProps {
  activeProject?: { id: string } | null;
}

const Factory: React.FunctionComponent<FactoryProps> = ({ activeProject }) => {
  const store = useStore();

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const step_ = searchParams.get("step");
  const step = isEnumMember(step_, Step) ? step_ : Step.Description;

  const handleDescriptionChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => store.setDescription({ description: event.target.value });

  useEffect(() => {
    function handleStepUpdate(step: Step) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("step", step);
      router.push(`${pathname}?${params.toString()}`);
    }

    store.eventTarget.on("stepUpdate", handleStepUpdate);
    return () => {
      store.eventTarget.off("stepUpdate", handleStepUpdate);
    };
  }, [store.eventTarget, router, pathname, searchParams]);

  return (
    <Stack direction="row" sx={{ minHeight: 0, flexGrow: 1 }}>
      <TabContext value={step}>
        <Stack direction="row" gap={2} sx={{ flexGrow: 1, minWidth: 0 }}>
          <TabList
            variant="scrollable"
            orientation="vertical"
            sx={{ flexShrink: 0 }}
          >
            {Object.values(Step).map((step: Step) => {
              const status = store.getStepStatus(step);
              const Icon = ICONS[status];
              return (
                <Tab
                  {...(step === Step.Code
                    ? {
                      href: activeProject
                        ? `/project/${encodeURIComponent(activeProject.id)}/code`
                        : "#",
                      target: "_blank",
                      rel: "noopener noreferrer",
                      disabled: !activeProject,
                    }
                    : { href: `?step=${step}` })}
                  sx={{
                    alignSelf: "stretch",
                    justifyContent: "space-between",
                    color: {
                      [Status.Pending]: "text.disabled",
                      [Status.Completed]: "success.main",
                    }[status],
                  }}
                  disabled={store.isBusy}
                  value={step}
                  key={step}
                  label={STEP_LABELS[step]}
                  icon={<Icon />}
                  iconPosition="end"
                />
              );
            })}
          </TabList>

          <StyledTabPanel value={Step.Description}>
            <SectionHeader step={Step.Description} />
            <TextField
              fullWidth
              value={store.description || ""}
              placeholder="Provide a description of the software you'd like to develop..."
              multiline
              onChange={handleDescriptionChange}
            />
          </StyledTabPanel>

          <StyledTabPanel value={Step.ProductOverview}>
            <SectionHeader step={Step.ProductOverview} />
            <ProductOverview />
          </StyledTabPanel>

          <StyledTabPanel value={Step.Requirements}>
            <SectionHeader step={Step.Requirements} />
            <StructuralFragments
              fragments={store.requirements}
              isDisabled={store.isBusy}
              structuralFragment={StructuralFragment.Requirement}
              onAddFragment={store.addRequirement}
              onComment={store.handleComment}
              onRemoveFragment={store.removeRequirement}
            />
          </StyledTabPanel>

          <StyledTabPanel value={Step.UserStories}>
            <SectionHeader step={Step.UserStories} />
            <StructuralFragments
              fragments={store.userStories}
              isDisabled={store.isBusy}
              structuralFragment={StructuralFragment.UserStory}
              onAddFragment={store.addUserStory}
              onComment={store.handleComment}
              onRemoveFragment={store.removeUserStory}
            />
          </StyledTabPanel>

          <StyledTabPanel value={Step.AcceptanceCriteria}>
            <SectionHeader step={Step.AcceptanceCriteria} />
            <StructuralFragments
              fragments={store.acceptanceCriteria}
              isDisabled={store.isBusy}
              structuralFragment={StructuralFragment.AcceptanceCriteria}
              onAddFragment={store.addAcceptanceCriteria}
              onComment={store.handleComment}
              onRemoveFragment={store.removeAcceptanceCriteria}
            />
          </StyledTabPanel>

          <StyledTabPanel value={Step.TestScenarios}>
            <SectionHeader step={Step.TestScenarios} />
            <StructuralFragments
              fragments={store.testScenarios}
              isDisabled={store.isBusy}
              structuralFragment={StructuralFragment.TestScenario}
              onAddFragment={store.addTestScenario}
              onComment={store.handleComment}
              onRemoveFragment={store.removeTestScenario}
            />
          </StyledTabPanel>

          <StyledTabPanel value={Step.TestCases}>
            <SectionHeader step={Step.TestCases} />
            <Stack gap={1}>
              {store.testScenarios.map((testScenario) => (
                <Accordion
                  component={Stack}
                  key={testScenario.id}
                  variant="outlined"
                >
                  <AccordionSummary>
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{ width: "100%", pr: 2 }}
                      gap={2}
                    >
                      <Typography variant="h6" sx={{ flexGrow: 1, pr: 2 }}>
                        {testScenario.content}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                          textAlign: "right",
                        }}
                      >
                        {testScenario.testCases.length} Test Cases
                      </Typography>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack>
                      <Button
                        endIcon={<Build />}
                        disabled={store.isBusy}
                        onClick={() => store.generateTestCases(testScenario)}
                        sx={{ alignSelf: "end" }}
                      >
                        Generate Test Cases
                      </Button>
                      <StructuralFragments
                        fragments={testScenario.testCases}
                        isDisabled={store.isBusy}
                        structuralFragment={StructuralFragment.TestCase}
                        onAddFragment={testScenario.addTestCase}
                        onComment={store.handleComment}
                        onRemoveFragment={testScenario.removeTestCase}
                      />
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Stack>
          </StyledTabPanel>

          <StyledTabPanel value={Step.TestCode}>
            <SectionHeader step={Step.TestCode} />
            <CodeTabContent step={Step.TestCode} />
          </StyledTabPanel>
        </Stack>
      </TabContext>

      <ProjectConfigDialog />
    </Stack>
  );
};

export default observer(Factory);
