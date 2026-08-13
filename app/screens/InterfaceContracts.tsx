import { Build, Check, Send } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { CodeBlock, GenerationButton } from "components";
import { useStore } from "store";

const PROFILE_FIELDS = [
  ["platform", "Platform"],
  ["runtime", "Runtime"],
  ["language", "Language"],
  ["framework", "Framework"],
  ["moduleSystem", "Module / target system"],
  ["buildEcosystem", "Build ecosystem"],
  ["testEcosystem", "Test ecosystem"],
] as const;

type Target = { kind: "interface" | "subject" | "verification"; id: string };

const InterfaceContractsView = () => {
  const store = useStore();
  const [target, setTarget] = useState<Target | null>(null);
  const [comment, setComment] = useState("");
  const profile = store.implementationProfile;
  const suite = store.contractSuite;

  if (profile == null) {
    return (
      <Stack spacing={2} sx={{ alignItems: "center" }}>
        <Alert severity="info" sx={{ width: "100%" }}>
          Generate an implementation profile after approving Boundary Design.
        </Alert>
        <GenerationButton
          startIcon={<Build />}
          variant="contained"
          disabled={store.isBusy || store.boundaryDesign?.status !== "approved"}
          onGenerate={store.generateImplementationProfile}
        >
          Generate implementation profile
        </GenerationButton>
      </Stack>
    );
  }

  const revise = async () => {
    if (target == null || comment.trim().length === 0) return;
    await store.reviseFormalContract(target, comment.trim());
    setTarget(null);
    setComment("");
  };

  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardContent component={Stack} spacing={2}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="h5">Implementation Profile · revision {profile.revision}</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Chip label={profile.status} color={profile.status === "approved" ? "success" : "warning"} />
              {profile.status === "approved" && (
                <GenerationButton
                  size="small"
                  variant="outlined"
                  disabled={store.isBusy}
                  onGenerate={store.generateImplementationProfile}
                >
                  Generate new revision
                </GenerationButton>
              )}
            </Stack>
          </Stack>
          {PROFILE_FIELDS.map(([field, label]) => (
            <TextField
              key={field}
              label={label}
              value={profile[field]}
              disabled={profile.status === "approved" || store.isBusy}
              onChange={(event) => store.updateImplementationProfile(field, event.target.value)}
            />
          ))}
          <TextField
            label="Constraints"
            value={profile.constraints.join("\n")}
            multiline
            disabled={profile.status === "approved" || store.isBusy}
            onChange={(event) =>
              store.updateImplementationProfileConstraints(event.target.value)
            }
          />
          {profile.status === "draft" && (
            <Button sx={{ alignSelf: "flex-end" }} variant="contained" color="success" startIcon={<Check />} onClick={store.approveImplementationProfile} disabled={store.isBusy}>
              Approve profile
            </Button>
          )}
        </CardContent>
      </Card>

      {profile.status === "approved" && suite == null && (
        <GenerationButton startIcon={<Build />} variant="contained" disabled={store.isBusy} onGenerate={store.generateInterfaceContracts} sx={{ alignSelf: "center" }}>
          Generate formal interface contracts
        </GenerationButton>
      )}

      {suite != null && (
        <>
          {store.contractRevisionDiff != null && (
            <Accordion variant="outlined">
              <AccordionSummary>
                <Typography>Reconciled artifact diff</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <CodeBlock code={store.contractRevisionDiff} language="diff" />
              </AccordionDetails>
            </Accordion>
          )}
          <Typography variant="h5">Interface bundles</Typography>
          {suite.interfaceContracts.map((bundle) => (
            <Accordion key={bundle.id} variant="outlined">
              <AccordionSummary>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", width: "100%" }}>
                  <Typography sx={{ flexGrow: 1 }}>{bundle.interfaceId}</Typography>
                  <Chip size="small" label={`adapter ${bundle.adapter.id}@${bundle.adapter.version}`} />
                  <Chip size="small" label={bundle.status} color={bundle.status === "approved" ? "success" : "warning"} />
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Typography>{bundle.formalContract.summary}</Typography>
                  <Typography variant="body2"><strong>Notation:</strong> {bundle.adapter.notation} — {bundle.adapter.rationale}</Typography>
                  {bundle.formalContract.documents.map((document) => (
                    <Stack key={document.path} spacing={1}>
                      <Typography variant="subtitle2">{document.path} · sha256 {document.sha256}</Typography>
                      <CodeBlock code={document.content} language="text" />
                    </Stack>
                  ))}
                  <CodeBlock code={JSON.stringify(bundle.normalizedIndex, null, 2)} language="json" />
                  <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                    <Button startIcon={<Send />} onClick={() => setTarget({ kind: "interface", id: bundle.id })}>Request change</Button>
                    {bundle.status === "draft" && <Button variant="contained" color="success" startIcon={<Check />} onClick={() => store.approveContract("interface", bundle.id)}>Approve</Button>}
                  </Stack>
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}

          <Typography variant="h5">Subject protocols and harness bindings</Typography>
          {suite.subjectContracts.map((bundle) => (
            <Accordion key={bundle.id} variant="outlined">
              <AccordionSummary>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", width: "100%" }}>
                  <Typography sx={{ flexGrow: 1 }}>{bundle.subjectId}</Typography>
                  <Chip size="small" label={bundle.status} color={bundle.status === "approved" ? "success" : "warning"} />
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <CodeBlock code={JSON.stringify({ protocol: bundle.protocol, harness: bundle.harness }, null, 2)} language="json" />
                  <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                    <Button onClick={() => setTarget({ kind: "subject", id: bundle.id })}>Request change</Button>
                    {bundle.status === "draft" && <Button variant="contained" color="success" onClick={() => store.approveContract("subject", bundle.id)}>Approve</Button>}
                  </Stack>
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}

          {suite.verificationContracts.length > 0 && <Typography variant="h5">Verification contracts</Typography>}
          {suite.verificationContracts.map((bundle) => (
            <Accordion key={bundle.id} variant="outlined">
              <AccordionSummary>
                <Typography sx={{ flexGrow: 1 }}>{bundle.verificationObligationId}</Typography>
                <Chip size="small" label={bundle.status} color={bundle.status === "approved" ? "success" : "warning"} />
              </AccordionSummary>
              <AccordionDetails>
                <CodeBlock code={JSON.stringify(bundle, null, 2)} language="json" />
                <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", mt: 2 }}>
                  <Button onClick={() => setTarget({ kind: "verification", id: bundle.id })}>Request change</Button>
                  {bundle.status === "draft" && <Button variant="contained" color="success" onClick={() => store.approveContract("verification", bundle.id)}>Approve</Button>}
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}
        </>
      )}

      {target != null && (
        <Card variant="outlined">
          <CardContent component={Stack} spacing={1}>
            <Typography variant="h6">Reconcile {target.kind} contract</Typography>
            <TextField multiline minRows={3} value={comment} onChange={(event) => setComment(event.target.value)} label="Change request" />
            <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
              <Button onClick={() => setTarget(null)}>Cancel</Button>
              <GenerationButton onGenerate={revise} disabled={store.isBusy || !comment.trim()}>Generate reconciled draft</GenerationButton>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
};

export default observer(InterfaceContractsView);
