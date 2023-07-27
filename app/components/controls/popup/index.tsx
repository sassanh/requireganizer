import React, {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { RectProps, calculateDimensions, calculatePosition } from "./utilities";

export const UsePortalForPopupContext = createContext<boolean>(false);

export type Props = RectProps & {
  content: React.ReactElement;
  disableDrag?: boolean;
  frameElement?: HTMLElement | null;
  horizontalAlternatives?: RectProps[];
  isVisible?: boolean;
  margin?: number;
  mirrorOnOverflow?: boolean;
  testid?: string;
  verticalAlternatives?: RectProps[];
};

export interface ReturnType {
  popup?: React.ReactElement;
}

export default function usePopup({
  bottom,
  content,
  disableDrag,
  frameElement,
  height: height_,
  horizontalAlternatives,
  horizontalCenter,
  isVisible = true,
  left,
  margin = 16,
  placement,
  right,
  target,
  testid,
  top,
  width: width_,
  verticalAlternatives,
  verticalCenter,
}: Props): ReturnType {
  const width = calculateDimensions(width_, "width");
  const height = calculateDimensions(height_, "height");
  const [rect, setRect] = useState<RectProps>({
    height,
    left: 0,
    top: 0,
    width,
  });
  const popupRef = useRef<HTMLDivElement>(null);
  const usePortal = useContext(UsePortalForPopupContext);

  const updatePosition = useCallback(() => {
    const newRect = calculatePosition(
      {
        bottom,
        horizontalCenter,
        left,
        placement,
        right,
        target,
        top,
        verticalCenter,
      } as RectProps,
      margin,
      popupRef,
      { innerHeight: window.innerHeight, innerWidth: window.innerWidth },
      frameElement?.getBoundingClientRect() ||
      document.documentElement.getBoundingClientRect(),
      width,
      height,
      horizontalAlternatives,
      verticalAlternatives
    );

    setRect((oldRect: RectProps): RectProps => {
      if (
        (["left", "top", "width", "height"] as (keyof typeof newRect)[]).some(
          (property) =>
            !Number.isNaN(newRect[property]) &&
            newRect[property] !== oldRect[property]
        )
      ) {
        return {
          height: newRect.height,
          left: newRect.left,
          top: newRect.top,
          width: newRect.width,
        };
      }

      return oldRect;
    });
  }, [
    bottom,
    left,
    placement,
    right,
    target,
    top,
    horizontalCenter,
    verticalCenter,
    margin,
    frameElement,
    width,
    height,
    horizontalAlternatives,
    verticalAlternatives,
  ]);

  const resizeObserver = useRef<ResizeObserver>(null!);

  useEffect(() => {
    resizeObserver.current = new ResizeObserver(updatePosition);

    if (popupRef.current) {
      resizeObserver.current.observe(popupRef.current);
    }

    return (): void => resizeObserver.current.disconnect();
  }, [updatePosition]);

  useEffect(() => {
    if (isVisible) {
      updatePosition();
    }
  }, [isVisible, target, updatePosition]);

  useEffect(() => {
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition, true);

    return (): void => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition, true);
    };
  }, [updatePosition]);

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      event.stopPropagation();
      event.preventDefault();
    },
    []
  );

  const externalRef:
    | React.RefObject<HTMLElement>
    | React.RefCallback<HTMLElement> = (content as any).ref;

  const refCallback = useCallback(
    (element: HTMLDivElement | null) => {
      (popupRef as React.MutableRefObject<HTMLDivElement | null>).current =
        element;

      if (resizeObserver.current) {
        resizeObserver.current.disconnect();
        if (element) {
          resizeObserver.current.observe(element);
        }
      }

      /* istanbul ignore if */
      if (externalRef) {
        if (typeof externalRef === "function") {
          /* istanbul ignore next */
          externalRef(popupRef.current);
        } else {
          (
            externalRef as React.MutableRefObject<HTMLDivElement | null>
          ).current = popupRef.current;
        }
      }
    },
    [externalRef]
  );

  const style = {
    bottom: rect.bottom == null ? undefined : `${rect.bottom}px`,
    height: rect.height == null ? undefined : `${rect.height}px`,
    left: rect.left == null ? undefined : `${rect.left}px`,
    position: "fixed",
    right: rect.right == null ? undefined : `${rect.right}px`,
    top: rect.top == null ? undefined : `${rect.top}px`,
    width: rect.width == null ? undefined : `${rect.width}px`,
  };

  if (!isVisible) {
    return { popup: undefined };
  }

  const popup = createElement(
    content.type,
    {
      ...(content.key && { key: content.key }),
      draggable: disableDrag,
      ref: refCallback,
      ...(disableDrag && { onDragStart: handleDragStart }),
      "data-testid": testid,
      ...content.props,
      style: { ...style, ...content.props.style },
    },
    ...React.Children.toArray(content.props.children)
  );

  if (usePortal) {
    return {
      popup: createPortal(popup, document.getElementById("popup-container")!),
    };
  }

  return { popup };
}

export { Edge } from "./utilities";
export type { RectProps } from "./utilities";
