---
title: Quick Start
description: Set up kozo in local mode, take one request from your words to a merged diff, and stop the factory again.
---

This walkthrough takes one request through kozo in local mode: you add it, approve it, read the
diff and merge it yourself. It assumes kozo is installed and `claude` is signed in; see
[Installation](../installation/).

## 1. Create the factory definition

```sh
kozo admin init
```

This writes kozo's template into `~/.kozo/factory`, a git repository of its own, and commits it.
The factory definition holds `factory.yml`, the agents, the skills, the blueprints and the
automations. kozod reads it from the tip of that repository's default branch, so a change takes
effect only once it is committed.

## 2. Register a repository

kozo works in local clones. Add each one to `repositories` in `~/.kozo/factory/factory.yml`:

```yaml
repositories:
  - { path: ~/src/shop }
```

Then commit the change:

```sh
git -C ~/.kozo/factory commit -am "Work in the shop"
```

The repository needs a `main` or `master` branch, or an `origin/HEAD` that names its default
branch. kozo reads its files from the tip of that branch and starts every task from it.

## 3. Install kozo's files in the repository

```sh
kozo admin install ~/src/shop
```

This adds four files and leaves any that already exist alone:

| File                    | What to do with it                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`             | Instructions for kozo's agents; add what an agent must know about this repository. A `CLAUDE.md` link to it is added if there is none.      |
| `.kozo/charter.yml`     | What kozo may do here. Read every setting, then set `status: ready`.                                                                        |
| `.kozo/constraints.yml` | How kozo checks a change. Replace the `lint` and `test` gates with the repository's own commands, and add the install command to `prepare`. |
| `.kozo/verify-app.md`   | How the verify agent starts and drives the app. Without it, verify does not run.                                                            |

Commit them on the default branch, since kozo reads them from its tip:

```sh
cd ~/src/shop
git add AGENTS.md CLAUDE.md .kozo
git commit -m "Let kozo work here"
```

## 4. Check the setup

```sh
kozo check
```

It checks the factory definition, each repository's Charter and constraints, `claude` and its
sign-in, and the sandbox kozo confines commands with. Fix what it reports and run it again until
every check passes; a warning, such as a missing `verify-app.md`, does not stop kozod.

## 5. Start kozod

```sh
kozo up
```

`kozo up` starts kozod in the background and prints `kozod is up: http://127.0.0.1:7420`. kozod
writes its log to `~/.kozo/kozod.log`. `kozo status` shows what it is doing.

## 6. Add a request

```sh
kozo add "Fix the broken link in the cart page footer"
```

The first line is the item's title; any further lines, or the text of a file given with `-f`,
become its body. With several repositories registered, name one with `--repo <path>`. kozo
answers with the item's reference, such as `K-1`.

The Charter starts every work class at autonomy level L1, so the item waits for your start
approval, and `kozo add` exits with code 3 to say so.

## 7. Clear the inbox

`kozo ls` lists what waits for you, oldest first:

```sh
kozo ls
```

Approve the start, and the triage agent reads the repository and drafts a plan:

```sh
kozo approve K-1
```

At L1 the plan also waits for you. Read it with `kozo show K-1`, which prints the work class, the
risk tier, the approach and each task's goal, then approve it or send it back with a reason:

```sh
kozo show K-1
kozo approve K-1
# or
kozo reject K-1 "Keep the change to the footer template"
```

If an agent asks a question, `kozo ls` shows it; answer with `kozo say K-1 "<answer>"`.

To follow the work as it happens, run `kozo show K-1/t1 -f`, or open the dashboard with
`kozo dashboard`.

## 8. Read the diff and merge it

When a task has passed every check, it waits in the inbox for your merge. kozo writes a handoff
report for it to `~/.kozo/items/K-1/handoff-t1.md`, with why, what changed, what is out of scope,
why it is safe, and how it was verified. Read the diff:

```sh
kozo show K-1/t1 --diff
```

Merge the task branch into the default branch yourself. The handoff report ends with the exact
command, of this form:

```sh
git merge --no-ff kozo/<factory ID>/K-1-t1
```

kozod notices the merge within a minute, whether it was a merge, a rebase or a squash, runs the
gates once more on the merged default branch, and completes the task and then the item.

## 9. Stop the factory

```sh
kozo down
```

## Next steps

- [Concept](../concept/) explains items, tasks, holds and autonomy levels.
- `kozo` with no arguments lists every command.
