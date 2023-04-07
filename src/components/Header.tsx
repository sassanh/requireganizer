import React from "react";

interface HeaderProps {
  title: React.ReactNode;
  left?: React.ReactNode[] | React.ReactNode;
  right?: React.ReactNode[] | React.ReactNode;
}

const Header: React.FunctionComponent<HeaderProps> = ({
  title,
  left,
  right,
}: HeaderProps): React.ReactElement => (
  <div className="tab-header">
    <h1 className="header-title">{title}</h1>
    <div className="header-previous">{left}</div>
    <div className="header-next">{right}</div>
  </div>
);

export default Header;
