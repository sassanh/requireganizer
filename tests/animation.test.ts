import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  animationMs,
  animationSeconds,
  isReducedMotion,
  presentationMs,
} from "../app/components/animation";

describe("reduced motion", () => {
  it("scales durations normally without the operating-system signal", () => {
    assert.equal(isReducedMotion(), false);
    assert.equal(animationMs(900), 900);
    assert.equal(animationSeconds(0.2), 0.2);
    assert.equal(presentationMs(900), 900);
  });

  it("stills every duration when the operating system asks for it", () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => ({
        matches: true,
        addEventListener: () => {},
      }),
    };
    try {
      assert.equal(isReducedMotion(), true);
      assert.equal(animationMs(900), 0);
      assert.equal(animationSeconds(0.2), 0);
      assert.equal(presentationMs(900), 0);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
