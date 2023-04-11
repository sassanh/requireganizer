import { Tab } from "@headlessui/react";
import { Fragment } from "react";

import css from "./IterationTabTitle.module.css";

const IterationTabTitle: React.FunctionComponent<
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { disabled: boolean }
> = ({ children, id, disabled, ...props }) => {
  return (
    <Tab as={Fragment}>
      <a
        onClick={disabled ? (event) => event.preventDefault() : undefined}
        href={`#${id}`}
        className={[css.tab, disabled ? css.disabledTab : ""]
          .filter((className) => className)
          .join(" ")}
        {...props}
      >
        {children}
      </a>
    </Tab>
  );
};

export default IterationTabTitle;
