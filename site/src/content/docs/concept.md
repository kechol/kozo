---
title: Concept
description: How a request moves through kozo, what waits for you, and how autonomy levels decide which approvals you give.
---

kozo is a software factory for one person. You hand it requests; it cuts each into tasks that
produce one small diff apiece, implements and checks every task on its own, and hands the diffs
back for you to read and merge. Your part is the policy, the inbox and the merge.

## The parts

| Part               | What it is                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| kozod              | The resident process. It makes every decision that code can make, writes all state and serves the local API on `127.0.0.1:7420`. |
| `kozo`             | The command line. It holds no state and only calls the local API.                                                                |
| Dashboard          | The local web page with the inbox, the board and the detail view. Like `kozo`, it only calls the local API.                      |
| Agents             | Claude Code sessions with one job each: triage, plan, implement, review, verify, and the explorer that answers questions.        |
| Factory definition | `~/.kozo/factory`, a git repository with `factory.yml`, the agents, the skills, the blueprints and the automations.              |
| Charter            | `.kozo/charter.yml` in each repository: what kozo may do there. Only humans change it.                                           |
| Constraints        | `.kozo/constraints.yml` in each repository: the gates and the commands that check a change.                                      |

Models only classify, draft plans, implement and review. Everything else, routing, limits,
budgets and checks, is code in kozod.

## Items and tasks

An **item** is one request: what you add with `kozo add`, a GitHub Issue in GitHub mode, or what
an automation adds on a schedule. Its reference is `K-<n>`, or `<repository>#<n>` for an Issue.

A **task** is a piece of an item that produces exactly one diff. Its reference is `<item>/t<n>`,
such as `K-3/t1`. Each task works in a git worktree of its own, made from the latest default
branch, on a task branch named `kozo/<factory ID>/<item>-t<n>`.

A **run** is one agent session for an item or a task, referenced as `r-<nnnn>`.

## Stages

Items and tasks move through the same stages:

| Stage     | What happens                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Intake    | kozod checks that the repository's Charter is ready, and holds the item for a start approval when its level asks for one.                                                                              |
| Triage    | The triage agent reads the repository without changing it and drafts a plan: the work class, the risk tier, the approach, the completion conditions (DONE_WHEN) and the tasks. kozod checks the draft. |
| Planning  | The plan waits for your approval. The plan agent redrafts it after a rejection or an answer, and for a feature it first works out the acceptance criteria with you.                                    |
| Building  | Each task is implemented in its worktree, then run through the gates, prove and diff-guard.                                                                                                            |
| Reviewing | A review agent in a separate session judges the diff against the task's goal and DONE_WHEN only, and the verify agent drives the app and saves evidence.                                               |
| Handoff   | The task is rebased on the latest default branch and checked again; kozod writes the handoff report, and the diff waits for your merge.                                                                |
| Complete  | After your merge, kozod runs the gates on the merged default branch. An item is complete once all its tasks are.                                                                                       |
| Cancelled | You cancelled the item or task.                                                                                                                                                                        |

You can close any open item or task yourself with `kozo close <ref> --done` or
`--cancel <reason>`.

## Holds

A **hold** says why an item or a task is not moving. Each has at most one at a time, kept apart
from its stage.

| Hold       | Why it waits                                                                      | What clears it                                                        |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| approval   | A start or a plan needs you.                                                      | `kozo approve <item>`; for a plan, also `kozo reject <item> <reason>` |
| question   | An agent asked something, review escalated, or the change needs a protected path. | `kozo say <ref> <answer>`                                             |
| attention  | A task stopped at a limit, lost its run, or its branch went away without a merge. | `kozo retry <ref>`, or `kozo close`                                   |
| paused     | You paused it with `kozo pause <ref>`.                                            | `kozo resume <ref>`                                                   |
| taken      | You took the task over with `kozo take <task>`.                                   | `kozo return <task> <text>`, once your work is committed              |
| dependency | It waits for another item or task to complete.                                    | kozod, when that one completes                                        |
| capacity   | Backpressure, the daily budget or concurrency keeps it from starting.             | kozod, when room frees up                                             |

## The inbox

The **inbox** is everything that waits for you, oldest first: approvals, questions, attention,
and tasks awaiting your merge. `kozo ls` and the dashboard both show it. Clearing it is the daily
work of running kozo.

## Autonomy levels

The Charter gives each work class an autonomy level, L1, L2 or L3, which decides the approvals an
item needs. `levels.default` applies to every class without a level of its own.

| Level | Start approval | Plan approval                                                      |
| ----- | -------------- | ------------------------------------------------------------------ |
| L1    | Yes            | Yes                                                                |
| L2    | No             | Yes                                                                |
| L3    | No             | Only for a plan with several tasks, a high risk tier, or a codemod |

Some items always need both approvals, whatever the level:

- Items an automation adds.
- In GitHub mode, Issues from someone without write access to the repository, or opened before
  the repository was registered.

When triage drafts a class with a lower level than the one you asked for, the lower one applies.

kozo adjusts levels on its own in one direction only. A defect found after a merge, or your work
on more than 30 percent of the last ten merged diffs, lowers that class's level in that
repository by one step until you change the Charter. Raising a level is always yours: when an L2
class's last 20 merged diffs needed no help and had no defects, `kozo report --review` proposes
L3, and you decide whether to write it into the Charter.

## Work classes

The plan's work class picks the blueprint that a task follows from Building to Handoff.

| Class     | What the blueprint asks for                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| bugfix    | A test that fails without the fix comes first.                                                                                                  |
| feature   | A test of the new behaviour that fails without the change comes first.                                                                          |
| refactor  | Behaviour stays as it is: existing tests keep passing, and added tests pass without the change too.                                             |
| perf      | Behaviour stays as it is, checked with the full gates.                                                                                          |
| deps      | Nothing to reproduce; checked with the deep gates.                                                                                              |
| docs      | Nothing to reproduce.                                                                                                                           |
| migration | One chain of tasks, starting with one that only adds tests; a task's codemod runs before it is implemented, and every step runs the deep gates. |

## How a change is checked

Every diff passes the same layers, from the cheapest to the costliest:

| Layer         | Check                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| V1 gates      | The repository's own commands from the constraints, such as lint and tests, at a level of fast, full or deep.        |
| V2 diff-guard | The diff's size, its scope, protected paths, edits to existing tests and disabled tests.                             |
| V3 prove      | Reverting everything but the tests: the changed tests must then fail, or, for work that keeps behaviour, still pass. |
| V4 review     | A separate session that sees only the diff and the original instructions.                                            |
| V5 verify     | An agent that runs the app as `.kozo/verify-app.md` describes and saves evidence.                                    |

The plan's risk tier sets the depth: a low-risk task runs the fast gates and stops at review, a
normal one adds the full gates, prove and verify, and a high-risk one runs the deep gates. kozod
may raise a plan's risk tier, for example when a task's scope reaches a protected path, but never
lowers it.

## Humans always merge

Nothing in kozo can merge. In local mode you merge the task branch; in GitHub mode kozod pushes
the branch and opens a pull request, and you merge that. Agents hold no GitHub credentials and
write only inside their worktree, and only kozod pushes, after every check has passed.
