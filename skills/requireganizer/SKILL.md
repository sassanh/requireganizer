---
name: requireganizer
description: The person's signed spec for this repository, kept in Requireganizer as module overview, capabilities, features, target users, user stories, requirements, acceptance criteria, the boundary tests use and abstract tests, each traced to what it builds on. Read it before implementing to build what was decided instead of guessing, and name the items your code covers. Write stage items through its MCP tools for the person to sign. Use when the repository has a requireganizer.json, the requireganizer MCP tools are available, or the user mentions Requireganizer.
---

# Requireganizer

Requireganizer keeps a project's specification as stages. Each stage builds
on the stages before it and opens once they are complete:

1. Module Overview
2. Capabilities, building on Module Overview
3. Features and Target Users, building on Capabilities
4. User Stories, building on Features and Target Users
5. Requirements, building on User Stories
6. Acceptance Criteria, building on Requirements
7. Boundary, building on Acceptance Criteria
8. Abstract tests, building on Acceptance Criteria and Boundary

The person signs every item, coverage and impact in Requireganizer's page; no
tool signs.

## Read before you act

- Call `get_workflow_state` first, and again after anything changes.
- Read a stage's rules with `get_stage_rules` before writing it, and follow
  them: the person signs against the same rules.
- To work on a module other than the one the person has open, call
  `switch_module` with a name `get_workflow_state` lists. The person's page
  opens that module too; call `get_workflow_state` again before working on it.
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
  users, as codes, an outcome and a reason. A requirement holds only what
  follows "The system must". An acceptance criterion is a Given, a When, left
  empty for a state that holds with no event, and a Then.
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
- Answer a thread in the thread only. Its reply is where you tell the person
  what changed or what waits; do not repeat, summarize or announce it in your
  conversation with them.

## Where the person works

The server instructions give the page's address. Point the person there to
review and sign.
