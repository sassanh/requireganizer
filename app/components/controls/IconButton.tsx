import { IconProp } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import css from "./IconButton.module.css";

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconProp;
}

const IconButton: React.FunctionComponent<IconButtonProps> = ({
  children,
  className,
  icon,
  ...props
}) => (
  <button className={[css.iconButton, className].join(" ")} {...props}>
    <FontAwesomeIcon icon={icon} /> {children}
  </button>
);

export default IconButton;
