import {
  Build,
  CheckBox,
  NewReleases,
  Timer,
} from "@mui/icons-material";
import { TabContext, TabList, TabPanel, TabPanelProps } from "@mui/lab";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Card,
  CardContent,
  Chip,
  Stack,
  Tab,
  TextField,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import React, { useEffect } from "react";

import {
  GenerationButton,
  SectionHeader,
  StructuralFragments,
  TestCaseFragments,
} from "components";
import { STEP_LABELS, Status, Step, StructuralFragment, useStore } from "store";
import { isEnumMember } from "utilities";

import AutomatedTests from "./AutomatedTests";
import BoundaryDesign from "./BoundaryDesign";
import CodePlaceholder from "./CodePlaceholder";
import InterfaceContracts from "./InterfaceContracts";
import ProductOverview from "./ProductOverview";
import ProjectSetup from "./ProjectSetup";

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
        <Stack
          direction="row"
          sx={{
            gap: 2,
            flexGrow: 1,
            minWidth: 0
          }}>
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
                  href={`?step=${step}`}
                  sx={{
                    alignSelf: "stretch",
                    justifyContent: "space-between",
                    color: {
                      [Status.Pending]: "text.disabled",
                      [Status.Outdated]: "warning.main",
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

          <StyledTabPanel value={Step.BoundaryDesign}>
            <SectionHeader step={Step.BoundaryDesign} />
            <BoundaryDesign />
          </StyledTabPanel>

          <StyledTabPanel value={Step.InterfaceContracts}>
            <SectionHeader step={Step.InterfaceContracts} />
            <InterfaceContracts />
          </StyledTabPanel>

          <StyledTabPanel value={Step.TestScenarios}>
            <SectionHeader step={Step.TestScenarios} />
            <Stack spacing={1.5}>
              {store.testScenarios.length === 0 && <Alert severity="info">Generate scenarios from the approved contract suite.</Alert>}
              {store.testScenarios.map((scenario) => (
                <Card key={scenario.id} variant="outlined">
                  <CardContent component={Stack} spacing={1}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Typography variant="h6" sx={{ flexGrow: 1 }}>{scenario.content}</Typography>
                      <Chip size="small" label={scenario.binding?.kind ?? "unbound"} />
                      <Chip size="small" label={scenario.priority ?? "unprioritized"} />
                    </Stack>
                    <Typography>{scenario.description}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {scenario.binding?.kind === "behavioral"
                        ? `Subject ${scenario.binding.subjectId} · ${scenario.binding.interfaceIds.length} interface(s)`
                        : scenario.binding?.kind === "verification"
                          ? `Verification obligation ${scenario.binding.verificationObligationId}`
                          : "No binding"}
                    </Typography>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </StyledTabPanel>

          <StyledTabPanel value={Step.TestCases}>
            <SectionHeader step={Step.TestCases} />
            <Stack sx={{
              gap: 1
            }}>
              {store.testScenarios.map((testScenario) => (
                <Accordion
                  component={Stack}
                  key={testScenario.id}
                  variant="outlined"
                >
                  <AccordionSummary>
                    <Stack
                      direction="row"
                      sx={{
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 2,
                        width: "100%",
                        pr: 2
                      }}>
                      <Typography variant="h6" sx={{ flexGrow: 1, pr: 2 }}>
                        {testScenario.content}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                          textAlign: "right"
                        }}>
                        {testScenario.testCases.length} Test Cases
                      </Typography>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack>
                      <GenerationButton
                        endIcon={<Build />}
                        disabled={store.isBusy}
                        onGenerate={() => store.generateTestCases(testScenario)}
                        sx={{ alignSelf: "end" }}
                      >
                        Generate Test Cases
                      </GenerationButton>
                      <TestCaseFragments
                        fragments={testScenario.testCases}
                        isDisabled={store.isBusy}
                      />
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Stack>
          </StyledTabPanel>

          <StyledTabPanel value={Step.ProjectSetup}>
            <SectionHeader step={Step.ProjectSetup} />
            <ProjectSetup />
          </StyledTabPanel>

          <StyledTabPanel value={Step.AutomatedTests}>
            <SectionHeader step={Step.AutomatedTests} />
            <AutomatedTests />
          </StyledTabPanel>

          <StyledTabPanel value={Step.Code}>
            <SectionHeader step={Step.Code} />
            <CodePlaceholder />
          </StyledTabPanel>
        </Stack>
      </TabContext>
    </Stack>
  );
};

export default observer(Factory);
