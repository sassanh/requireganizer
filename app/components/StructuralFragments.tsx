import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { observer } from "mobx-react-lite";

import { STRUCTURAL_FRAGMENT_LABELS, StructrualFragment } from "store";
import { StructuralFragment } from "store/models";

import EditableItem from "./EditableItem";
import css from "./StructuralFragments.module.css";
import { IconButton } from "./controls";

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
    <div className={css.section}>
      <ol>
        {fragments.map((fragment) => (
          <EditableItem
            key={fragment.id}
            fragment={fragment}
            onRemove={onRemoveFragment}
          />
        ))}
      </ol>
      <IconButton icon={faPlus} onClick={onAddFragment}>
        Add {STRUCTURAL_FRAGMENT_LABELS.get(structuralFragment)}
      </IconButton>
    </div>
  );
};

export default observer(StructuralFragments);
