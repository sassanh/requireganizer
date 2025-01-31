import { Divider, MenuItem, Select, Stack, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useMemo } from "react";

import { StructuralFragments } from "components";
import {
  Framework,
  PROGRAMMING_LANGUAGE_BY_FRAMEWORK,
  ProgrammingLanguage,
  StructuralFragment,
  useStore,
} from "store";
import { isEnumMember } from "utilities";

const ProductOverview: React.FunctionComponent = () => {
  const store = useStore();

  const frameworks = useMemo(() => Object.values(Framework), []);
  const programmingLanguages = useMemo(
    () =>
      store.productOverview.framework
        ? PROGRAMMING_LANGUAGE_BY_FRAMEWORK[store.productOverview.framework]
        : [],
    [store.productOverview.framework],
  );

  return (
    <Stack gap={2}>
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
      <Stack direction="row" gap={2}>
        <Select
          fullWidth
          label="Framework"
          value={store.productOverview.framework || ""}
          onChange={({ target: { value } }) => {
            if (!isEnumMember(value, Framework)) return;
            store.setFramework({ framework: value });
          }}
        >
          {frameworks.map((framework) => (
            <MenuItem key={framework} value={framework}>
              {framework}
            </MenuItem>
          ))}
        </Select>
        <Select
          fullWidth
          label="Programming Language"
          value={store.productOverview.programmingLanguage || ""}
          onChange={({ target: { value } }) => {
            if (!isEnumMember(value, ProgrammingLanguage)) return;
            store.setProgrammingLanguage({ programmingLanguage: value });
          }}
        >
          {programmingLanguages.map((programmingLanguage) => (
            <MenuItem key={programmingLanguage} value={programmingLanguage}>
              {programmingLanguage}
            </MenuItem>
          ))}
        </Select>
      </Stack>
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
