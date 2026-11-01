---
title: Operating kozo
description: Where kozo keeps its data, how it notifies you, how the budget and pauses work, how to stop, upgrade and remove it, and what to check when something goes wrong.
---

kozo is meant to run unattended for days. This page covers what keeps it running and what to do
when it stops.

## Where kozo keeps its data

Everything lives in `~/.kozo`, or in the directory `KOZO_HOME` names.

| Path                      | What it holds                                                                                                                | Can it be rebuilt?                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `events.jsonl`            | The factory's own event log.                                                                                                 | No                                       |
| `runs/<run>/events.jsonl` | Each run's event log.                                                                                                        | No                                       |
| `items/<item>.md`         | Each item's request, as it was written.                                                                                      | No                                       |
| `factory/`                | The factory definition, your own git repository.                                                                             | It is yours                              |
| `kozo.db`                 | The SQLite index the local API reads.                                                                                        | Yes: rebuilt at every start              |
| `api.token`               | The token the CLI uses, readable by you only.                                                                                | Yes: delete it and kozod makes a new one |
| `kozod.log`               | What kozod prints, such as why it refused to start.                                                                          | Not needed                               |
| `items/<item>/`           | Each task's handoff report and the log of the gates run after the merge.                                                     | No                                       |
| `runs/<run>/`             | Besides the log: the brief, the run report, the verdicts, the decision log, the evidence, long tool output and command logs. | No                                       |
| `worktrees/`              | Each open task's worktree.                                                                                                   | Removed when the task closes             |

The event logs are the record that everything else is built from. Each is chained line by line
and sealed when its run ends, and kozod refuses to start when a sealed log is missing or edited.
Never edit or delete them by hand; prune old runs instead (below).

Agent sessions keep no transcripts of their own; the run's event log records each message and
tool call. Nothing in `~/.kozo` is rotated or capped, so the run directories grow with use.

## Notifications

kozod notifies you through the operating system when you must act:

- A task is ready for your review and merge.
- kozod holds an item or a task for your approval, answer or attention.
- An approval has waited two, four or six days.
- The day's spending crosses 50, 80 and 100 percent of the daily budget.
- The factory paused on its own.
- kozod refused a new factory definition.
- kozod lowered a class's autonomy level.

macOS shows them in Notification Center; Linux shows them through `notify-send` when it is
installed. Set `KOZO_NOTIFY=off` in kozod's environment to turn them off.

## The budget

`budget.daily_usd` in `factory.yml` caps what a factory home spends in a day, counted from local
midnight across every session.

- **Reaching it stops only new starts.** Running sessions finish, and tasks that would start wait
  with a capacity hold that kozod clears the next day.
- **Running work counts in advance.** Each piece of running work reserves its repository's
  `limits.max_cost_usd`, so kozod starts nothing that could take the day past the budget.
- **One session is capped too.** The Charter's `limits.max_cost_usd` caps each agent session,
  review and verify included.
- **The explorer is refused** (`kozo say --ask`) once the day's budget is spent.

`kozo report --cost` lists each day's cost against the budget. `kozo status --line` prints one
line for a status bar, with today's cost:

```text
kozo: up local · 1 running · 2 waiting · $3.40 today
```

## Pausing

| Pause                      | How                                                     | What it does                                      |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| The factory                | `kozo pause`, or **Pause factory** in the dashboard     | Nothing new starts. Running work finishes.        |
| One item, task or run      | `kozo pause <ref>`                                      | It stops at its next step.                        |
| One item, task or run, now | `kozo pause <ref> --now`, or **Pause** in the dashboard | Its session and its running command stop at once. |

`kozo resume`, with or without a reference, undoes each.

kozod pauses the factory on its own when three sessions in a row fail on the Claude API, and in
GitHub mode when a writer labels an open Issue `kozo:paused`. `kozo status` shows the reason. A
refused factory definition does not pause anything: kozod keeps running the last one it applied.

## Stopping and restarting

`kozo down` asks kozod to stop and waits up to 15 seconds. kozod stops every agent session, lets
each task stop at its next step with a checkpoint, and exits. After the next `kozo up`, each task
continues from where it stopped.

If kozod was killed instead, by a crash or a power loss, it marks the runs it lost at its next
start and resumes their tasks from the last step they entered. An implement session cut off
mid-way holds its task for your attention; `kozo retry` continues it.

## Upgrading

Stop kozod before you replace the executables, then start the new one:

```sh
kozo down
brew upgrade kozo
kozo up
```

kozod runs its workers from its own executable, so a kozod left running across an upgrade would
start workers from the new one. `kozo --version` and `kozod --version` print the versions, and
every run records the version that ran it.

## Pruning old runs

```sh
kozo admin prune --older-than 30 --dry-run
kozo admin prune --older-than 30
```

For every run whose item closed at least that many days ago, `prune` keeps the event log, the run
report, the verdicts and the decision log, and removes the rest: the brief, the evidence, long
tool output and command logs. It leaves `items/` alone. `--dry-run` lists what it would remove.
kozod must be running.

## Rebuilding the index

`kozo.db` is rebuilt from the event logs every time kozod starts, so a restart is enough when the
index seems wrong. `kozo admin db-rebuild` does the same without a restart.

## Removing kozo

1. Stop kozod with `kozo down`, and uninstall the executables (`brew uninstall kozo`).
2. In each repository, remove the task branches and the worktree records git keeps for them:

   ```sh
   git worktree prune
   git branch --list 'kozo/*'
   git branch -D <branch>...
   ```

3. Remove `~/.kozo`, which also removes the factory definition unless you keep a copy.
4. Remove kozo's files from each repository if you no longer want them: `AGENTS.md`,
   `CLAUDE.md`, `.kozo/`, and in GitHub mode `.github/workflows/kozo.yml`.
5. In GitHub mode, also delete the `kozo/*` branches on GitHub, the `kozo:` labels, and the
   ruleset if you added it.

kozo keeps the branch of every completed task, so step 2 is also how you tidy up while it runs.

## When something goes wrong

### kozod does not start

`kozo up` says so and points at `~/.kozo/kozod.log`, which gives the reason:

| Message                                                                          | What to do                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `sandbox-exec does not run`, `bwrap does not run`, `bubblewrap is not installed` | Make the sandbox work; `kozo check` shows what it lacks. On Linux, allow user namespaces. |
| `kozod is already running as pid <n>`                                            | Another kozod serves this home. Use it, or stop it with `kozo down`.                      |
| `... does not match its seal`, `... is missing; it was sealed at ...`            | An event log was edited or removed. Restore it from a backup.                             |
| `the factory definition is invalid`                                              | Run `kozo check` and fix the definition.                                                  |
| `api.token is readable by others`                                                | Run `chmod 600 ~/.kozo/api.token`.                                                        |

### Something is stuck

1. `kozo ls` shows what waits for you, and `kozo status` whether the factory is paused and why.
2. `kozo show <ref>` shows the stage and the hold with its reason; `kozo show <ref> -f` follows
   it as it moves.
3. `kozo say --ask <ref> "<question>"` asks the explorer, which reads the records and answers
   without touching the work.
4. Each run's directory under `~/.kozo/runs/` holds its command and gate logs.

`kozo check` reports what is wrong with the setup; it changes nothing.

## Evals

An eval case replays a past request against the factory definition, to see whether a change to
the agents or the blueprints still reaches the same outcome.

- `kozo admin eval add <run>` drafts a case from a run's item into
  `~/.kozo/factory/evals/<repository>-<item>.yml`. Add hidden tests and checks to it, then commit
  it.
- `kozo admin eval run` runs every case, or the named ones, each in a throwaway factory home on a
  clone of the repository, and prints how many reached the expected outcome and what they cost.
  Their cost does not count toward the factory's daily budget.
