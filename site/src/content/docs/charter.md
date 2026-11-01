---
title: Charter
description: Every key of .kozo/charter.yml, what kozo may do in a repository, and what happens when each limit is reached.
---

The Charter, `.kozo/charter.yml`, sets what kozo may do in one repository. Only humans change it:
kozo reads it from the tip of the default branch, `origin`'s in GitHub mode, never from a diff, and
it is a protected path in the template.

No key has a default. A Charter with a key missing or misspelled does not parse, and kozo then
does no work in that repository.

```yaml
version: 1
status: ready
isolation: worktree
protected_paths:
  - '.kozo/**'
  - '.github/**'
  - '.claude/**'
  - 'AGENTS.md'
  - 'CLAUDE.md'
existing_tests_protected: true
levels:
  default: L1
  docs: L2
limits:
  max_changed_lines: 400
  max_files: 8
  max_tasks_per_item: 8
  inner_retries: 2
  ci_fix_rounds: 2
  no_progress_rounds: 3
  max_turns: 40
  max_minutes: 45
  max_cost_usd: 5
backpressure:
  max_awaiting_merge: 3
  max_held: 10
```

The values above are the template's.

## `version` and `status`

| Key       | Meaning                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version` | Always `1`.                                                                                                                                            |
| `status`  | `ready` or `incomplete`. Until it is `ready`, kozo refuses new items, skips automations, and starts no task in the repository, and `kozo check` warns. |

## `isolation`

Always `worktree`: each task works in its own git worktree. It is the only isolation kozo has,
and any other value is an error.

## `protected_paths`

Paths kozo never changes unattended. Each pattern counts both as a glob and as a literal path,
and covers everything under what it matches, so `src/config`, `src/config/` and `app/[id]` all
protect their contents.

- Agents cannot write a protected path; asking about it is their only way forward.
- A diff that touches one stops with a question for you.
- A plan whose task scope reaches one is high risk, so it always needs your plan approval.

## `existing_tests_protected`

When `true`, the test files that exist on the default branch cannot be changed or deleted: agents
cannot write them, and diff-guard refuses a diff that does. New test files are always allowed.
Which files are tests comes from `tests` in the [constraints](../constraints/).

## `levels`

The autonomy level of each work class, `L1`, `L2` or `L3`. `default` is required and applies to
every class without a key of its own: `docs`, `deps`, `bugfix`, `refactor`, `perf`, `migration`
and `feature`. See [autonomy levels](../concept/#autonomy-levels) for the approvals each asks for.

kozo may lower a class's level after a defect or frequent human help; the lowered level lasts
until you change the Charter.

## `limits`

Counts are whole numbers of at least 1; `inner_retries` and `ci_fix_rounds` may be 0, which holds
the task on the first failure.

| Key                  | Limits                                                                                                                                                         | When it is reached                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `max_changed_lines`  | Changed lines in one task's diff, without generated files.                                                                                                     | A plan that estimates more is sent back to be redrafted, and after two refused drafts the item waits for your attention. A diff with more stops with a question for you. |
| `max_files`          | Changed files in one task's diff, without generated files.                                                                                                     | As `max_changed_lines`.                                                                                                                                                  |
| `max_tasks_per_item` | Tasks in one plan.                                                                                                                                             | The plan is sent back, and after two refused drafts the item waits for your attention.                                                                                   |
| `inner_retries`      | Times review or verify can send a task back to Building.                                                                                                       | The task waits for your attention. A review that escalates asks you a question at once.                                                                                  |
| `ci_fix_rounds`      | Times a task goes back to Building after its final verification fails, or in GitHub mode after its pull request's checks fail.                                 | The task waits for your attention; `kozo retry` gives the rounds back.                                                                                                   |
| `no_progress_rounds` | Attempts in one build loop, each a new session starting from the brief.                                                                                        | The task waits for your attention.                                                                                                                                       |
| `max_turns`          | Turns in one agent session.                                                                                                                                    | The task or item waits for your attention.                                                                                                                               |
| `max_minutes`        | Minutes of one agent session, and of each command: services, prepare, each gate, prove and codemods.                                                           | A session that runs out of time waits for your attention. A command is stopped and counts as failed, so a gate that times out is retried like any failing gate.          |
| `max_cost_usd`       | Dollars one agent session may spend, review, verify and the explorer included. kozod also reserves it against the daily budget for each piece of running work. | The task or item waits for your attention.                                                                                                                               |

## `backpressure`

Limits that stop new work in the repository until you catch up. While one is reached, nothing new
starts there: no triage, no redraft, and tasks wait with a capacity hold that kozod clears once
you are below the limit again.

| Key                  | Counts                                                     |
| -------------------- | ---------------------------------------------------------- |
| `max_awaiting_merge` | Tasks that passed every check and wait for your merge.     |
| `max_held`           | Items and tasks that wait on a question or your attention. |
