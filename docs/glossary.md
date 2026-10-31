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
| API call | One write to the local API, identified by a UUIDv7 that every event it makes carries. | `api_call` | request | - |
| CLI | The stateless `kozo` command through which humans and scripts call the local API. | `kozo`, `packages/cli` | - | - |
| control plane | The plane, run by kozod, that routes stages, checks plans and the Charter, claims tasks, and applies backpressure and budgets. | `packages/daemon` | - | - |
| dashboard | The local web UI with the inbox, the board and the detail view, which holds no state and calls only the local API. | `packages/dashboard` | console, web app | - |
| execution plane | The plane of workers that execute agent nodes inside worktrees. | `packages/worker` | - | - |
| factory ID | The six random lowercase letters and digits that kozod draws at its first start and puts in its branch names, so that two factories or a recreated home never share a branch. | `factory_id`, `factory.created` | - | - |
| kozo | The whole personal software factory made of kozod, the CLI, the dashboard, the workers and the verification commands. | - | - | - |
| kozod | The resident process that performs every state write and serves the local API. | `kozod`, `packages/daemon` | backend, server | - |
| local API | The REST and SSE interface that kozod serves on `127.0.0.1:7420` for the CLI and the dashboard. | `/api/*` | - | - |
| record plane | The plane of per-run event logs and instruction queues and of the SQLite index built from them. | `kozo.db` | - | - |
| verification plane | The plane of deterministic checks and separate-session judges that kozod starts for a task. | `packages/verify` | - | - |
| worker | The child process that executes one run and writes and commits only inside its worktree. | `packages/worker` | executor, runner | - |

## Work model

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| acceptance criteria | A feature item's done_when, which the plan agent settles with the owner in Planning before the plan approval, with no other specification. | `done_when` | spec, requirements | - |
| approval | The hold on an item that waits for a human to accept its start (start approval) or its plan (plan approval). | `approval`, `kozo approve` | sign-off | - |
| attention | The hold on a task that stopped at a limit, lost its run, or had its diff closed without a merge, kept until a human retries or closes it. | `attention` | - | - |
| capacity | The hold that kozod sets and clears by itself while backpressure, the budget or concurrency keeps a task from starting. | `capacity` | - | - |
| dependency | The hold that waits until another item, or another task of the same item, reaches Complete. | `dependency`, `depends_on` | - | - |
| diff | The one change set that a task delivers, as a task branch in local mode or as a pull request in GitHub mode. | - | changeset, patch | - |
| DONE_WHEN | The checkable completion condition of an item or a task, checked again at Complete. | `done_when`, `DONE_WHEN` | definition of done | - |
| external event | A change made outside kozo, such as a merge, a closed pull request or an edited request, that kozod reconciles every minute. | - | - | - |
| generated file | A file the constraints' generated globs name, such as a lockfile, whose changed lines and count diff-guard keeps apart from the Charter's limits while every other check sees it. | `generated` | - | - |
| hold | The reason, kept apart from the stage, why an item or a task is not moving, with at most one per item or task. | `hold`, `kozo:needs-*` | block, wait | - |
| item | A request from a human or an automation that kozo splits into one or more tasks. | `K-<n>`, `<repo>#<n>` | job, ticket | - |
| item order | The order in which kozod starts the work of items and lists them: the order they arrived in, until a human moves one. | `order`, `kozo reorder`, `item.reordered` | priority, rank | - |
| note | What a human said about an item or a task outside a running run, or what kozod's failed check at Complete found, kept as an event and given to every later run of that item or task. | `note.added` | comment, memo | - |
| paused | The hold set when a human stops an item, a task or a run. | `paused` | - | - |
| plan | The single document that states an item's work class, risk tier, approach, DONE_WHEN and task split. | `kozo-plan:v1`, `plan.yml` | spec, work order | - |
| question | The hold that waits for a human answer after `kozo_blocked`, an escalate verdict or a needed protected-path change. | `question`, `kozo say` | - | - |
| reference | The text that names an item, a task or a run in commands, events and the local API: `K-<n>` or `<repo>#<n>` for an item, `<item>/t<n>` for a task and `r-<nnnn>` for a run. | `Reference` | handle | - |
| scope | The path globs of a task outside which its diff may not change files. | `scope`, `--scope` | - | - |
| split again | Cancelling a task that cannot be done within its scope, with the open tasks that depend on it, and sending its item from Building back to Planning, where the plan agent splits the remaining work. | `splitAgain` | re-plan, resplit | - |
| stage | The position of an item or a task in the flow: Intake, Triage, Planning, Building, Reviewing, Handoff, Complete or Cancelled. | `stage`, `kozo:<stage>` | phase, status, step | - |
| taken | The hold on a task that a human took over, which only `kozo return` clears. | `taken` | - | - |
| task | The unit that kozo cuts from an item so that it produces exactly one diff. | `<item>/t<n>` | subtask, ticket | - |
| trusted requester | A requester whose items' start and plan approvals follow the autonomy level: the owner in local mode, or in GitHub mode a user with write access who opened the Issue after the repository was registered, and never an automation. | `approvals: level` | - | - |

## Execution

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| agent | A role with its own definition that does one kind of judgment work: triage, plan, implement, review, verify or explorer. | `agents/<name>/agent.md` | bot, persona | - |
| agent node | A blueprint node that a model executes. | `A` | - | - |
| blueprint | The per-work-class state machine of deterministic and agent nodes that moves a task from Building to Handoff. | `blueprints/<class>.yml` | pipeline, playbook, workflow | - |
| brief | The fixed-format instructions, with every field filled, that kozod builds from the plan for one run. | `brief.md` | prompt, work order | - |
| characterization task | A plan task that only adds tests pinning behaviour its item keeps, which prove checks pass without the item's change. | `characterize: true` | - | - |
| checkpoint | A recorded point at a node entry from which a new run can resume. | `checkpoint` | snapshot | - |
| child run | A run in a separate session, such as review, that is grouped under its parent run. | `parent_run` | sub-run | - |
| CLI bridge | The Unix socket of a worker through which the hooks and the MCP server of a `claude -p` session, kozod's own executable started by Claude Code, pass each call to the worker. | `listenBridge`, `kozod --hook`, `kozod --mcp` | - | - |
| codemod | One shell command in a plan task that rewrites code mechanically, which kozod runs in the worktree before the task's first implement session and commits as kozo. | `codemod` | script, transform | - |
| command sandbox | The sandbox of kozo's own in which the diff's commands of prepare, the gates and prove run, as opposed to Claude Code's sandbox around an agent's shell. | `CommandSandbox`, `seatbeltProfile` | jail | - |
| decision log | The per-run file in which the agent records, one line each, what it chose and why. | `decisions.md` in the run directory, `kozo_note` | - | - |
| deterministic node | A blueprint node that kozod executes without a model. | `D` | - | - |
| guard | The check in the worker that decides every tool call of a session before it runs and refuses the ones that leave the worktree, the scope or the allowed commands. | `guardToolCall`, `guard.denied` | filter, hook | - |
| instruction queue | The per-run file of human instructions that reach the agent at turn boundaries. | `queue.jsonl` | mailbox, message queue | - |
| run | One agent attempt in a new session, identified as `r-<nnnn>`. | `run_id` | attempt, job, session | - |
| run report | The JSON that the worker writes at the end of a run in the schema that the brief specifies. | `report.json` | - | - |
| run state | The lifecycle state of a run: running, succeeded, failed, stopped or lost. | `run.*` | - | - |
| runtime | How workers run Claude Code: `sdk` through the Agent SDK in the worker, or `cli` as a `claude -p` process with the CLI bridge. | `runtime` in `factory.yml` | - | - |
| task branch | The branch that holds one task's diff under the factory ID, whose creation claims the task. | `kozo/<factory ID>/<item>-t<n>` | - | - |
| thread | The runs and instructions that belong to one task, with at most one running run at a time. | task reference | conversation | - |
| worktree | The git worktree that kozod creates for one task from the latest default branch. | `~/.kozo/worktrees/<repository>-<path hash>-<item>-t<n>` | checkout, workspace | - |

## Verification

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| bad-change suite | The set of deliberately bad changes that the verification layers must all reject. | - | - | - |
| diff-guard | The V2 check that inspects a diff for size, scope, protected paths, edits to existing tests and disabled tests. | `kozo diff-guard` | - | - |
| egress proxy | kozod's proxy on 127.0.0.1 that is prepare's only way to other hosts, tunnelling only to the package registries and `prepare_hosts`. | `EgressProxy`, `prepare_hosts` | firewall | - |
| evidence | The verification verdicts and the artifacts, such as screenshots and logs, that a run keeps as proof. | `verdict.json`, `evidence/` | proof | - |
| finding | One problem that review reports against one of its four criteria: instructions, scope, tests or conventions. | `findings` | issue, comment | - |
| gate | One command defined in the constraints, such as typecheck, lint, unit tests or build. | - | check | - |
| gate level | The named set of gates to run: fast, full or deep. | `level` | - | - |
| gates | The V1 command that runs the gates of one level and ends with a single `KOZO_GATES:` line. | `kozo gates`, `KOZO_GATES` | - | - |
| judge | A separate model session without tools that reads only what it is given and returns a structured judgment, as review does. | `Judge` | - | - |
| prepare | The constraints commands that run once in a worktree before its first gate, such as installing dependencies. | `prepare` | setup | - |
| prove | The V3 check that reverts non-test changes and requires the changed tests to fail, or for a blueprint that does not reproduce, to keep passing. | `kozo prove`, `--preserve` | - | - |
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
| demotion | kozod's lowering of a class's autonomy level in one repository by one step on a post-merge defect or over 30 percent intervention in the last ten merged diffs, which lasts until the Charter changes. | `factory.demoted` | downgrade | - |
| factory definition | The git repository of agents, skills, blueprints, automations, eval cases and `factory.yml` that kozod applies only after `kozo check` passes. | `~/.kozo/factory/`, `factory.yml` | factory config | - |
| intervention | A human's work on a task: taking it with `kozo take`, committing to its branch at Handoff or sending it back from there. | `humanCommits`, `sentBack` | - | - |
| limits | The Charter caps per task and per run, such as changed lines, files, retries, turns, minutes and cost. | `limits` | - | - |
| mode | The way kozo connects to the outside: `local` with local branches, or `github` with Issues and pull requests. | `mode` | - | - |
| promotion proposal | kozod's suggestion to raise a class from L2 to L3 once its last 20 merged diffs were all autonomous and free of defects, which only a human applies in the Charter. | `promotionProposals` | upgrade | - |
| protected path | A Charter path pattern that is never changed unattended, so that touching it raises a question; it also covers everything under what it matches, read both as a glob and as a literal path. | `protected_paths` | - | - |
| risk tier | The plan setting, low, normal or high, that decides verification depth and that kozod may only raise. | `risk` | risk class, risk level | - |
| service | A command in the constraints that starts what the gates need and the command sandbox cannot run, such as a database container, which kozod runs outside the sandbox before prepare. | `services` in `.kozo/constraints.yml` | - | - |
| teardown | A command in the constraints that stops what the services started, which an eval runs after each case outside the command sandbox, back at the case's start. | `teardown` | cleanup | - |
| work class | The plan setting that selects the blueprint: docs, deps, bugfix, refactor, perf, migration or feature. | `class` | category, task type | - |

## Human interface

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| board | The dashboard screen that shows items or tasks as cards in stage columns. | - | kanban | - |
| handoff report | The report that kozod writes at Handoff with five sections: why, what changed, out of scope, why it is safe, and verification. | pull request body | - | - |
| inbox | The oldest-first list of what waits for a human: approval, question and attention holds, and tasks awaiting merge. | `kozo ls inbox` | queue, todo list | - |
| issue move | Moving a local item without tasks to an Issue of its repository in GitHub mode, which cancels the local item and leaves the Issue to intake. | `kozo issue` | - | - |
| status comment | The single Issue comment that kozod keeps rewriting with the stage, holds, tasks, pull requests and cost. | - | - | - |
| take | Handing a task to the human, who commits in its worktree until giving it back with `kozo return` to the checks after implement. | `kozo take`, `kozo return`, `task.returned` | hijack, takeover | - |
| toast | The dashboard's corner message that answers a verb, which leaves after a few seconds unless it says that a verb without a field of its own failed. | `Toasts`, `notify` | popup, snackbar | - |
| tone | One of the seven colours, each with its glyph, that the dashboard gives a state: info, progress, warning, negative, positive, done or neutral. | `Tone`, `toneOf` | severity, status colour | - |

## Records and improvement

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| autonomous diff | A merged diff to which no human added commits. | - | - | - |
| autonomy rate | The share of merged diffs that are autonomous diffs. | - | - | - |
| cost per diff | The median cost of the diffs merged in a window: each diff's runs, children included, and an equal share of its item's triage and planning. | `cost_per_diff_usd` | - | - |
| eval case | A case built from a past request with a repository, a start commit, the request body and the expected outcome, which may be a stop. | `evals/<case>.yml` | benchmark, fixture | - |
| event log | The append-only file of events, one per run and one for kozod's own, whose every line carries the hash of the line before, from which context, views and metrics are all derived. | `events.jsonl`, `prev` | audit log, history | - |
| failure type | A named pattern for a kind of failure that occurred twice, which then gets a structural fix. | - | - | - |
| log seal | The event in kozod's own log that fixes the line count and the last line's hash of a run's log when the run ends, after which nothing is appended to that log. | `log.sealed` | - | - |
| monthly review | The monthly reading of metrics, failure types, autonomy levels and cost. | `kozo report --review` | - | - |
| post-merge defect | A merged diff that failed its DONE_WHEN check at Complete or was later tied to a revert or a fix commit. | - | regression | - |
| prune | Removing, at a human's request, all but the event log, report, verdicts and decision log of each run whose item closed at least a given number of days ago. | `kozo admin prune`, `factory.pruned` | purge, clean up | - |
| retrospective | The weekly human reading of unresolved failures that turns each failure type into a structural fix. | `kozo report --days 7` | - | - |
| revise rate | The share of reviews that returned revise. | - | - | - |
| time to merge | The median time from a diff's last handoff to its merge. | `hours_to_merge` | - | - |

## Development process

| Term | Definition | Code | Avoid | Former name |
|---|---|---|---|---|
| backlog task | A `T-NNN` line in `docs/backlog/` sized for one session and one pull request. | `T-NNN`, `Task:` | ticket | - |
| changeset | A `.changeset/*.md` file that declares the version bump and the changelog text for one user-visible change. | `.changeset/` | - | - |
| Decision | A `D-NNN` line in `docs/decisions.md` that records one choice whose reasons live in commit messages. | `D-NNN`, `Decision:` | ADR | - |
| Epic | The group of backlog tasks for one phase, kept as one file in `docs/backlog/`. | - | milestone, theme | - |
| exit check | The last backlog task of an Epic, which verifies the completion criteria of its phase. | - | - | - |
| phase | One of the build steps P0 to P5 into which the development of kozo is divided, each with its own completion criteria. | `P0`–`P5` | milestone, sprint, stage | - |
