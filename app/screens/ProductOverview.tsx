import { Box, Divider, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";

import { artifactElementId, StructuralFragments } from "components";
import ApprovalMark from "components/ApprovalMark";
import { useStagedApproval } from "components/changeQueue";
import { ApprovalBar, QualityIssues, approvalBarSx } from "components/QualityState";
import { StagedTextField } from "components/TextChange";
import { useShownStore } from "presentation";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  StructuralFragment,
  useStore,
} from "store";

const NameField = observer(function NameField() {
  const store = useStore();
  const shown = useShownStore();
  const nameElementId = artifactElementId("productOverview-name");
  const nameApproval = useStagedApproval(
    nameElementId,
    shown.productOverview.nameApproval,
  );
  return (
    <Box
      id={nameElementId}
      sx={approvalBarSx()}
    >
      <ApprovalBar status={nameApproval} />
      <StagedTextField
        committed={shown.productOverview.name || ""}
        lastSigned={shown.productOverview.lastSignedName}
        elementId={artifactElementId("productOverview-name")}
        fullWidth
        label="Name"
        slotProps={{ input: { readOnly: true } }}
      />
      <Stack sx={{ position: "absolute", right: 8, bottom: 8 }}>
        <ApprovalMark
          id={OVERVIEW_NAME_QUALITY_ID}
          onRequestChange={(comment) =>
            store.handleOverviewFieldComment({ field: "name", comment })
          }
          requestChangeDisabled={store.isBusy}
        />
      </Stack>
      <QualityIssues
        issues={store.mechanicalIssuesForItem(OVERVIEW_NAME_QUALITY_ID).map(({ message }) => message)}
        inset={false}
      />
    </Box>
  );
});

const PurposeField = observer(function PurposeField() {
  const store = useStore();
  const shown = useShownStore();
  const purposeElementId = artifactElementId("productOverview-purpose");
  const purposeApproval = useStagedApproval(
    purposeElementId,
    shown.productOverview.purposeApproval,
  );
  return (
    <Box
      id={purposeElementId}
      sx={approvalBarSx()}
    >
      <ApprovalBar status={purposeApproval} />
      <StagedTextField
        committed={shown.productOverview.purpose || ""}
        lastSigned={shown.productOverview.lastSignedPurpose}
        elementId={artifactElementId("productOverview-purpose")}
        fullWidth
        multiline
        label="Purpose"
        placeholder="Summarize the key features and objectives of the software in a comprehensive overview..."
        slotProps={{ input: { readOnly: true } }}
      />
      <Stack sx={{ position: "absolute", right: 8, bottom: 8 }}>
        <ApprovalMark
          id={OVERVIEW_PURPOSE_QUALITY_ID}
          onRequestChange={(comment) =>
            store.handleOverviewFieldComment({ field: "purpose", comment })
          }
          requestChangeDisabled={store.isBusy}
        />
      </Stack>
      <QualityIssues
        issues={store.mechanicalIssuesForItem(OVERVIEW_PURPOSE_QUALITY_ID).map(({ message }) => message)}
        inset={false}
      />
    </Box>
  );
});

const ProductOverview = observer(function ProductOverview() {
  const store = useStore();
  const shown = useShownStore();

  return (
    <Stack sx={{ gap: 2 }}>
      <Box sx={{ display: "grid", gap: 2 }}>
        <NameField />
        <PurposeField />
      </Box>
      <Divider />
      <StructuralFragments
        fragments={shown.productOverview.primaryFeatures}
        isDisabled={store.isBusy}
        structuralFragment={StructuralFragment.PrimaryFeature}
        title="Primary Features"
        onComment={store.handleComment}
      />
      <StructuralFragments
        fragments={shown.productOverview.targetUsers}
        isDisabled={store.isBusy}
        structuralFragment={StructuralFragment.TargetUser}
        title="Target Users"
        onComment={store.handleComment}
      />
    </Stack>
  );
});

export default ProductOverview;
