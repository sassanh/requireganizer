export interface WithLeft {
  left: number;
  right?: undefined;
}

export interface WithRight {
  left?: undefined;
  right: number;
}

export interface WithTop {
  bottom?: undefined;
  top: number;
}

export interface WithBottom {
  bottom: number;
  top?: undefined;
}

export type Rect = {
  width: number;
  height: number;
} & (WithLeft | WithRight) &
  (WithBottom | WithTop);

export function isRect(object: unknown): object is Rect {
  return (
    typeof object === "object" &&
    object != null &&
    "width" in object &&
    "height" in object &&
    (("left" in object && !("right" in object)) ||
      ("right" in object && !("left" in object))) &&
    (("top" in object && !("bottom" in object)) ||
      ("bottom" in object && !("top" in object)))
  );
}
