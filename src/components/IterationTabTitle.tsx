import { Tab } from "@headlessui/react";
import { Fragment } from "react";

const IterationTabTitle: React.FunctionComponent<
  React.AnchorHTMLAttributes<HTMLAnchorElement | { id: string }>
> = ({ children, id, ...props }) => {
  return (
    <Tab as={Fragment}>
      {({ selected }) => (
        <a
          href={`#${id}`}
          className={"tab" + (selected ? " selected-tab" : "")}
          {...props}
        >
          {children}
        </a>
      )}
    </Tab>
  );
};

export default IterationTabTitle;
