---
name: requireganizer
description: The person's signed spec for this repository, kept in Requireganizer as module overview, user stories, requirements and acceptance criteria, each traced to what it builds on. Read it before implementing to build what was decided instead of guessing, and name the items your code covers. Write stage items through its MCP tools for the person to sign. Use when the repository has a requireganizer.json, the requireganizer MCP tools are available, or the user mentions Requireganizer.
---

# Requireganizer

Requireganizer keeps a project's specification as stages. Each stage builds
on the stages before it and opens once they are complete:

1. Module Overview
2. User Stories, building on Module Overview
3. Requirements, building on User Stories
4. Acceptance Criteria, building on Requirements

The person signs every item, coverage and impact in Requireganizer's page; no
tool signs.

## Read before you act

- Call `get_workflow_state` first, and again after anything changes.
- Read a stage's rules with `get_stage_rules` before writing it, and follow
  them: the person signs against the same rules.
- To work on a module other than the one the person has open, ask the person
  to open it.
- Read items with `get_items` again before changing or citing them, rather
  than relying on an earlier read: codes are positions and move.

## When implementing code

- Build from approved items only. Say so before relying on an item that is
  not approved.
- When you tell the person which requirement or criterion your code covers,
  name the item as Requireganizer shows it.

## When writing a stage

- Write, change and remove items with `write_items`. Check what it reports it
  added, changed and proposed for removal against what you meant to do,
  before telling the person.
- Fix exactly what a refused write names and write again. Never weaken the
  items to get past a check.
- If the stage you need is closed, the person has signatures to give first.
  Tell them which stage is waiting.
- Change only the items a change affects. An out-of-date item that still
  holds stays as it is: the person signs it as it is.
- A write to an earlier stage applies at once and closes the stages that
  build on it until it is complete again.
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
