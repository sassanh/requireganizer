import { Field, Label } from "@headlessui/react";
import { observer } from "mobx-react-lite";
import { useMemo } from "react";
import Textarea from "react-textarea-autosize";

import { Combobox, StructuralFragments } from "components";
import {
  Framework,
  PROGRAMMING_LANGUAGE_BY_FRAMEWORK,
  StructuralFragment,
  useStore,
} from "store";

import css from "./ProductOverview.module.css";

const ProductOverview: React.FunctionComponent = () => {
  const store = useStore();

  const frameworks = useMemo(() => Object.values(Framework), []);
  const programmingLanguages = useMemo(
    () =>
      store.productOverview?.framework
        ? PROGRAMMING_LANGUAGE_BY_FRAMEWORK[store.productOverview.framework]
        : [],
    [store.productOverview?.framework],
  );

  return (
    <div className={css.section}>
      <Field>
        <Label>Name</Label>
        <input
          className={css.textInput}
          value={store.productOverview?.name || ""}
          onChange={(event) => store.setName({ name: event.target.value })}
        />
      </Field>
      <Field>
        <Label>Purpose</Label>
        <pre>
          <Textarea
            className={[css.textInput, css.productOverview].join(" ")}
            value={store.productOverview.purpose || ""}
            placeholder="Summarize the key features and objectives of the software in a comprehensive overview..."
            onChange={(event) =>
              store.setPurpose({ purpose: event.target.value })
            }
          />
        </pre>
      </Field>
      <hr />
      <div
        style={{
          display: "flex",
          gap: "8px",
          justifyContent: "space-between",
        }}
      >
        <Combobox
          items={frameworks}
          label="Framework"
          value={store.productOverview?.framework}
          onChange={(framework) => store.setFramework({ framework })}
        />
        <Combobox
          items={programmingLanguages}
          label="Programming Language"
          value={store.productOverview.programmingLanguage}
          onChange={(programmingLanguage) =>
            store.setProgrammingLanguage({ programmingLanguage })
          }
        />
      </div>
      <hr />
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
    </div>
  );
};

export default observer(ProductOverview);
