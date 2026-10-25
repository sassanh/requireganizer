import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currentHrefOf, projectCodeHref, projectHref, projectPlaceHref, stepHref } from "../app/lib/routes";

describe("project routes", () => {
  it("names the project in the query, so one static page serves every project", () => {
    assert.equal(projectHref("a b/c"), "/project?id=a+b%2Fc");
    assert.equal(projectCodeHref("p"), "/project/code?id=p");
    assert.equal(projectCodeHref("p", "src/a b.ts"), "/project/code?id=p&path=src%2Fa+b.ts");
  });

  it("keeps the project and module when a link changes the stage shown", () => {
    assert.equal(stepHref("/project", "id=p&module=m&step=product-overview", "user-stories"), "/project?id=p&module=m&step=user-stories");
    assert.equal(stepHref("/project", "id=p", "requirements"), "/project?id=p&step=requirements");
  });

  it("keeps the project when a link names a place in it", () => {
    assert.equal(projectPlaceHref("p", "?step=user-stories#US-1"), "/project?id=p&step=user-stories#US-1");
    assert.equal(
      projectPlaceHref("p", "?module=m&step=requirements#R-2"),
      "/project?id=p&module=m&step=requirements#R-2",
    );
    // A place never moves the link to another project.
    assert.equal(projectPlaceHref("p", "?id=other&step=x"), "/project?id=p&step=x");
  });

  it("leads a link from before projects moved to the query to the same place", () => {
    assert.equal(currentHrefOf("/project/p", "?step=x", "#US-1"), "/project?id=p&step=x#US-1");
    assert.equal(currentHrefOf("/project/a%20b/", "", ""), "/project?id=a+b");
    assert.equal(currentHrefOf("/project/p/code", "", ""), "/project/code?id=p");
    assert.equal(currentHrefOf("/project/p/code/src/a%20b.ts", "", ""), "/project/code?id=p&path=src%2Fa+b.ts");
    assert.equal(currentHrefOf("/project", "?id=p", ""), null);
    assert.equal(currentHrefOf("/elsewhere", "", ""), null);
  });
});
