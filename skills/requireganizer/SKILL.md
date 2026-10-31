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

- Call `get_workflow_state` first, and again after anything changes.
- To work on a module other than the one the person has open, ask the person
  to open it.
- Read items with `get_items` again before changing or citing them, rather
  than relying on an earlier read: codes are positions and move.

## When implementing code

- Build from approved items only. Say so before relying on an item awaiting
  approval or an outdated one.
- When you tell the person which requirement or test your code covers, name
  the item as Requireganizer shows it.

## When writing a stage

- Check what an applied submission reports it added, changed and proposed for
  removal against what you meant to do, before telling the person.
- Fix exactly what a rejected submission names and submit again. Never weaken
  the proposal to get past a check.
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

- When `get_workflow_state` gives `changeRequestsAnsweredBy` as
  `coding-agent`, answer the threads waiting for you. To change an
  item, submit its stage and name the thread in the submission's `answers`,
  with a reply saying what changed. To ask or to disagree, use
  `reply_to_thread`. Only the person resolves a thread.
- Answer a thread in the thread only. Its reply is where you tell the person
  what changed or what waits; do not repeat, summarize or announce it in your
  conversation with them.
- When it is `requireganizer`, Requireganizer's AI answers them; leave them.

## Where the person works

The server instructions give the page's address. Point the person there to
review and approve. While Requireganizer runs its own AI for the person, your
submissions wait.
