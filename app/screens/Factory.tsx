import { Build, CheckBox, NewReleases, Timer } from "@mui/icons-material";
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
import {
  useSearchParams,
  useRouter,
  usePathname,
  ReadonlyURLSearchParams,
} from "next/navigation";
import React, { useEffect } from "react";

import { SectionHeader, StructuralFragments } from "components";
import { STEP_LABELS, Status, Step, StructuralFragment, useStore } from "store";
import { isEnumMember } from "utilities";

import ProductOverview from "./ProductOverview";

function StyledTabPanel({ sx, ...props }: TabPanelProps) {
  return (
    <TabPanel
      sx={[{ flexGrow: 1 }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...props}
    />
  );
}

const ICONS = {
  [Status.Pending]: Timer,
  [Status.Outdated]: NewReleases,
  [Status.Completed]: CheckBox,
};

const Factory: React.FunctionComponent = () => {
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
    <TabContext value={step}>
      <Stack direction="row" gap={2}>
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
                  <Typography variant="h6">{testScenario.content}</Typography>
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
      </Stack>
    </TabContext>
  );
};

export default observer(Factory);
