# Glossary

> **Rules** (read before editing)
> - Each category is a `## <category>` section that holds one table. One term per row
> - The columns are fixed: `| Term | Definition | Code | Avoid | Former name |`. Don't add or remove columns. Write `-` in an empty cell
>   - Code: the name in code (type, table, file, key and so on)
>   - Avoid: paraphrases that must not be used. Always fill it for terms whose wording tends to drift. Separate several with commas
>   - Former name: the name before a rename, kept so that old commits and code stay searchable
> - **Don't align columns with spaces.** Write cells tightly as `| a | b |` (alignment turns a one-row addition into a whole-table diff)
> - Don't write `|` inside a cell. Rephrase instead
> - A definition is one sentence. State the condition that tells the term apart from others
> - Put each term in one category only. When it spans several, put it in the central one
> - Don't rename categories. Sort rows alphabetically within a category, ignoring case, and insert new rows at their sorted position
> - Before naming a new concept, check here. Use the existing term if there is one; otherwise add it **before** using it
> - Don't create two terms for the same thing. When a similar term exists, revise its definition instead of adding a row
> - Definitions may change and terms may be renamed (unlike decisions.md, this file always shows the current state). However:
>   - Give the reason in the commit message. A rename that reaches a public API or the data model also needs a line in decisions.md and a `Decision:` trailer
>   - After a rename, keep the old name in Former name and replace it in code and ledgers in the same commit
> - Don't write background, history or usage examples. Put them in commit messages
>
> Example:
> ```
> ## Domain
>
> | Term | Definition | Code | Avoid | Former name |
> |---|---|---|---|---|
> | workspace | The organization that is the unit of billing and member management | `Workspace` | team, tenant | project |
> ```
>
> **Split signals** (if any applies, split into `docs/glossary/` with one file per category; the procedure is in AGENTS.md):
> more than 100 terms / more than 300 lines excluding the rules / a category with more than 40 terms

---

## Architecture

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| CLI | The stateless `kozo` command through which humans and scripts call the local API. | `kozo`, `packages/cli` | - | - |
| control plane | The plane, run by kozod, that routes stages, checks plans and the Charter, claims tasks, and applies backpressure and budgets. | `packages/daemon` | - | - |
| dashboard | The local web UI with the inbox, the board and the detail view, which holds no state and calls only the local API. | `packages/dashboard` | console, web app | - |
| execution plane | The plane of workers that execute agent nodes inside worktrees. | `packages/worker` | - | - |
| kozo | The whole personal software factory made of kozod, the CLI, the dashboard, the workers and the verification commands. | - | - | - |
| kozod | The resident process that performs every state write and serves the local API. | `kozod`, `packages/daemon` | backend, server | - |
| local API | The REST and SSE interface that kozod serves on `127.0.0.1:7420` for the CLI and the dashboard. | `/api/*` | - | - |
| record plane | The plane of per-run event logs and instruction queues and of the SQLite index built from them. | `kozo.db` | - | - |
| verification plane | The plane of deterministic checks and separate-session judges that kozod starts for a task. | `packages/verify` | - | - |
| worker | The child process that executes one run and writes and commits only inside its worktree. | `packages/worker` | executor, runner | - |

## Work model

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| approval | The hold on an item that waits for a human to accept its start (start approval) or its plan (plan approval). | `approval`, `kozo approve` | sign-off | - |
| attention | The hold on a task that stopped at a limit, lost its run, or had its diff closed without a merge, kept until a human retries or closes it. | `attention` | - | - |
| capacity | The hold that kozod sets and clears by itself while backpressure, the budget or concurrency keeps a task from starting. | `capacity` | - | - |
| dependency | The hold that waits until another item, or another task of the same item, reaches Complete. | `dependency`, `depends_on` | - | - |
| diff | The one change set that a task delivers, as a task branch in local mode or as a pull request in GitHub mode. | - | changeset, patch | - |
| DONE_WHEN | The checkable completion condition of an item or a task, checked again at Complete. | `done_when`, `DONE_WHEN` | definition of done | - |
| external event | A change made outside kozo, such as a merge, a closed pull request or an edited request, that kozod reconciles every minute. | - | - | - |
| hold | The reason, kept apart from the stage, why an item or a task is not moving, with at most one per item or task. | `hold`, `kozo:needs-*` | block, wait | - |
| item | A request from a human or an automation that kozo splits into one or more tasks. | `K-<n>`, `<repo>#<n>` | job, ticket | - |
| paused | The hold set when a human stops an item, a task or a run, or takes a task over. | `paused` | - | - |
| plan | The single document that states an item's work class, risk tier, approach, DONE_WHEN and task split. | `kozo-plan:v1`, `plan.yml` | spec, work order | - |
| question | The hold that waits for a human answer after `kozo_blocked`, an escalate verdict or a needed protected-path change. | `question`, `kozo say` | - | - |
| scope | The path globs of a task outside which its diff may not change files. | `scope`, `--scope` | - | - |
| stage | The position of an item or a task in the flow: Intake, Triage, Planning, Building, Reviewing, Handoff, Complete or Cancelled. | `stage`, `kozo:<stage>` | phase, status, step | - |
| task | The unit that kozo cuts from an item so that it produces exactly one diff. | `<item>/t<n>` | subtask, ticket | - |
| trusted requester | A requester whose items need no start approval: the owner in local mode, or in GitHub mode a user with write access who opened the Issue after the repository was registered. | - | - | - |

## Execution

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| agent | A role with its own definition that does one kind of judgment work: triage, plan, implement, review, verify or explorer. | `agents/<name>/agent.md` | bot, persona | - |
| agent node | A blueprint node that a model executes. | `A` | - | - |
| blueprint | The per-work-class state machine of deterministic and agent nodes that moves a task from Building to Handoff. | `blueprints/<class>.yml` | pipeline, playbook, workflow | - |
| brief | The fixed-format instructions, with every field filled, that kozod builds from the plan for one run. | `brief.md` | prompt, work order | - |
| checkpoint | A recorded point at a node entry from which a new run can resume. | `checkpoint` | snapshot | - |
| child run | A run in a separate session, such as review, that is grouped under its parent run. | `parent_run` | sub-run | - |
| decision log | The per-run file in which the agent records, one line each, what it chose and why. | `decisions.md` in the run directory, `kozo_note` | - | - |
| deterministic node | A blueprint node that kozod executes without a model. | `D` | - | - |
| instruction queue | The per-run file of human instructions that reach the agent at turn boundaries. | `queue.jsonl` | mailbox, message queue | - |
| run | One agent attempt in a new session, identified as `r-<nnnn>`. | `run_id` | attempt, job, session | - |
| run report | The JSON that the worker writes at the end of a run in the schema that the brief specifies. | `report.json` | - | - |
| run state | The lifecycle state of a run: queued, running, paused, succeeded, failed, stopped or lost. | `run.*` | - | - |
| task branch | The branch that holds one task's diff, whose creation claims the task. | `kozo/<item>-t<n>` | - | - |
| thread | The runs and instructions that belong to one task, with at most one running run at a time. | task reference | conversation | - |
| worktree | The git worktree that kozod creates for one task from the latest default branch. | `~/.kozo/worktrees/<task>` | checkout, workspace | - |

## Verification

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| bad-change suite | The set of deliberately bad changes that the verification layers must all reject. | - | - | - |
| diff-guard | The V2 check that inspects a diff for size, scope, protected paths, edits to existing tests and disabled tests. | `kozo diff-guard` | - | - |
| evidence | The verification verdicts and the artifacts, such as screenshots and logs, that a run keeps as proof. | `verdict.json`, `evidence/` | proof | - |
| finding | One problem that review reports against one of its four criteria: instructions, scope, tests or conventions. | `findings` | issue, comment | - |
| gate | One command defined in the constraints, such as typecheck, lint, unit tests or build. | - | check | - |
| gate level | The named set of gates to run: fast, full or deep. | `level` | - | - |
| gates | The V1 command that runs the gates of one level and ends with a single `KOZO_GATES:` line. | `kozo gates`, `KOZO_GATES` | - | - |
| judge | A separate model session without tools that reads only what it is given and returns a structured judgment, as review does. | `Judge` | - | - |
| prepare | The constraints commands that run once in a worktree before its first gate, such as installing dependencies. | `prepare` | setup | - |
| prove | The V3 check that reverts non-test changes and requires the new tests to fail. | `kozo prove` | - | - |
| review | The V4 judge that sees only the diff and the original instructions in a separate session. | `review` | - | - |
| review verdict | The recommendation that review returns: accept, revise or escalate. | `review.verdict` | - | - |
| test file | A file that a `tests` glob in the constraints matches, which diff-guard and prove treat as a test. | `tests` | spec file | - |
| verification layer | One of the five layers V1 to V5, ordered from the cheapest deterministic check to the costliest judgment. | `V1`–`V5` | - | - |
| verify | The V5 judge that runs the app through verify-app, exercises DONE_WHEN and saves evidence. | `verify` | - | - |
| verify-app | The per-repository procedure that starts the app, checks its state, operates it, collects evidence and cleans up. | `.kozo/verify-app.md` | - | - |

## Autonomy and configuration

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| automation | A scheduled definition that creates items at set times and can never skip an approval. | `automations/<name>.md` | cron job | - |
| autonomy level | The per-work-class Charter setting, L1, L2 or L3, that decides which approvals an item needs from a human. | `levels`, `L1`–`L3` | trust level | - |
| backpressure | The rule that stops new starts when the tasks awaiting merge or the held items reach their Charter limit. | `backpressure` | throttling | - |
| Charter | The per-repository file, changed only by humans, that sets what the factory may do in that repository. | `.kozo/charter.yml` | config, policy | - |
| constraints | The per-repository file that defines each gate once for all gate levels. | `.kozo/constraints.yml` | - | - |
| daily budget | The machine-wide daily spending cap after which kozod starts nothing new. | `budget.daily_usd` | - | - |
| factory definition | The git repository of agents, skills, blueprints, automations, eval cases and `factory.yml` that kozod applies only after `kozo check` passes. | `~/.kozo/factory/`, `factory.yml` | factory config | - |
| limits | The Charter caps per task and per run, such as changed lines, files, retries, turns, minutes and cost. | `limits` | - | - |
| mode | The way kozo connects to the outside: `local` with local branches, or `github` with Issues and pull requests. | `mode` | - | - |
| protected path | A Charter path pattern that is never changed unattended, so that touching it raises a question; a pattern naming a directory covers everything under it. | `protected_paths` | - | - |
| risk tier | The plan setting, low, normal or high, that decides verification depth and that kozod may only raise. | `risk` | risk class, risk level | - |
| work class | The plan setting that selects the blueprint: docs, deps, bugfix, refactor, perf, migration or feature. | `class` | category, task type | - |

## Human interface

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| board | The dashboard screen that shows items or tasks as cards in stage columns. | - | kanban | - |
| handoff report | The report that kozod writes at Handoff with five sections: why, what changed, out of scope, why it is safe, and verification. | pull request body | - | - |
| inbox | The oldest-first list of what waits for a human: approval, question and attention holds, and tasks awaiting merge. | `kozo ls inbox` | queue, todo list | - |
| status comment | The single Issue comment that kozod keeps rewriting with the stage, holds, tasks, pull requests and cost. | - | - | - |

## Records and improvement

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| autonomous diff | A merged diff to which no human added commits. | - | - | - |
| autonomy rate | The share of merged diffs that are autonomous diffs. | - | - | - |
| eval case | A case built from a past request with a repository, a start commit, the request body and the expected outcome, which may be a stop. | `evals/<case>.yml` | benchmark, fixture | - |
| event log | The append-only per-run file from which context, views and metrics are all derived. | `events.jsonl` | audit log, history | - |
| failure type | A named pattern for a kind of failure that occurred twice, which then gets a structural fix. | - | - | - |
| monthly review | The monthly reading of metrics, failure types, autonomy levels and cost. | `kozo report --review` | - | - |
| post-merge defect | A merged diff that failed its DONE_WHEN check at Complete or was later tied to a revert or a fix commit. | - | regression | - |
| retrospective | The weekly human reading of unresolved failures that turns each failure type into a structural fix. | `kozo report --week` | - | - |
| revise rate | The share of reviews that returned revise. | - | - | - |

## Development process

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| backlog task | A `T-NNN` line in `docs/backlog/` sized for one session and one pull request. | `T-NNN`, `Task:` | ticket | - |
| changeset | A `.changeset/*.md` file that declares the version bump and the changelog text for one user-visible change. | `.changeset/` | - | - |
| Decision | A `D-NNN` line in `docs/decisions.md` that records one choice whose reasons live in commit messages. | `D-NNN`, `Decision:` | ADR | - |
| Epic | The group of backlog tasks for one phase, kept as one file in `docs/backlog/`. | - | milestone, theme | - |
| exit check | The last backlog task of an Epic, which verifies the completion criteria of its phase. | - | - | - |
| phase | One of the build steps P0 to P5 into which the development of kozo is divided, each with its own completion criteria. | `P0`–`P5` | milestone, sprint, stage | - |
