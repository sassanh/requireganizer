import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  Combobox as HeadlessCombobox,
  Label,
  ComboboxOptions,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
} from "@headlessui/react";
import { useEffect, useState } from "react";

import css from "./Combobox.module.css";

type StringLiteral<T> = T extends string
  ? string extends T
    ? never
    : T
  : never;

export interface ComboboxProps<T> {
  items: T[];
  label: string;
  value: T | null;
  onChange: (value: T) => void;
}

const Combobox = <T extends any>({
  items,
  label,
  value,
  onChange,
}: ComboboxProps<StringLiteral<T>>) => {
  const [query, setQuery] = useState("");
  const filteredItems =
    query === ""
      ? items
      : items.filter((item) => item.toLowerCase().includes(query));

  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    setQuery(event.target.value.toLowerCase());

  useEffect(() => {
    setQuery("");
  }, [items]);

  return (
    <HeadlessCombobox
      as="div"
      className={css.combo}
      value={value}
      onChange={onChange}
    >
      <Label className={css.comboLabel}>{label}:</Label>
      <ComboboxInput onChange={handleQueryChange} className={css.comboQuery} />
      <ComboboxButton className={css.comboButton}>
        <FontAwesomeIcon icon={faChevronDown} />
      </ComboboxButton>
      <ComboboxOptions className={css.comboOptions}>
        {filteredItems.map((item) => (
          <ComboboxOption key={item} value={item} className={css.comboOption}>
            {item}
          </ComboboxOption>
        ))}
      </ComboboxOptions>
    </HeadlessCombobox>
  );
};
export default Combobox;
