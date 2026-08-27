import { Box, Divider, Stack, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";

import { artifactElementId, StructuralFragments } from "components";
import { useStagedContent } from "components/changeQueue";
import { useShownStore } from "presentation";
import { StructuralFragment, useStore } from "store";

const NameField = observer(function NameField() {
  const store = useStore();
  const shown = useShownStore();
  const displayed = useStagedContent(
    "productOverview/name",
    artifactElementId("productOverview-name"),
    shown.productOverview.name || "",
  );
  return (
    <Box id={artifactElementId("productOverview-name")}>
      <TextField
        fullWidth
        label="Name"
        value={displayed}
        onChange={(event) => store.setName({ name: event.target.value })}
      />
    </Box>
  );
});

const PurposeField = observer(function PurposeField() {
  const store = useStore();
  const shown = useShownStore();
  const displayed = useStagedContent(
    "productOverview/purpose",
    artifactElementId("productOverview-purpose"),
    shown.productOverview.purpose || "",
  );
  return (
    <Box id={artifactElementId("productOverview-purpose")}>
      <TextField
        value={displayed}
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
