import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { observer } from "mobx-react-lite";
import { STRUCTURAL_FRAGMENT_LABELS, StructrualFragment } from "store";
import { StructuralFragment } from "store/models";

import EditableItem from "./EditableItem";

interface StructuralFragmentsProps<Type extends StructuralFragment> {
  fragments: Type[];
  structuralFragment: StructrualFragment;
  onAddFragment: () => void;
  onRemoveFragment: (fragment: Type) => void;
}

const StructuralFragments = <Type extends StructuralFragment>({
  fragments,
  structuralFragment,
  onAddFragment,
  onRemoveFragment,
}: StructuralFragmentsProps<Type>): React.ReactElement => {
  return (
    <div className="section">
      <ol>
        {fragments.map((fragment) => (
          <EditableItem
            key={fragment.id}
            fragment={fragment}
            onRemove={onRemoveFragment}
          />
        ))}
      </ol>
      <button className="icon-button" onClick={onAddFragment}>
        <FontAwesomeIcon icon={faPlus} /> Add{" "}
        {STRUCTURAL_FRAGMENT_LABELS.get(structuralFragment)}
      </button>
    </div>
  );
};

export default observer(StructuralFragments);
