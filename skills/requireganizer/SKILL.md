---
name: requireganizer
description: The person's signed spec for this repository, kept in Requireganizer as module overview, capabilities, features, target users, user stories, quality goals, constraints, requirements, acceptance criteria, the boundary tests use and abstract tests, each traced to what it builds on. Read it before implementing to build what was decided instead of guessing, and name the items your code covers. Write stage items through its MCP tools for the person to sign. Use when the repository has a requireganizer.json, the requireganizer MCP tools are available, or the user mentions Requireganizer.
---

# Requireganizer

Requireganizer keeps a project's specification as stages. Each stage builds
on the stages before it and opens once they are complete:

1. Module Overview
2. Capabilities, building on Module Overview
3. Features and Target Users, building on Capabilities
4. Needs (user stories, quality goals and constraints), building on Features
   and Target Users
5. Requirements, building on Needs
6. Acceptance Criteria, building on Requirements
7. Boundary, building on Acceptance Criteria
8. Abstract tests, building on Acceptance Criteria and Boundary

The person signs every item, coverage and impact in Requireganizer's page; no
tool signs.

## Read before you act

- Give yourself a name with `name_yourself` before anything else: the one
  your user calls you by, or ask them.
- Call `get_workflow_state` first, and again after anything changes. A stage
  in its `stagesWaitingForYou` is one the person asks you to write next.
  Pass that entry's `request` as `fulfils` in the `write_items` call that
  completes it, which may change no item.
- A stage in its `stagesToReviewForYou` is one the person asks you to
  review. Check each item against the published rules of its kind, then
  answer with `answer_review` and that entry's `request`, naming each item
  that breaks a rule, the rule and how it breaks it, or none.
- When you cannot answer a request given to you, pass its request's id to
  `report_cannot_answer` with why.
- Before writing a stage, read the rules of each kind of item it holds with
  `get_stage_rules`, and follow them: the person signs against the same
  rules.
- To work on a module other than the one the person has open, pass `module`
  to a tool that takes one, named by `get_workflow_state` under
  `otherModules` or by a request given to you. Codes and `codesVersion` are
  then that module's. The tools that answer a request take its id, which
  names its module.
- Read items with `get_items` again before changing or citing them, rather
  than relying on an earlier read: codes are positions and move.

## When implementing code

- Build from approved items only. Say so before relying on an item that is
  not approved.
- When you tell the person which requirement or criterion your code covers,
  name the item as Requireganizer shows it.

## When writing a stage

- Write each item in the fields `get_stage_rules` lists. A capability and a
  target user are each a name and a one-sentence description; a feature adds
  the code of the one capability it belongs to. A user story is its target
  users, as codes, an outcome and a reason. A quality goal is a quality and a
  reason; a constraint is a limit and its source. A requirement's obligation
  holds only what follows "The system must"; a requirement also has a type,
  functional, quality or constraint, and may have a rationale. An acceptance
  criterion is a Given, a When, left empty for a state that holds with no
  event, and a Then.
- The Boundary holds one boundary statement, entity types, sets of words and
  operations. Write entity types and sets of words before the operations
  that name them: items added in one write cannot name each other by code.
  An operation is a direct setup, an action or an observation, with a phrase
  holding each input's place as `{name}`, typed inputs, a result type or
  none, and the acceptance criteria that need it as references. A type is an
  object such as `{"simple": "whole number"}` or `{"entity": "ENT-01",
  "list": true}`.
- An abstract test chooses one acceptance criterion and holds Given, When and
  Then steps, and optionally a table of values. A step calls an operation by
  code and gives each input one value: written out (text in double quotes),
  `"empty": true` where its type is possibly empty, a table column, or an
  earlier named step's result. A Then step expects an
  observation, a result, a duration or a refusal. `get_stage_rules` gives an
  example of an operation's fields and of an abstract test's.
- Write, change and remove items with `write_items`. Check what it reports it
  added, changed and proposed for removal against what you meant to do,
  before telling the person.
- To change the order the page shows items in, use `reorder_items` with every
  item of the stage once. It moves codes, not content, and needs no signature.
- Fix exactly what a refused write names and write again. Never weaken the
  items to get past a check.
- If the stage you need is closed, the person has signatures to give first.
  Tell them which stage is waiting.
- Change only the items a change affects. An out-of-date item that still
  holds stays as it is: the person signs it as it is.
- A write to an earlier stage applies at once and closes the stages that
  build on it until it is complete again. So one write never changes a stage
  together with a stage that builds on it: change the earlier stage, wait for
  the person to sign it, then change the later one.
- When you lack the information a stage needs, ask the person. Do not invent
  scope.

## Change requests from the person

- Answer the threads `get_workflow_state` lists as waiting for you. To change
  items, use `write_items` and name the thread in its `answers`, with a reply
  saying what changed. To ask or to disagree, use `reply_to_thread`. Only the
  person resolves a thread.
- A thread in a stage that your change to an earlier stage closes waits:
  change the earlier stage without answering it, and answer it once its
  stage is open again.
- Answer a thread in the thread only. Its reply is where you tell the person
  what changed or what waits; do not repeat, summarize or announce it in your
  conversation with them.
- Each reply speaks only to its thread's request and makes sense read on its
  own.
- Give an item's code in a reply only inside a marked mention of that item:
  `[CODE](item:ID)`, with the code and id `get_items` gives the item, or
  `[Module name/CODE](item:ID)` for an item of another module than the
  thread's, read with `get_items` and that `module`. Pass the
  `codesVersion` of the thread's module; a reply whose mention's code names
  no item, or another item than its id, is refused.
- Mention an item that the changes sent with a reply add as
  `[](change:N)`, N being the place of its add change among the changes,
  counting from 1; it has no code or id before the write.
- Name an item that no longer exists by what it said, never by a code.

## Pointing the person to units

- When items, coverages or impacts need the person's attention, pass
  `pointTo` with `write_items` or `reply_to_thread`: `units`, each with
  `item` as its code, or `Module name/CODE` for another module's; for its
  coverage or impact, add `unit` and the `stage` that holds it; for an item
  the same write adds, `change` instead of `item`, the place of its add
  change among the changes, counting from 1. Give one `text` for the set,
  at most 80 characters, saying why.
- The person is offered a way to go to each in turn; their focus stays
  where it is.
- A pointer that names nothing, names a change that adds no item, or has no
  text or a longer one refuses the whole call, which changes nothing.

## Where the person works

The server instructions give the page's address. Point the person there to
review and sign.
