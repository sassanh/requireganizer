import { Box, Divider, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";

import { artifactElementId, StructuralFragments } from "components";
import { StagedTextField } from "components/TextChange";
import { useShownStore } from "presentation";
import { StructuralFragment, useStore } from "store";

const NameField = observer(function NameField() {
  const store = useStore();
  const shown = useShownStore();
  return (
    <Box id={artifactElementId("productOverview-name")}>
      <StagedTextField
        committed={shown.productOverview.name || ""}
        elementId={artifactElementId("productOverview-name")}
        fullWidth
        label="Name"
        onChange={(event) => store.setName({ name: event.target.value })}
      />
    </Box>
  );
});

const PurposeField = observer(function PurposeField() {
  const store = useStore();
  const shown = useShownStore();
  return (
    <Box id={artifactElementId("productOverview-purpose")}>
      <StagedTextField
        committed={shown.productOverview.purpose || ""}
        elementId={artifactElementId("productOverview-purpose")}
        fullWidth
        multiline
        label="Purpose"
        placeholder="Summarize the key features and objectives of the software in a comprehensive overview..."
        onChange={(event) =>
          store.setPurpose({ purpose: event.target.value })
        }
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
        onAddFragment={store.productOverview.addPrimaryFeature}
        onComment={store.handleComment}
        onRemoveFragment={({ fragment }) => {
          const real = store.productOverview.primaryFeatures.find(
            (item) => item.id === fragment.id,
          );
          if (real != null) {
            store.productOverview.removePrimaryFeature({ fragment: real });
          }
        }}
      />
      <StructuralFragments
        fragments={shown.productOverview.targetUsers}
        isDisabled={store.isBusy}
        structuralFragment={StructuralFragment.TargetUser}
        onAddFragment={store.productOverview.addTargetUser}
        onComment={store.handleComment}
        onRemoveFragment={({ fragment }) => {
          const real = store.productOverview.targetUsers.find(
            (item) => item.id === fragment.id,
          );
          if (real != null) {
            store.productOverview.removeTargetUser({ fragment: real });
          }
        }}
      />
    </Stack>
  );
});

export default ProductOverview;
