import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Combobox as HeadlessCombobox } from "@headlessui/react";
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
      <HeadlessCombobox.Label className={css.comboLabel}>
        {label}:
      </HeadlessCombobox.Label>
      <HeadlessCombobox.Input
        onChange={handleQueryChange}
        className={css.comboQuery}
      />
      <HeadlessCombobox.Button className={css.comboButton}>
        <FontAwesomeIcon icon={faChevronDown} />
      </HeadlessCombobox.Button>
      <HeadlessCombobox.Options className={css.comboOptions}>
        {filteredItems.map((item) => (
          <HeadlessCombobox.Option
            key={item}
            value={item}
            className={css.comboOption}
          >
            {item}
          </HeadlessCombobox.Option>
        ))}
      </HeadlessCombobox.Options>
    </HeadlessCombobox>
  );
};
export default Combobox;
