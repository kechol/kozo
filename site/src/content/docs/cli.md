---
title: CLI
description: Every kozo command and flag, grouped by when you use it, with the references, the exit codes and examples.
---

`kozo` is the command line for kozo. It holds no state, and most commands call kozod's local API,
so kozod must be running (`kozo up`). `kozo check`, `kozo admin init`, `kozo admin install` in
local mode, `kozo admin eval run` and the verification commands work without it. Run `kozo` with
no arguments to print the same list as this page.

## References and exit codes

A command names its subject by its reference:

| Subject | Reference                                         | Example          |
| ------- | ------------------------------------------------- | ---------------- |
| Item    | `K-<n>`, or `<repository>#<n>` for a GitHub Issue | `K-3`, `shop#42` |
| Task    | `<item>/t<n>`                                     | `K-3/t1`         |
| Run     | `r-<nnnn>`                                        | `r-0042`         |

Every command exits with one of these codes, so scripts can tell the outcomes apart:

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| 0    | Success                                                    |
| 1    | Failure                                                    |
| 2    | Usage error                                                |
| 3    | The subject waits for a human, such as an item added at L1 |
| 4    | Not found                                                  |

Most commands take `--json` and then print one JSON document instead of text. Its `message` or
`error` is the sentence in the factory's `locale`, with `code` and `values` beside it for scripts.
`kozo --version` prints the version.

## Running kozod

### `kozo up` / `kozo down`

```sh
kozo up [--json]
kozo down [--json]
```

`up` starts kozod in the background and waits until it answers; it writes its log to
`~/.kozo/kozod.log`. `down` stops it. Runs in flight stop with it and continue from their last
checkpoint after the next `up`.

### `kozo status`

```sh
kozo status [--line] [--json]
```

kozod's state, the mode, the running runs, the inbox count and today's cost. `--line` prints a
single line for a status bar.

### `kozo dashboard`

```sh
kozo dashboard [--url] [--json]
```

Opens the [dashboard](../dashboard/) in the browser. `--url` prints the URL instead; it opens a
session once, within a minute.

## Adding and ordering work

### `kozo add`

```sh
kozo add <text> [--repo <path>] [--class <class>] [-f <file>] [--json]
```

Adds an item. The first line of `<text>` is its title; the remaining lines and the text of the
file given with `-f` form its body.

| Flag              | Meaning                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--repo <path>`   | The repository, as registered in `factory.yml`. Required when several are registered.                               |
| `--class <class>` | The work class: `docs`, `deps`, `bugfix`, `refactor`, `perf`, `migration` or `feature`. Without it, triage chooses. |
| `-f <file>`       | Adds the file's text to the body.                                                                                   |

```sh
kozo add "Update the date library" --class deps
kozo add "Fix the login redirect" -f notes/login.md --repo ~/src/shop
```

### `kozo reorder`

```sh
kozo reorder <item> [--before <item>]
```

Moves an item before another in the order kozod starts work, or to the end without
`--before`. Items start in the order they arrived until you move one.

### `kozo issue`

```sh
kozo issue <item>
```

In GitHub mode, moves a local item that has no tasks yet to an Issue of its repository. The local
item is cancelled, and kozod takes the Issue up as a new item.

## Reading what is going on

### `kozo ls`

```sh
kozo ls [inbox|items|tasks|runs] [--json]
```

Lists what waits for you, oldest first, or with an argument every item, task or run.

### `kozo show`

```sh
kozo show <ref> [-f] [--diff] [--json]
```

Shows an item, a task or a run. For an item awaiting plan approval it prints the drafted plan:
the work class, the risk tier, the approach, what the tasks share and each task's goal, with any
codemod a task would run.

| Flag     | Meaning                                                                                 |
| -------- | --------------------------------------------------------------------------------------- |
| `-f`     | Prints the subject's latest 400 events, then keeps following its events as they happen. |
| `--diff` | Prints a task's diff against the default branch.                                        |

### `kozo report`

```sh
kozo report [--days <n>] [--review | --cost] [--json]
```

The metrics and failures of the last `<n>` days (30 by default) and the promotion proposals.
`--review` adds each class's autonomy level, the demotions, the cost and what the merged tasks'
implementers noticed out of their scope and left, which `kozo add` makes an item; `--cost`
lists each day's cost against the daily budget.

## Answering and deciding

### `kozo approve` / `kozo reject`

```sh
kozo approve <item> [text]
kozo reject <item> <reason>
```

`approve` accepts the start or the plan that the item waits for; the optional text goes to the
next agent as a note. `reject` sends a plan back with the reason, and the plan agent redrafts it.
A plan rejected a second time waits for your attention.

### `kozo say`

```sh
kozo say <ref> <text>
kozo say --ask <ref> <question>
```

Answers the question an item or a task waits on. When nothing waits on an answer, the text
becomes an instruction: a running run reads it at its next turn, and every later run of that
item or task receives it too.

With `--ask`, the explorer agent answers a question about the item, task or run from its records,
without touching the work.

```sh
kozo say K-3 "Use the existing date helper in src/lib/date.ts"
kozo say --ask K-3/t1 "Why did review ask for a revision?"
```

### `kozo retry`

```sh
kozo retry <ref> [text]
```

Clears an attention or question hold and tries again: a task from its last checkpoint, an item
from its plan. The optional text goes to the next run as an instruction. A task held in Handoff
after spending its fix rounds goes back to Building with them given back.

### `kozo close`

```sh
kozo close <ref> --done
kozo close <ref> --cancel <reason>
```

Completes an item or a task that needed no change, or cancels it with a reason. Cancelling a
task deletes its branch.

## Stopping and taking over

### `kozo pause` / `kozo resume`

```sh
kozo pause [ref] [--now]
kozo resume [ref]
```

Without a reference, pauses or resumes the whole factory: while it is paused, nothing new starts
and running runs finish. With a reference, holds that item, task or run: it stops at its next
node, or at once with `--now`.

### `kozo take` / `kozo return`

```sh
kozo take <task>
kozo return <task> <text>
```

`take` hands a task to you: its run stops, and you commit in its worktree on its task branch;
the command prints both. `return` gives it back once your work is committed and the worktree is
on the task branch again. The text says what you changed and checked; the task then runs every
check from the deterministic ones on, against your commits.

## Setting up

### `kozo check`

```sh
kozo check [path] [--json]
```

Checks the factory definition, each repository's Charter, constraints and verify-app, `claude`
with its flags and sign-in, gh's sign-in in GitHub mode, and the sandbox. With a path, checks only the factory definition or
the `.kozo/` directory there, which suits a repository's CI.

### `kozo admin`

```sh
kozo admin init [--json]
kozo admin install <path> [--json]
kozo admin db-rebuild
kozo admin eval add <run> [--json]
kozo admin eval run [<case>...] [--json]
kozo admin prune --older-than <days> [--dry-run] [--json]
```

| Command                     | What it does                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`                      | Creates the factory definition in `~/.kozo/factory` from kozo's template and commits it.                                                                              |
| `install <path>`            | Adds kozo's files to a repository. In GitHub mode, kozod opens them as a pull request instead.                                                                        |
| `db-rebuild`                | Rebuilds `kozo.db` from the event logs.                                                                                                                               |
| `eval add <run>`            | Drafts an eval case from a run's item into the factory definition's `evals/`.                                                                                         |
| `eval run [<case>...]`      | Runs the eval cases, or the named ones, each in a throwaway factory home, and prints the share that reached the expected outcome and the cost.                        |
| `prune --older-than <days>` | Removes all but the event log, the report, the verdicts and the decision log of every run whose item closed at least that many days ago. `--dry-run` lists them only. |

## Verification commands

kozod runs these on each task; you can also run them by hand in a worktree or a clone. They need
no kozod. A `<ref>` after `--base` or `--head` is a full commit ID, `HEAD`, a full ref such as
`refs/remotes/origin/main`, or a branch name.

| Command                                                           | Layer | What it does                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kozo gates [--level fast\|full\|deep] [--base <ref>]`            | V1    | Runs the gates of one level, `full` by default. With `--base`, takes the constraints from the tip of that ref instead of the worktree.                                                          |
| `kozo diff-guard --base <ref> [--head <ref>] [--scope <glob>]...` | V2    | Checks the diff from the merge base of `<ref>` to `--head` (default `HEAD`) against the Charter and constraints at the tip of `<ref>`.                                                          |
| `kozo prove --base <ref> [--preserve]`                            | V3    | Requires the changed tests to pass at `HEAD` and to fail with the non-test changes reverted; with `--preserve`, to keep passing, for a change that keeps behaviour. The worktree must be clean. |
| `kozo review --base <ref> --goal <text> --done-when <text>...`    | V4    | Judges the diff in a separate `claude` session that sees only the diff, the goal, the conditions and the repository's AGENTS.md at `--base`.                                                    |
| `kozo verify --base <ref> --goal <text> --done-when <text>...`    | V5    | Runs the app by `.kozo/verify-app.md` in a sandboxed `claude` session and exercises each condition.                                                                                             |

`review` and `verify` also take `--model <id>`, `--max-cost <usd>` and `--out <dir>`, which
records the verdict, and for `verify` the evidence, in that directory. Every verification command
takes `--json`.
