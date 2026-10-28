import { Box, Divider, Stack, TextField, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";

import { artifactElementId, StructuralFragments } from "components";
import { ApprovalFrame } from "components/ApprovalFrame";
import ApprovalMark from "components/ApprovalMark";
import { formatFieldCopy } from "components/copyFormat";
import { QualityIssues } from "components/QualityState";
import { StagedTextField } from "components/TextChange";
import { useShownStore } from "presentation";
import {
  OVERVIEW_PURPOSE_QUALITY_ID,
  StructuralFragment,
  useStore,
} from "store";

const PurposeField = observer(function PurposeField() {
  const store = useStore();
  const shown = useShownStore();
  const purposeElementId = artifactElementId("productOverview-purpose");
  return (
    <Box>
      <ApprovalFrame
        elementId={purposeElementId}
        approval={shown.approvalOf(OVERVIEW_PURPOSE_QUALITY_ID)}
        getCopyText={() =>
          formatFieldCopy("Purpose", shown.productOverview.purpose ?? "")
        }
      >
        <StagedTextField
          committed={shown.productOverview.purpose || ""}
          lastSigned={shown.signedTextOf(OVERVIEW_PURPOSE_QUALITY_ID)}
          elementId={artifactElementId("productOverview-purpose")}
          fullWidth
          multiline
          label="Purpose"
          placeholder="Summarize the key features and objectives of the software in a comprehensive overview..."
          slotProps={{ input: { readOnly: true } }}
        />
        <Stack sx={{ position: "absolute", right: 8, bottom: 8 }}>
          <ApprovalMark id={OVERVIEW_PURPOSE_QUALITY_ID} />
        </Stack>
      </ApprovalFrame>
      <QualityIssues
        issues={store.mechanicalIssuesForItem(OVERVIEW_PURPOSE_QUALITY_ID).map(({ message }) => message)}
        inset={false}
      />
    </Box>
  );
});

const SeedBlock = observer(function SeedBlock() {
  const shown = useShownStore();
  if (shown.overviewSeed == null) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        Starting intent (revision 0) — the words this overview was drafted from. Read-only.
      </Typography>
      <TextField
        value={shown.overviewSeed}
        fullWidth
        multiline
        slotProps={{ input: { readOnly: true } }}
      />
    </Box>
  );
});

const ProductOverview = observer(function ProductOverview() {
  const store = useStore();
  const shown = useShownStore();

  return (
    <Stack sx={{ gap: 2 }}>
      <SeedBlock />
      <PurposeField />
      <Divider />
      <StructuralFragments
        fragments={shown.productOverview.primaryFeatures}
        isDisabled={store.isBusy}
        structuralFragment={StructuralFragment.PrimaryFeature}
        title="Primary Features"
      />
      <StructuralFragments
        fragments={shown.productOverview.targetUsers}
        isDisabled={store.isBusy}
        structuralFragment={StructuralFragment.TargetUser}
        title="Target Users"
      />
    </Stack>
  );
});

export default ProductOverview;
