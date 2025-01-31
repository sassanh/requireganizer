import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { observer } from "mobx-react-lite";

import { STRUCTURAL_FRAGMENT_LABELS } from "store";
import { StructuralFragment } from "store/models";

import { IconButton } from "./controls";
import EditableItem from "./EditableItem";
import css from "./StructuralFragments.module.css";

interface StructuralFragmentsProps<Type extends StructuralFragment> {
  fragments: Type[];
  isDisabled: boolean;
  structuralFragment: Type["type"];
  onAddFragment: () => void;
  onComment: (parameters: { fragment: Type; comment: string }) => void;
  onRemoveFragment: (parameters: { fragment: Type }) => void;
}

const StructuralFragments = <Type extends StructuralFragment>({
  fragments,
  isDisabled,
  structuralFragment,
  onAddFragment,
  onComment,
  onRemoveFragment,
}: StructuralFragmentsProps<Type>): React.ReactElement => {
  return (
    <div className={css.section}>
      <ol>
        {fragments.map((fragment) => (
          <EditableItem<Type>
            key={fragment.id}
            fragment={fragment}
            isDisabled={isDisabled}
            onComment={onComment}
            onRemove={onRemoveFragment}
          />
        ))}
      </ol>
      <IconButton disabled={isDisabled} icon={faPlus} onClick={onAddFragment}>
        Add {STRUCTURAL_FRAGMENT_LABELS[structuralFragment]}
      </IconButton>
    </div>
  );
};

export default observer(StructuralFragments);
