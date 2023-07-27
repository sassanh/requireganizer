import type { Rect } from "./rect-type";

export type { Rect } from "./rect-type";

export enum Direction {
  Horizontal,
  Vertical,
}

export enum Placement {
  TopLeft,
  TopCenter,
  InnerTopCenter,
  TopRight,
  BottomLeft,
  BottomCenter,
  InnerBottomCenter,
  BottomRight,
  LeftTop,
  LeftCenter,
  InnerLeftCenter,
  LeftBottom,
  RightTop,
  RightCenter,
  InnerRightCenter,
  RightBottom,
  TopLeftInnerCorner,
  TopRightInnerCorner,
  BottomLeftInnerCorner,
  BottomRightInnerCorner,
  TopLeftOuterCorner,
  TopRightOuterCorner,
  BottomLeftOuterCorner,
  BottomRightOuterCorner,
}

export enum Edge {
  Start,
  Center,
  End,
}

export interface CompleteRect {
  left: number;
  horizontalCenter: number;
  right: number;
  bottom: number;
  verticalCenter: number;
  top: number;
  width?: number;
  height?: number;
}

export interface Target {
  element: HTMLElement | SVGElement | Rect | null;
  edge: Edge;
}

export interface WithLeft {
  horizontalCenter?: undefined;
  left: number | Target;
  right?: undefined;
}

export interface WithHorizontalCenter {
  horizontalCenter: number | Target;
  left?: undefined;
  right?: undefined;
}

export interface WithRight {
  horizontalCenter?: undefined;
  left?: undefined;
  right: number | Target;
}

export interface WithTop {
  top: number | Target;
  bottom?: undefined;
  verticalCenter?: undefined;
}

export interface WithVerticalCenter {
  bottom?: undefined;
  top?: undefined;
  verticalCenter: number | Target;
}

export interface WithBottom {
  top?: undefined;
  bottom: number | Target;
  verticalCenter?: undefined;
}

export type Anchors = (WithLeft | WithHorizontalCenter | WithRight) &
  (WithBottom | WithVerticalCenter | WithTop);

export type WithAnchors = Anchors & {
  target?: undefined;
  placement?: undefined;
};

export interface WithPlacement {
  target: HTMLElement | SVGElement | Rect | null;
  placement: Placement;
  top?: undefined;
  verticalCenter?: undefined;
  bottom?: undefined;
  left?: undefined;
  horizontalCenter?: undefined;
  right?: undefined;
}

export interface BasicRectProps {
  width?: HTMLElement | SVGElement | Rect | number | null;
  height?: HTMLElement | SVGElement | Rect | number | null;
}

export type RectProps = BasicRectProps & (WithAnchors | WithPlacement);
