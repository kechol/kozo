---
title: Architecture
description: How kozod, the workers, the CLI and the dashboard divide the work, how state is recorded, and how a task runs.
---

kozo is a few processes on one machine around one resident process, kozod. This page describes how
they divide the work; it is not needed to use kozo, but it explains why kozo behaves as it does.

## Processes

```text
 kozo (CLI) ──┐
              ├── local API (127.0.0.1:7420) ── kozod ──┬── worker ── claude session
 dashboard ───┘                                         ├── worker ── claude session
                                                        ├── commands in the command sandbox
                                                        └── gh, git (GitHub mode)
```

| Process   | Role                                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kozod     | Makes every decision code can make: admits items, checks plans against the Charter, claims tasks, runs blueprints, applies limits, backpressure and the budget, and follows merges. It is the only process that writes state. |
| Worker    | A child process of kozod that runs one agent session in one worktree, with the guard in front of every tool call. It writes and commits only inside its worktree.                                                             |
| `kozo`    | A stateless client of the local API, plus the setup and verification commands.                                                                                                                                                |
| Dashboard | A stateless page that kozod serves, and another client of the same API.                                                                                                                                                       |

Models classify, draft plans, implement, review, judge DONE_WHEN by driving the app and answer
your questions from the records; kozod decides everything else deterministically. So the same request under the same Charter is routed, limited and checked the
same way every time.

## Planes

| Plane        | What it holds                                                                                         | Where                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Control      | Routing stages, checking plans and the Charter, claiming tasks, backpressure and budgets.             | kozod                                               |
| Execution    | Agent sessions in worktrees.                                                                          | Workers                                             |
| Verification | The deterministic checks (gates, diff-guard, prove) and the separate-session judges (review, verify). | kozod, in the command sandbox and in judge sessions |
| Record       | Per-run event logs, instruction queues and the SQLite index built from them.                          | `~/.kozo`                                           |

## State is an event log

Everything kozo knows is in append-only event logs: one for the factory and one per run. Each line
is versioned, chained to the one before it, and the log is sealed when its run ends. kozod
rebuilds its state and the `kozo.db` index from the logs at every start, and refuses to start if a
sealed log was changed.

This is why a crash loses nothing that was recorded, why `kozo admin db-rebuild` can always rebuild
the index, and why you never edit the logs by hand.

Every write through the local API is one API call with its own ID, which every event it causes
carries.

## How a task runs

A blueprint is the fixed sequence of nodes that takes one task from Building to Handoff. Some
nodes are deterministic and kozod runs them itself; agent nodes run a model in a worker.

| Node                 | Kind          | What happens                                                                                                         |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| claim                | Deterministic | Creates the task branch and the worktree from the latest default branch. Creating the branch claims the task.        |
| prepare              | Deterministic | Starts the services, picks the ports, and runs prepare once per worktree.                                            |
| brief                | Deterministic | Writes the brief: fixed-format instructions built from the plan, with the request as untrusted data.                 |
| implement            | Agent         | The implement agent changes the code and commits, within the task's scope. A codemod runs first if the plan has one. |
| verify-deterministic | Deterministic | The gates of the risk tier's level, prove, and diff-guard.                                                           |
| review               | Agent         | A judge in a separate session reads only the diff, the goal and the completion conditions.                           |
| verify-app           | Agent         | The verify agent runs the app by `.kozo/verify-app.md` and keeps evidence, unless the risk tier is low.              |
| handoff              | Deterministic | Writes the handoff report.                                                                                           |
| final-verify         | Deterministic | Rebases on the latest default branch and runs the deep gates; only then is the task ready for your merge.            |

kozod records a checkpoint when a task enters each node, so a stopped or lost run continues from
there. A failing check sends the task back with what failed, within the Charter's limits; past
them, the task waits for you.

## Agents

| Agent     | Session                              | Job                                                                                                                                                                  |
| --------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| triage    | Reads the repository, writes nothing | Drafts the plan: work class, risk tier, approach, completion conditions and tasks.                                                                                   |
| plan      | Reads the repository, writes nothing | Redrafts a plan after a rejection or an answer, settles a feature's acceptance criteria with you, and splits work again when a task cannot be done within its scope. |
| implement | Works in the worktree                | Implements one task.                                                                                                                                                 |
| review    | Judge without tools                  | Judges the diff: accept, revise or escalate.                                                                                                                         |
| verify    | Shell only                           | Drives the app and checks each completion condition.                                                                                                                 |
| explorer  | Judge without tools                  | Answers `kozo say --ask` from the records.                                                                                                                           |

Each runs your own `claude`, through the Agent SDK or as `claude -p`, with instructions from the
factory definition.
