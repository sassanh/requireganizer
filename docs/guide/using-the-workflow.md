# Using the workflow

Requireganizer is a review loop, not a one-click code generator. Each stage narrows uncertainty and creates inputs for the next stage.

## Review rhythm

For every stage:

1. Generate a complete proposal.
2. Review scope, wording, references, priority, and dependencies.
3. Edit artifacts directly or ask for a focused revision.
4. Resolve any **Outdated** downstream stages before relying on them.
5. Continue only when the current artifact set expresses the intended product behavior.

## What statuses mean

| Status | Meaning | Action |
| --- | --- | --- |
| Pending | No usable artifact set exists yet. | Complete the prerequisites and generate it. |
| Completed | Artifacts exist and their recorded inputs still match. | Review, then continue. |
| Outdated | Artifacts exist, but an upstream input changed after generation. | Review the upstream edit and regenerate this stage. |

An outdated result is preserved so a reviewer can compare it; it is not silently discarded or regenerated.

## Focused revisions

Comments revise exactly one artifact. The server validates both the artifact type and ID and accepts only fields editable for that type. A focused revision cannot add, remove, reorder, or modify neighboring artifacts.

Use full-stage generation when the desired target list itself should change. Full-stage results reconcile the complete target list atomically and must retain upstream coverage. Existing IDs are retained only for the same artifact intent; omitted items are removed; new items receive application-generated IDs. Retained scenarios keep their nested test cases.

## Project configuration and scaffold

Project configuration is derived from the reviewed specification, including test cases. It selects the package manager, test framework, build command, test command, and framework-specific settings.

Lock the configuration after review. Scaffold generation then produces only the minimal files required to install, build, and run tests. Test cases and feature implementation are deliberately excluded from the scaffold operation.

Changing the specification after configuration makes the configuration and generated code stale. Regenerate and re-lock it before continuing.

## Executable tests

Each scenario has a stable language-specific test path containing the scenario code and an ID prefix. Each test case owns a bounded block between generated annotations. Revisions must retain the scenario header and every unrelated test block already present in the file.

## Generation failures in development

The inline alert is intentionally concise. When a provider returned a tool call that failed validation, development builds show **More details**. The dialog contains the concrete validator error and the rejected raw provider response for each attempt. Production builds do not receive or display that diagnostic payload.

A provider timeout is different: no model response exists to inspect. The alert states that the provider timed out, and development details contain the transport stack rather than a fabricated response.

## Provider activity

The information button beside the project name opens a session report for AI provider calls. It shows each operation and attempt, its outcome and duration, the selected model and tool, provider identifiers, and reported input, cached-input, cache-write, output, and total token counts. The summary calculates a cache-hit rate when the provider reports both input and cached-input tokens.

Provider activity is limited to the current in-memory project session. Project autosave and export exclude it, and the report does not retain prompts or successful model responses.
