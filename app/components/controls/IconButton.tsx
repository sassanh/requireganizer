import { IconProp } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Ref, forwardRef } from "react";

import css from "./IconButton.module.css";

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconProp;
}

const IconButton = (
  { children, className, icon, ...props }: IconButtonProps,
  ref: Ref<HTMLButtonElement>
) => (
  <button
    ref={ref}
    className={[css.iconButton, className].join(" ")}
    {...props}
  >
    <FontAwesomeIcon icon={icon} /> {children}
  </button>
);

export default forwardRef(IconButton);
