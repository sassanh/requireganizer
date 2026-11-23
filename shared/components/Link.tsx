"use client";
import { UrlObject } from "url";

import MuiLink, { LinkProps as MuiLinkProps } from "@mui/material/Link";
import clsx from "clsx";
import NextLink, { LinkProps as NextLinkProps } from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

interface NextLinkComposedProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">,
    Omit<
      NextLinkProps,
      | "href"
      | "as"
      | "legacyBehavior"
      | "passHref"
      | "onMouseEnter"
      | "onClick"
      | "onTouchStart"
    > {
  to: NextLinkProps["href"];
  linkAs?: NextLinkProps["as"];
}

export const NextLinkComposed = React.forwardRef<
  HTMLAnchorElement,
  NextLinkComposedProps
>(function NextLinkComposed(props, ref) {
  const {
    to,
    linkAs,
    replace,
    scroll,
    shallow,
    prefetch,
    locale,
    ...other
  } = props;

  return (
    <NextLink
      ref={ref}
      href={to}
      prefetch={prefetch}
      as={linkAs}
      replace={replace}
      scroll={scroll}
      shallow={shallow}
      locale={locale}
      {...other}
    />
  );
});

export type LinkProps = {
  activeClassName?: string;
  as?: NextLinkProps["as"];
  href: string | UrlObject;
  linkAs?: NextLinkProps["as"]; // Useful when the as prop is shallow by styled().
  noLinkStyle?: boolean;
} & Omit<NextLinkComposedProps, "to" | "linkAs" | "href"> &
  Omit<MuiLinkProps, "href">;

// A styled version of the Next.js Link component:
// https://nextjs.org/docs/pages/api-reference/components/link
function Link(props: LinkProps) {
  const {
    activeClassName = "active",
    as,
    className: classNameProps,
    href,
    linkAs: linkAsProp,
    locale,
    noLinkStyle,
    prefetch,
    replace,
    role: _, // Link don't have roles.
    scroll,
    shallow,
    ...other
  } = props;

  const pathname = usePathname();
  const hrefPathname = typeof href === "string" ? href : href.pathname;
  const className = clsx(classNameProps, {
    [activeClassName]: pathname === hrefPathname && activeClassName,
  });

  const linkAs = linkAsProp || as;
  const nextjsProps = {
    to: href,
    linkAs,
    replace,
    scroll,
    shallow,
    prefetch,
    locale,
  };

  if (noLinkStyle) {
    return (
      <NextLinkComposed className={className} {...nextjsProps} {...other} />
    );
  }

  return (
    <MuiLink
      component={NextLinkComposed}
      className={className}
      {...nextjsProps}
      {...other}
    />
  );
}

export default Link;
