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
  Button,
  Stack,
  Tab,
  TextField,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import React, { useEffect } from "react";

import { SectionHeader, StructuralFragments } from "components";
import { STEP_LABELS, Status, Step, StructuralFragment, useStore } from "store";
import { isEnumMember } from "utilities";

import CodeTabContent from "./CodeTabContent";
import ProductOverview from "./ProductOverview";
import ProjectConfigDialog from "./ProjectConfigDialog";

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
