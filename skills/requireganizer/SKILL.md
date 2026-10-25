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
- Read the work with `get_stage_artifacts`. It returns every stage up to and
  including the one you name. Read it again before changing or citing
  anything, rather than relying on an earlier read.
- `get_input_changes` shows how a stage's inputs changed since that stage last
  took them in.

## When implementing code

- Build from approved items only. Say so before relying on an item awaiting
  approval or an outdated one.
- When you tell the person which requirement or test your code covers, name
  the item as Requireganizer shows it.

## When writing a stage

- Submit with the stage's `submit_*` tool. Each submission is the complete
  proposal for that stage, not a patch. The tool description states the
  stage's quality contract.
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
- A submission that would send the workflow back to an earlier stage waits
  until the person confirms it in Requireganizer.
- When you lack the information a stage needs, ask the person. Do not invent
  scope.

## Where the person works

The server instructions give the page's address. Point the person there to
review and approve. While Requireganizer runs its own AI for the person, your
submissions wait.
