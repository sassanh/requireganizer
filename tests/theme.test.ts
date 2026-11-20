import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getContrastRatio } from "@mui/material/styles";

import { theme } from "../app/theme";

describe("the theme", () => {
  it("keeps primary text readable on each color scheme's background", () => {
    for (const scheme of ["light", "dark"] as const) {
      const palette = theme.colorSchemes[scheme]!.palette;
      for (const surface of [palette.background.default, palette.background.paper]) {
        assert.ok(
          getContrastRatio(palette.primary.main, surface!) >= 4.5,
          `${scheme}: primary ${palette.primary.main} on ${surface} is below the 4.5:1 contrast text needs`,
        );
      }
    }
  });
});
