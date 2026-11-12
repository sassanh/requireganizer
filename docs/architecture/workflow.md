# Engineering workflow

Each module of a product holds its spec as stages. A stage builds on the stages before it: it opens once they are complete, its items reference their items, and it asks for a coverage of each of their items of the kinds it covers.

```text
Module Overview → Capabilities → Features and Target Users → Needs
→ Requirements → Acceptance Criteria → Boundary → Abstract tests
```

Abstract tests build on both Acceptance Criteria and Boundary.

## Stages and kinds

| Stage | Kinds of item | Covers |
| --- | --- | --- |
| Module Overview | purpose | nothing |
| Capabilities | capability | the purpose |
| Features and Target Users | feature, target user | each capability, by its features |
| Needs | user story, quality goal, constraint | each feature, by its user stories |
| Requirements | requirement (functional, quality or constraint) | each user story, quality goal and constraint |
| Acceptance Criteria | acceptance criterion | each requirement |
| Boundary | boundary statement, entity type, set of words, operation | nothing |
| Abstract tests | abstract test | each acceptance criterion and each operation |

## Published rules

Every writer and every signer of a kind works to the same published rules. A kind's rules start with the question its items answer, then hold its own rules, the rules every kind shares, and examples: one item of the kind, and for each kind in its stage and in the stages next to it, an item of that kind that could pass for one of this kind, with a sentence saying why it does not. A rule a form can enforce, such as a required field, is enforced when the item is saved instead.

## Progress

A stage is open while every stage it builds on, directly or through other stages, is complete. A closed stage stays readable but takes no writing, signing or thread activity. A stage is complete when it holds at least one item and every item, coverage and impact in it is approved. Changing a complete stage keeps the stages building on it readable but closed until it is complete again.

## Signatures

A signature covers the exact version it was given for: an item's content, references and dependencies; a coverage's item and the items referencing it; an impact's item version or its removal. It records who gave it. An item, coverage or impact is approved while a signature on it counts, no thread on it is open, and, for an item, it is neither out of date nor proposed for removal.

Removing a signed item proposes its removal, which waits for a signature; an item never signed is removed at once. An item changed since its last signature, or proposed for removal, can be returned to the signed version.

## Out of date

An item is out of date while an item it references or depends on has changed since it was written or signed, is removed, is not approved, or is out of date itself. The same holds for a dependency on an item of another module. An out-of-date item that still holds can be signed as it is.

## Coverage and impact

A coverage is one signature per item of a covered kind: the items referencing it cover it fully. An impact is asked in a stage for each upstream item changed or removed since the stage took it in: no approved item of the stage relies on the change without referencing the item.

## Change requests

A change request opens a thread on an item, a coverage or an impact, with at most one open thread per unit. The answerer replies alone or with changes to any items, and only the spec owner resolves a thread.
