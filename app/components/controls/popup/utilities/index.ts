import { assertUnreachable } from "@/utilities";

import { isRect } from "./rect-type";
import {
  Anchors,
  CompleteRect,
  Direction,
  Edge,
  Placement,
  Rect,
  RectProps,
  Target,
} from "./types";

export function placementToPosition(
  target: HTMLElement | SVGElement | Rect | null,
  placement: Placement
): Anchors {
  switch (placement) {
    case Placement.TopLeft:
      return {
        bottom: { edge: Edge.Start, element: target },
        left: { edge: Edge.Start, element: target },
      };
    case Placement.TopCenter:
      return {
        bottom: { edge: Edge.Start, element: target },
        horizontalCenter: { edge: Edge.Center, element: target },
      };
    case Placement.InnerTopCenter:
      return {
        horizontalCenter: { edge: Edge.Center, element: target },
        top: { edge: Edge.Start, element: target },
      };
    case Placement.TopRight:
      return {
        bottom: { edge: Edge.Start, element: target },
        right: { edge: Edge.End, element: target },
      };
    case Placement.BottomLeft:
      return {
        left: { edge: Edge.Start, element: target },
        top: { edge: Edge.End, element: target },
      };
    case Placement.BottomCenter:
      return {
        horizontalCenter: { edge: Edge.Center, element: target },
        top: { edge: Edge.End, element: target },
      };
    case Placement.InnerBottomCenter:
      return {
        bottom: { edge: Edge.End, element: target },
        horizontalCenter: { edge: Edge.Center, element: target },
      };
    case Placement.BottomRight:
      return {
        right: { edge: Edge.End, element: target },
        top: { edge: Edge.End, element: target },
      };
    case Placement.LeftTop:
      return {
        right: { edge: Edge.Start, element: target },
        top: { edge: Edge.Start, element: target },
      };
    case Placement.LeftCenter:
      return {
        right: { edge: Edge.Start, element: target },
        verticalCenter: { edge: Edge.Center, element: target },
      };
    case Placement.InnerLeftCenter:
      return {
        left: { edge: Edge.Start, element: target },
        verticalCenter: { edge: Edge.Center, element: target },
      };
    case Placement.LeftBottom:
      return {
        bottom: { edge: Edge.End, element: target },
        right: { edge: Edge.Start, element: target },
      };
    case Placement.RightTop:
      return {
        left: { edge: Edge.End, element: target },
        top: { edge: Edge.Start, element: target },
      };
    case Placement.RightCenter:
      return {
        left: { edge: Edge.End, element: target },
        verticalCenter: { edge: Edge.Center, element: target },
      };
    case Placement.InnerRightCenter:
      return {
        right: { edge: Edge.End, element: target },
        verticalCenter: { edge: Edge.Center, element: target },
      };
    case Placement.RightBottom:
      return {
        bottom: { edge: Edge.End, element: target },
        left: { edge: Edge.End, element: target },
      };
    case Placement.TopLeftInnerCorner:
      return {
        left: { edge: Edge.Start, element: target },
        top: { edge: Edge.Start, element: target },
      };
    case Placement.TopRightInnerCorner:
      return {
        right: { edge: Edge.End, element: target },
        top: { edge: Edge.Start, element: target },
      };
    case Placement.BottomLeftInnerCorner:
      return {
        bottom: { edge: Edge.End, element: target },
        left: { edge: Edge.Start, element: target },
      };
    case Placement.BottomRightInnerCorner:
      return {
        bottom: { edge: Edge.End, element: target },
        right: { edge: Edge.End, element: target },
      };
    case Placement.TopLeftOuterCorner:
      return {
        bottom: { edge: Edge.Start, element: target },
        right: { edge: Edge.Start, element: target },
      };
    case Placement.TopRightOuterCorner:
      return {
        bottom: { edge: Edge.Start, element: target },
        left: { edge: Edge.End, element: target },
      };
    case Placement.BottomLeftOuterCorner:
      return {
        right: { edge: Edge.Start, element: target },
        top: { edge: Edge.End, element: target },
      };
    case Placement.BottomRightOuterCorner:
      return {
        left: { edge: Edge.End, element: target },
        top: { edge: Edge.End, element: target },
      };
    default:
      assertUnreachable(placement, "Invalid placement");
  }
}

export function directionToEdge(
  direction: Direction,
  edge: Edge.Start | Edge.End
): "left" | "top" | "right" | "bottom";
export function directionToEdge(
  direction: Direction,
  edge: Edge
): "left" | "horizontalCenter" | "right" | "top" | "verticalCenter" | "bottom";

export function directionToEdge(
  direction: Direction,
  edge: Edge
): "left" | "horizontalCenter" | "right" | "top" | "verticalCenter" | "bottom" {
  switch (edge) {
    case Edge.Start:
      return direction === Direction.Horizontal ? "left" : "top";

    case Edge.Center:
      return direction === Direction.Horizontal
        ? "horizontalCenter"
        : "verticalCenter";

    case Edge.End:
      return direction === Direction.Horizontal ? "right" : "bottom";

    default:
      assertUnreachable(edge, "Invalid edge");
  }
}

export function calculateRelativePosition({
  value,
  direction,
}: {
  value: Target | number | undefined;
  direction: Direction;
}): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  if (value.element instanceof HTMLElement) {
    if (value.edge === Edge.Center) {
      return (
        (value.element.getBoundingClientRect()[
          directionToEdge(direction, Edge.Start)
        ] +
          value.element.getBoundingClientRect()[
          directionToEdge(direction, Edge.End)
          ]) /
        2
      );
    } else {
      return value.element.getBoundingClientRect()[
        directionToEdge(direction, value.edge)
      ];
    }
  }

  if (isRect(value.element)) {
    const completeRect: CompleteRect = {
      bottom:
        value.element.bottom === undefined
          ? value.element.top + value.element.height
          : value.element.bottom,
      height: value.element.height,
      horizontalCenter:
        value.element.right === undefined
          ? value.element.left + value.element.width / 2
          : value.element.right - value.element.width / 2,
      left:
        value.element.left === undefined
          ? value.element.right - value.element.width
          : value.element.left,
      right:
        value.element.right === undefined
          ? value.element.left + value.element.width
          : value.element.right,
      top:
        value.element.top === undefined
          ? value.element.bottom - value.element.height
          : value.element.top,
      verticalCenter:
        value.element.bottom === undefined
          ? value.element.top + value.element.height / 2
          : value.element.bottom - value.element.height / 2,
      width: value.element.width,
    };

    return completeRect[directionToEdge(direction, value.edge)];
  }

  return undefined;
}

export function calculateDimensions(
  dimension: HTMLElement | SVGElement | Rect | number | undefined | null,
  name: "width" | "height"
): number | undefined {
  if (dimension === undefined) {
    return undefined;
  }

  if (dimension === null) {
    return 0;
  }

  if (typeof dimension === "number") {
    return dimension;
  }

  if (dimension instanceof HTMLElement) {
    return dimension.getBoundingClientRect()[name];
  }

  return undefined;
}

// eslint-disable-next-line max-params,complexity,max-statements
export function calculatePosition(
  configuration: RectProps,
  margin: number,
  popupRef: React.RefObject<HTMLDivElement>,
  windowDimensions: { innerWidth: number; innerHeight: number },
  frame: DOMRect,
  width?: number,
  height?: number,
  horizontalAlternatives?: RectProps[],
  verticalAlternatives?: RectProps[]
): Omit<CompleteRect, "horizontalCenter" | "verticalCenter"> {
  if (!popupRef.current) {
    return { bottom: 0, left: 0, right: 0, top: 0 };
  }

  const position =
    configuration.target == null
      ? configuration
      : placementToPosition(configuration.target, configuration.placement);
  const top = calculateRelativePosition({
    direction: Direction.Vertical,
    value: position.top,
  });
  const verticalCenter = calculateRelativePosition({
    direction: Direction.Vertical,
    value: position.verticalCenter,
  });
  const bottom = calculateRelativePosition({
    direction: Direction.Vertical,
    value: position.bottom,
  });
  const left = calculateRelativePosition({
    direction: Direction.Horizontal,
    value: position.left,
  });
  const horizontalCenter = calculateRelativePosition({
    direction: Direction.Horizontal,
    value: position.horizontalCenter,
  });
  const right = calculateRelativePosition({
    direction: Direction.Horizontal,
    value: position.right,
  });

  const popupDimensions = popupRef.current.getBoundingClientRect();

  if (
    (top == null && bottom == null && verticalCenter == null) ||
    (left == null && right == null && horizontalCenter == null)
  ) {
    return { bottom: 0, left: 0, right: 0, top: 0 };
  }

  const newRect = {
    bottom:
      windowDimensions.innerHeight -
      (bottom == null
        ? top == null
          ? verticalCenter! + (height || popupDimensions.height || 0) / 2
          : top + (height || popupDimensions.height || 0)
        : bottom),
    height,
    left:
      left == null
        ? right == null
          ? horizontalCenter! - (width || popupDimensions.width || 0) / 2
          : right - (width || popupDimensions.width || 0)
        : left,
    right:
      windowDimensions.innerWidth -
      (right == null
        ? left == null
          ? horizontalCenter! + (width || popupDimensions.width || 0) / 2
          : left + (width || popupDimensions.width || 0)
        : right),
    top:
      top == null
        ? bottom == null
          ? verticalCenter! - (height || popupDimensions.height || 0) / 2
          : bottom - (height || popupDimensions.height || 0)
        : top,
    width,
  };

  const margins = {
    bottom: newRect.bottom - (windowDimensions.innerHeight - frame.bottom),
    left: newRect.left - frame.left,
    right: newRect.right - (windowDimensions.innerWidth - frame.right),
    top: newRect.top - frame.top,
  };

  if (
    horizontalAlternatives &&
    horizontalAlternatives.length > 0 &&
    ["left", "right"].some((key) => margins[key as "left" | "right"] < margin)
  ) {
    return calculatePosition(
      horizontalAlternatives[0],
      margin,
      popupRef,
      windowDimensions,
      frame,
      width,
      height,
      horizontalAlternatives.slice(1),
      verticalAlternatives
    );
  }

  if (
    verticalAlternatives &&
    verticalAlternatives.length > 0 &&
    ["top", "bottom"].some((key) => margins[key as "top" | "bottom"] < margin)
  ) {
    return calculatePosition(
      verticalAlternatives[0],
      margin,
      popupRef,
      windowDimensions,
      frame,
      width,
      height,
      horizontalAlternatives,
      verticalAlternatives.slice(1)
    );
  }

  if (margins.left < margin) {
    newRect.right += margins.left - margin;
    newRect.left = frame.left + margin;
  }

  if (margins.right < margin) {
    newRect.left += margins.right - margin;
    newRect.right = windowDimensions.innerWidth - frame.right + margin;
  }

  if (margins.top < margin) {
    newRect.bottom += margins.top - margin;
    newRect.top = frame.top + margin;
  }

  if (margins.bottom < margin) {
    newRect.top += margins.bottom - margin;
    newRect.right = windowDimensions.innerHeight - frame.bottom + margin;
  }

  return newRect;
}

export * from "./types";
