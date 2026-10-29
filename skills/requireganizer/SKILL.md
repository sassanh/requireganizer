---
name: requireganizer
description: The person's approved spec for this repository, kept in Requireganizer as product overview, user stories, requirements, acceptance criteria, interface contracts and test cases, each traced to what it serves. Read it before implementing to build what was decided instead of guessing, and name the items your code covers. Submit stage work through its MCP tools for the person to approve. Use when the repository has a requireganizer.json, the requireganizer MCP tools are available, or the user mentions Requireganizer.
---

# Requireganizer

Requireganizer keeps a project's specification as a chain of stages. Each
stage builds on the approved stages before it:

1. Product Overview
2. User Stories
3. Requirements
4. Acceptance Criteria
5. Boundary Design
6. Interface Contracts, which include the Implementation Profile
7. Test Scenarios
8. Test Cases
9. Project Setup
10. Automated Tests

The person approves every item in Requireganizer's page; no tool approves.

## Read before you act

- Call `get_workflow_state` first, and again after anything changes. It gives
  the frontier and each stage's status:
  - The frontier is the first stage that is not complete. Only the frontier
    and the stages before it can change.
  - Each stage lists its outdated items, its items awaiting approval, and its
    changed inputs.
  - In a project with modules, it names the module the person has open in
    Requireganizer. Every tool works on that module. To work on another, ask
    the person to open it.
- Read a stage's items with `get_items`: each item's code, status, text,
  links by code, open thread, and what its last signature covered where that
  differs. Read it again before changing or citing anything, rather than
  relying on an earlier read.
- `get_stage_artifacts` returns everything every stage up to the one you
  name holds, such as a boundary design. A unit's `signature` records its
  last approval, not whether it still holds.
- `get_input_changes` shows how a stage's inputs changed since that stage last
  took them in.

## When implementing code

- Build from approved items only. Say so before relying on an item awaiting
  approval or an outdated one.
- When you tell the person which requirement or test your code covers, name
  the item as Requireganizer shows it.

## When writing a stage

- Submit with the stage's `submit_*` tool. Each submission is the complete
  proposal for that stage, not a patch. In it, an entry that names an
  existing item gives only the fields that change; the rest stay as they
  are. The tool description states the stage's quality contract.
- A rejected submission comes back with the reason, such as an unknown id,
  missing coverage or an empty field. Fix exactly that and submit again. Never
  weaken the proposal to get past a check.
- An applied submission comes back with what the reviewer model rejected and
  why. Fix it and submit the stage again, or tell the person why you disagree:
  they can overrule the reviewer.
- A stage's submit tool appears only once the stages before it are approved.
  If the tool you need is missing, the person has approvals to make first.
  Tell them which stage is waiting.
- Regenerate outdated items before anything else in their stage. Keep an item
  word for word when the change that outdated it does not affect it.
- A submission to an earlier stage applies at once and reopens that stage.
- When you lack the information a stage needs, ask the person. Do not invent
  scope.

## Change requests from the person

- `get_workflow_state` lists each stage's open threads, the person's change
  requests on its items, and `changeRequestsAnsweredBy`. `get_thread` reads
  one thread with its item.
- When it is `coding-agent`, answer the threads waiting for you. To change an
  item, submit its stage and name the thread in the submission's `answers`,
  with a reply saying what changed. To ask or to disagree, use
  `reply_to_thread`. Only the person resolves a thread.
- When it is `requireganizer`, Requireganizer's AI answers them; leave them.

## Where the person works

The server instructions give the page's address. Point the person there to
review and approve. While Requireganizer runs its own AI for the person, your
submissions wait.
