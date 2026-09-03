import { Build } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Stack,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";

import { GenerationButton } from "components";
import { useStore } from "store";
import type { TestScenario } from "store/models";

import ApprovalMark from "./ApprovalMark";
import {
  MembershipMotion,
} from "./membershipPresentation";
import { TestCaseFragments } from "./StructuralFragments";
import { useTestScenariosPresentation } from "./TestScenarioList";

export default observer(function TestCaseScenarioAccordions({
  scenarios,
}: {
  scenarios: TestScenario[];
}) {
  const store = useStore();
  const { presentedIds, enteringIds, exitingIds, exitHeightFor, seqFor, itemRef, live, pictureFor } =
    useTestScenariosPresentation(scenarios);

  return (
    <Stack sx={{ gap: 1 }}>
      {presentedIds.map((id, index) => {
        const scenario = live.find((entry) => entry.id === id);
        const picture = pictureFor(id);
        if (picture == null) return null;
        return (
          <MembershipMotion
            key={`${id}:${seqFor(id)}:${index}`}
            id={id}
            entering={enteringIds.has(id)}
            exiting={exitingIds.has(id)}
            exitHeight={exitHeightFor(id)}
            itemRef={itemRef}
          >
            <Accordion component={Stack} variant="outlined">
              <AccordionSummary>
                <Stack
                  direction="row"
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 2,
                    width: "100%",
                    pr: 2,
                  }}
                >
                  <Typography variant="h6" sx={{ flexGrow: 1, pr: 2 }}>
                    {picture.content}
                  </Typography>
                  {scenario != null ? <ApprovalMark id={scenario.id} /> : null}
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      textAlign: "right",
                    }}
                  >
                    {scenario != null
                      ? `${scenario.testCases.length} Test Cases`
                      : "Test Cases"}
                  </Typography>
                </Stack>
              </AccordionSummary>
              {scenario != null && (
                <AccordionDetails>
                  <Stack>
                    {scenario.testCases.length === 0 ? (
                      <GenerationButton
                        endIcon={<Build />}
                        disabled={store.isBusy || scenario.approval !== "approved"}
                        onGenerate={() => {
                          const real = store.testScenarios.find(
                            (entry) => entry.id === scenario.id,
                          );
                          if (real != null) store.generateTestCases(real);
                        }}
                        sx={{ alignSelf: "end" }}
                      >
                        Generate Test Cases
                      </GenerationButton>
                    ) : null}
                    <TestCaseFragments
                      fragments={scenario.testCases}
                      isDisabled={store.isBusy}
                      scenarioId={scenario.id}
                    />
                  </Stack>
                </AccordionDetails>
              )}
            </Accordion>
          </MembershipMotion>
        );
      })}
    </Stack>
  );
});
