import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { codesMatch, formatCode } from "../app/lib/fragmentCodes";
import { Store } from "../app/store/store";

describe("fragment codes", () => {
  it("pads every code of a list to the width of its largest number, at least two digits", () => {
    assert.equal(formatCode("REQ", 4, 9), "REQ-04");
    assert.equal(formatCode("REQ", 4, 99), "REQ-04");
    assert.equal(formatCode("REQ", 4, 100), "REQ-004");
    assert.equal(formatCode("REQ", 100, 100), "REQ-100");
    assert.equal(formatCode("REQ", 4, 1000), "REQ-0004");
  });

  it("names an item however its number is padded", () => {
    for (const written of ["REQ-4", "REQ-04", "REQ-004"]) assert.ok(codesMatch(written, "REQ-04"), written);
    assert.ok(!codesMatch("REQ-40", "REQ-04"));
    assert.ok(!codesMatch("US-04", "REQ-04"));
    assert.ok(!codesMatch("", "REQ-04"));
    assert.ok(!codesMatch("REQ-", "REQ-04"));
  });

  it("gives a store's items codes padded to their list's length", () => {
    const features = (count: number) => Array.from({ length: count }, (_, i) => ({ content: `Feature ${i + 1}` }));
    const store = Store.create({ productOverview: { primaryFeatures: features(3), targetUsers: [{ content: "Owners" }] } });
    assert.deepEqual(store.productOverview.primaryFeatures.map((item) => item.getCode()), ["FEA-01", "FEA-02", "FEA-03"]);
    assert.equal(store.productOverview.targetUsers[0]!.getCode(), "USR-01");

    const large = Store.create({ productOverview: { primaryFeatures: features(100) } });
    assert.equal(large.productOverview.primaryFeatures[0]!.getCode(), "FEA-001");
    assert.equal(large.productOverview.primaryFeatures[99]!.getCode(), "FEA-100");
  });
});
