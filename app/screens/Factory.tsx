import { Build } from "@mui/icons-material";
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
import { useSearchParams } from "next/navigation";
import React from "react";

import { SectionHeader, StructuralFragments } from "components";
import { STEP_LABELS, Step, StructuralFragment, useStore } from "store";
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

const Factory: React.FunctionComponent = () => {
  const store = useStore();

  const searchParams = useSearchParams();
  const step_ = searchParams.get("step");
  const step = isEnumMember(step_, Step) ? step_ : Step.Description;

  const handleDescriptionChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => store.setDescription({ description: event.target.value });

  return (
    <TabContext value={step}>
      <Stack direction="row" gap={2}>
        <TabList variant="scrollable" orientation="vertical">
          {Object.values(Step).map((tab: Step) => (
            <Tab
              href={`?step=${tab}`}
              sx={{ alignSelf: "start" }}
              disabled={store.isBusy}
              value={tab}
              key={tab}
              label={STEP_LABELS[tab]}
            />
          ))}
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
                    gap={2}
                    justifyContent="space-between"
                    width="100%"
                  >
                    <Typography variant="h5">{testScenario.content}</Typography>
                    <Button
                      endIcon={<Build />}
                      disabled={store.isBusy}
                      onClick={() => store.generateTestCases(testScenario)}
                      sx={{
                        "*:not(.Mui-expanded)>*>&": { display: "none" },
                      }}
                    >
                      Generate Test Cases
                    </Button>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <StructuralFragments
                    fragments={testScenario.testCases}
                    isDisabled={store.isBusy}
                    structuralFragment={StructuralFragment.TestCase}
                    onAddFragment={testScenario.addTestCase}
                    onComment={store.handleComment}
                    onRemoveFragment={testScenario.removeTestCase}
                  />
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
