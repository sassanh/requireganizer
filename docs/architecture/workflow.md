# Engineering workflow

## Canonical order

```text
Description
  -> Product overview
  -> User stories
  -> Requirements
  -> Acceptance criteria
  -> Test scenarios
  -> Test cases
  -> Test code
  -> Application code
```

User stories intentionally precede requirements. The workflow first establishes a valuable outcome for a specific user, then translates that outcome into solution-neutral system obligations.

## Stage contracts

| Stage | Primary question | Required traceability |
| --- | --- | --- |
| Product overview | What product, users, outcomes, framework, and language are in scope? | Framework and language must be a supported pair. |
| User stories | What independently valuable outcome does a user need? | Every primary feature is covered; references point to features or target users. |
| Requirements | What must the system verifiably do? | Every user story is covered; references point to stories or features. |
| Acceptance criteria | What observable condition proves the obligation is satisfied? | Every requirement is covered; references point to requirements or stories. |
| Test scenarios | What high-level situation exercises the criterion? | Every acceptance criterion is covered. |
| Test cases | What reproducible steps and expected result test one scenario? | Every case references exactly its parent scenario and may trace to relevant criteria or requirements. |
| Test code | What executable test implements one reviewed case? | The scenario file and test-case annotations are exact and preserved. |
| Application code | What implementation satisfies the executable specification? | Reserved as the downstream implementation stage. |

## Artifact rules

Generated artifact-list operations submit the complete desired list for one stage through its formal result tool, not a patch. Each item includes:

- a unique proposal-local key;
- an existing persisted ID only when preserving the same artifact intent;
- content, or test-case title, steps, and expected result;
- a `p0`, `p1`, or `p2` priority;
- references to exact existing upstream IDs;
- dependencies expressed as keys of items in the same proposal.

New items omit `id`. After the complete proposal validates, the application creates their UUIDs and resolves dependency keys to persisted IDs. The validator rejects fabricated preserved IDs or references, duplicate IDs, keys, or references, missing coverage, missing parent-scenario links, references to another scenario, unknown dependency keys, self-dependencies, and dependency cycles.

When an existing scenario ID is preserved, its nested test cases remain attached during reconciliation. A complete-list result can still intentionally remove a scenario by omitting it.

## Human approval remains essential

Contract validity means function arguments are safe to apply and structurally coherent. It does not prove the product decision is correct. Reviewers still own scope, domain truth, risk, priority, and approval.
