import { Divider, Stack, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";

import { StructuralFragments } from "components";
import {
  StructuralFragment,
  useStore,
} from "store";

const ProductOverview: React.FunctionComponent = () => {
  const store = useStore();

  return (
    <Stack sx={{
      gap: 2
    }}>
      <TextField
        fullWidth
        label="Name"
        value={store.productOverview.name || ""}
        onChange={(event) => store.setName({ name: event.target.value })}
      />
      <TextField
        value={store.productOverview.purpose || ""}
        fullWidth
        multiline
        placeholder="Summarize the key features and objectives of the software in a comprehensive overview..."
        onChange={(event) => store.setPurpose({ purpose: event.target.value })}
      />
      <Divider />
      <StructuralFragments
        fragments={store.productOverview.primaryFeatures}
        isDisabled={store.isBusy}
        structuralFragment={StructuralFragment.PrimaryFeature}
        onAddFragment={store.productOverview.addPrimaryFeature}
        onComment={store.handleComment}
        onRemoveFragment={store.productOverview.removePrimaryFeature}
      />
      <StructuralFragments
        fragments={store.productOverview.targetUsers}
        isDisabled={store.isBusy}
        structuralFragment={StructuralFragment.TargetUser}
        onAddFragment={store.productOverview.addTargetUser}
        onComment={store.handleComment}
        onRemoveFragment={store.productOverview.removeTargetUser}
      />
    </Stack>
  );
};

export default observer(ProductOverview);
