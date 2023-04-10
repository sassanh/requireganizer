import { observer } from "mobx-react-lite";
import Textarea from "react-textarea-autosize";

import { useStore } from "store";

import css from "./ProductOverview.module.css";

const ProductOverview: React.FunctionComponent = () => {
  const store = useStore();

  const handleProductOverviewChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => store.setProductOverview(event.target.value);

  return (
    <div className={css.section}>
      <pre>
        <Textarea
          className={[css.textInput, css.productOverview].join(" ")}
          value={store.productOverview || ""}
          onChange={handleProductOverviewChange}
        />
      </pre>
    </div>
  );
};

export default observer(ProductOverview);
