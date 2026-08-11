import {
  Build,
  CheckCircle,
  Circle,
  Code,
  ErrorOutlined,
  Refresh,
  Visibility,
} from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";

import { CodeBlock, CommentButton } from "components";
import { Step, useStore } from "store";
import { extractTestCaseCode } from "utilities/testParser";

const CodeTabContent: React.FunctionComponent<{ step: Step }> = observer(
  ({ step }) => {
    const store = useStore();

    if (!store.projectConfigLocked) {
      return (
        <Stack
          sx={{
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            py: 8
          }}>
          <Typography variant="h5" sx={{
            color: "text.secondary"
          }}>
            Project scaffold has not been generated yet.
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              textAlign: "center"
            }}>
            Generate the project configuration and scaffold before writing{" "}
            {step === Step.TestCode ? "test" : "application"} code.
          </Typography>
          <Stack direction="row" sx={{
            gap: 2
          }}>
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
        <Stack sx={{
          gap: 1
        }}>
          <Stack
            direction="row"
            sx={{
              justifyContent: "flex-end",
              mb: 1
            }}>
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
                  {/* Progressive Status Bar (Aligned Right) */}
                  <Stack
                    sx={{
                      alignItems: "flex-end",
                      flexShrink: 0,
                      minWidth: 120,
                      width: "16%",
                      maxWidth: 200
                    }}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        mb: 0.5,
                        lineHeight: 1,
                        whiteSpace: "nowrap"
                      }}>
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
                <Stack sx={{
                  gap: 1
                }}>
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
                          sx={{
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 2,
                            width: "100%",
                            pr: 2
                          }}>
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
                              <ErrorOutlined
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
                        <Stack sx={{
                          gap: 2
                        }}>
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
                              <Stack sx={{
                                gap: 2
                              }}>
                                <CodeBlock
                                  code={testCaseCode}
                                  language={
                                    store.productOverview.programmingLanguage ||
                                    "typescript"
                                  }
                                />
                                <Stack direction="row" sx={{
                                  gap: 1
                                }}>
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
      <Stack
        sx={{
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          py: 8
        }}>
        <Typography variant="h5" sx={{
          color: "text.secondary"
        }}>
          Application code generation coming soon.
        </Typography>
      </Stack>
    );
  },
);

export default CodeTabContent;
