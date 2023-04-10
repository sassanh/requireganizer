import { Tab } from "@headlessui/react";
import { Fragment } from "react";

import css from "./IterationTabTitle.module.css";

const IterationTabTitle: React.FunctionComponent<
  React.AnchorHTMLAttributes<HTMLAnchorElement | { id: string }>
> = ({ children, id, ...props }) => {
  return (
    <Tab as={Fragment}>
      {({ selected }) => (
        <a
          href={`#${id}`}
          className={[css.tab, selected ? css.selectedTab : ""]
            .filter((className) => className)
            .join(" ")}
          {...props}
        >
          {children}
        </a>
      )}
    </Tab>
  );
};

export default IterationTabTitle;
