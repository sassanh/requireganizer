import { Tab } from "@headlessui/react";
import { observer } from "mobx-react-lite";
import { Fragment } from "react";

const TabTitle: React.FunctionComponent<
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

export default observer(TabTitle);
