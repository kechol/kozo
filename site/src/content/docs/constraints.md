---
title: Constraints
description: Every key of .kozo/constraints.yml, the commands that check a change, and the environment those commands run in.
---

The constraints, `.kozo/constraints.yml`, tell kozo how to check a change in one repository: the
gates, the commands that prepare a worktree, and how to tell tests apart. Like the Charter, kozo
reads them from the tip of the default branch, never from a diff.

```yaml
version: 1
services: ['docker compose up -d db']
teardown: ['docker compose down -v']
ports: 1
prepare: ['bun install --frozen-lockfile']
tests: ['**/*.test.*']
generated: ['bun.lock']
gates:
  lint:
    run: bun run check
  typecheck:
    run: bun run typecheck
  test:
    run: bun test
  e2e:
    run: bun run e2e
levels:
  fast: [lint, typecheck]
  full: [lint, typecheck, test]
  deep: [lint, typecheck, test, e2e]
prove:
  - files: ['**/*.test.ts']
    run: bun test {files}
```

## Keys

| Key         | Default | Meaning                                                                                                          |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `version`   |         | Always `1`.                                                                                                      |
| `services`  | `[]`    | Commands that start what the gates need and kozo's sandbox cannot run, such as a database container.             |
| `teardown`  | `[]`    | Commands that stop what `services` started. Only evals run them, after each case.                                |
| `ports`     | `0`     | How many ports, up to 20, each worktree's services and checks take, so that several worktrees can check at once. |
| `prepare`   | `[]`    | Commands that set up a fresh worktree, such as installing dependencies.                                          |
| `tests`     |         | Globs of the repository's test files. Required.                                                                  |
| `generated` | `[]`    | Globs of files a tool writes, such as lockfiles.                                                                 |
| `together`  | `[]`    | Paths that change together, each a `when` and an `also` list of globs.                                           |
| `gates`     |         | The gates, by name.                                                                                              |
| `levels`    |         | Which gates each level runs.                                                                                     |
| `prove`     | `[]`    | How to run changed test files.                                                                                   |

## Gates and levels

Each gate has a name of lowercase letters, digits and `-`, and one key, `run`, the shell command.
A gate passes when its command exits 0.

`levels` lists the gates of `fast`, `full` and `deep`, each run in order up to the first failure.
The plan's risk tier picks the level: low runs `fast`, normal `full`, high `deep`; a blueprint can
raise it, and the final verification before handoff always runs `deep`. A level that a task needs
but the constraints leave out holds the task for your attention.

## `tests` and `generated`

`tests` is how kozo tells tests from other files: diff-guard, prove and the Charter's
`existing_tests_protected` use it alone.

`generated` files count apart from the Charter's line and file limits. Every other check still
sees them: scope, protected paths, review and prove.

## `together`

Each entry names paths that change together, such as an API and its documentation:

```yaml
together:
  - { when: ['src/api/**'], also: ['docs/api/**'] }
```

kozo refuses a plan in which a task may change a path under `when` while no task may change one
under `also`, and diff-guard refuses a diff that changes a file under `when` and none under
`also`, which waits for your answer as any refusal of diff-guard does.

## `prove`

Each entry has `files`, globs of test files, and `run`, a command that contains `{files}`. kozo
replaces `{files}` with the changed test files that match, quoted for the shell; each file runs
under the first entry that matches. When prove runs and the list is empty, the task waits for
your attention.

## `services`, `ports` and `teardown`

kozod runs `services` outside the sandbox, before prepare and again before every later run of the
worktree, in a checkout of the default branch kept beside the worktree. Each should start what is
not running and leave running services alone, as `docker compose up -d` does. A service that fails
holds the task for your attention.

With `ports` above 0, kozod picks that many free ports on `127.0.0.1` for each worktree and passes
them to every command, so each worktree's services listen on their own.

## The commands' environment

`prepare`, the gates, prove and codemods run in kozo's
[command sandbox](../security/#the-command-sandbox). Each gets only `PATH`, `HOME`, `USER`,
`LOGNAME`, `SHELL`, `LANG`, `LC_ALL`, `TERM` and a temporary `TMPDIR` of its own from kozod's
environment, and these variables:

| Variable                        | Value                                                           |
| ------------------------------- | --------------------------------------------------------------- |
| `KOZO_TASK_ID`                  | A name unique to the worktree, such as for a container project. |
| `KOZO_PORT_1`, `KOZO_PORT_2`, … | The worktree's ports, when `ports` is above 0.                  |
| `KOZO_PORTS`                    | The same ports, separated by spaces.                            |
| `HTTPS_PROXY`, `HTTP_PROXY`     | For `prepare` only: kozod's proxy, its only way to other hosts. |
| `KOZO_EGRESS_PORT`              | For `prepare` only: the proxy's port.                           |

Each command may run for the Charter's `limits.max_minutes`; kozod then stops it, and it counts as
failed.

## `.kozo/verify-app.md`

The procedure the verify agent follows to check the app: how to start it, check that it is up,
drive it, collect evidence, and clean up. kozo reads it from the default branch and gives it to
verify with the task's goal and completion conditions. Without it, verify does not run, and
`kozo check` warns.

## `AGENTS.md`

kozo's agents do not load it as memory. The implement brief tells the agent to read it before
changing anything, and review judges every diff against it as it is on the default branch,
reading its first 12,000 characters. Describe there what an agent must know about the
repository: its modules, which may depend on which and where new code goes, the existing pieces
a change should reuse, its conventions, and how its tests run. A rule a tool can check, such as
the direction of imports, belongs in the constraints as a gate as well.
