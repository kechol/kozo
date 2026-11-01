---
title: Security model
description: What kozo's agents and commands can read, write and reach on your machine, what they can never do, and how requests and the local API are guarded.
---

kozo runs agents and the commands of your repositories unattended, on your own machine, with your
own `claude`. Its design keeps three things true whatever an agent writes or a request says:

- **Humans always merge.** Nothing in kozo can merge.
- **Agents and commands stay inside the task's worktree.** They hold no credentials and reach no
  host but this machine.
- **Only kozod acts outside.** It pushes and opens pull requests, and only after every check has
  passed.

## Two layers around every agent

Every tool call an agent makes passes two checks before it runs.

### The guard

kozo's guard decides each tool call in the worker, before Claude Code runs it:

- **File tools** may read and write only inside the worktree, never under `.git`, and never
  through a symbolic link or a hard-linked file.
- **Writes** are refused outside the task's scope, on a protected path, and on an existing test
  when the Charter protects them. Triage and plan sessions write nothing.
- **Shell commands** are parsed into every command they run, through `sh -c`, `eval`, scripts in
  the worktree and similar wrappers. The guard refuses background jobs; `gh`, `ssh`, `docker`,
  `sudo`, `open`, `osascript`, `crontab` and `kozo` itself; and git's `push`, `pull`, `fetch`,
  `merge`, branch switching, config changes and any git subcommand it does not list.
- **Other tools** are refused, except kozo's own: noting a decision, asking a question, and
  running the gates.

### Claude Code's sandbox

Each session also runs with Claude Code's sandbox switched on, and fails rather than run without
it:

- **The network** reaches `localhost` and `127.0.0.1` only.
- **Reading** `~/.kozo` and credential paths is denied.
- **Writing** is allowed in the worktree and kozo's own branches, and denied for protected
  paths, existing tests, every other branch, tags, `HEAD`, git's config and hooks.

Sessions load no settings or memory from your Claude Code configuration, and keep no
transcript. Their environment carries only what `claude` needs to sign in, and the shell loses
even that.

After each run, kozod stops any process the run left in the worktree, and holds the task for your
attention if any git ref outside its branch moved.

## The command sandbox

The repository's own commands, prepare, the gates, prove and codemods, run in kozo's command
sandbox: Seatbelt through `sandbox-exec` on macOS, bubblewrap on Linux. kozod refuses to start
where it cannot apply it.

|         | Allowed                                                                                                         | Denied                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read    | The system, the worktree and its git directory, package caches, the tools on `PATH` and their configuration     | The rest of your home directory, `~/.kozo`, and credentials such as `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.npmrc`, `~/.netrc`, `~/.claude` and the keychains |
| Write   | The worktree, except `.git`, and a temporary directory of the command's own; prepare also writes package caches | Everything else                                                                                                                                               |
| Network | This machine only: the worktree's ports, and not kozod's API                                                    | Every other host                                                                                                                                              |

`prepare` alone may reach other hosts, and only through kozod's egress proxy on `127.0.0.1`. The
proxy tunnels HTTPS to the package registries (npm, Yarn, PyPI, crates.io, the Go proxy, GitHub's
downloads and Playwright's browsers) and to the hosts in `prepare_hosts`, and refuses the rest,
reporting each refused host once.

`services` and `teardown` run outside the sandbox, from the default branch, since they start
what the sandbox cannot, such as containers. Only humans change them, through the constraints on
the default branch.

## Requests are data

A request's body, an Issue's text, a reply on GitHub and a failed check's output reach agents
wrapped as untrusted data, `<request trust="untrusted">`, never as instructions. The diff that
review reads and the records the explorer reads are wrapped the same way.

In GitHub mode, trust also decides the approvals: an Issue from someone who may not write to the
repository needs your start and plan approvals at every level, and only a writer's reply answers
a question. Comments kozod writes cannot
mention anyone or close an Issue; see [GitHub mode](../github-mode/#comments).

## What only humans change

Agents never change these without asking you, because diff-guard turns any change to them into a
question and a plan that reaches them always needs your approval:

- The protected paths in the Charter, which by default cover `.kozo/`, `.github/`, `.claude/`,
  `AGENTS.md` and `CLAUDE.md`.
- Existing tests, when `existing_tests_protected` is on.

The Charter and the constraints are read from the default branch, never from the diff under
review, so a change cannot loosen the rules it is checked by.

## Pushes and GitHub

Only kozod pushes, only the head that passed the final verification after a rebase on the latest
default branch, and only to the task's branch, with `--force-with-lease`. It reaches GitHub
through `gh` with the account you signed in with, and refuses any gh command outside a fixed list,
which has no merge, no change to repository settings and no free-form API call. Workers never see
the sign-in. See [GitHub mode](../github-mode/#what-kozod-can-do-on-github).

## The local API

kozod's API listens on `127.0.0.1:7420` only, and opens no public port.

- **Every request needs a token**: the API token in `~/.kozo/api.token`, which kozod creates
  readable by you only and refuses to use when others can read it, or a dashboard session.
- **Requests must name `127.0.0.1` or `localhost`** on kozod's port as their host, and a write
  that carries an Origin must come from the same.
- **No CORS header is ever sent.**
- **A dashboard session starts from a one-time code** that only the API token can ask for, valid
  for a minute, and lasts while used, for that kozod process only.

## What kozo cannot protect

- Your `services` and `teardown` commands run unconfined, as you wrote them.
- An agent reads the whole worktree, including anything secret committed to the repository.
- The account `gh` is signed in as can do whatever that account may; kozod only limits the
  commands it runs.
- The review and the checks reduce the risk of a bad diff; reading the diff before you merge it
  is the last check.
