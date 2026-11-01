---
title: Factory definition
description: The keys of factory.yml and the agents, skills, blueprints, automations and eval cases in ~/.kozo/factory, and how kozod applies a change.
---

The factory definition is the git repository at `~/.kozo/factory` that `kozo admin init`
creates. It holds the settings for the whole machine and everything the agents follow:

```text
~/.kozo/factory/
├── factory.yml
├── agents/<name>/agent.md      triage, plan, implement, review, verify, explorer
├── skills/verify-app/SKILL.md
├── blueprints/<class>.yml      docs, deps, bugfix, refactor, perf, migration, feature
├── automations/<name>.md
└── evals/<case>.yml
```

## How a change applies

kozod reads the whole definition from the commit at the tip of the repository's default branch,
not from the working files, and checks for a new commit once a minute.

- **A valid tip applies.** kozod records it and uses it for every new piece of work.
- **An invalid tip is refused.** kozod reports why, notifies you, and keeps running the
  definition it last applied. `kozo check` shows the same errors before you commit.
- **At start**, kozod uses the tip if it is valid, otherwise the definition it last applied, and
  refuses to start when neither is.
- **A missing file falls back to kozo's built-in template** of the same path, except
  automations, of which only the definition's own files count.

## `factory.yml`

Every key is checked strictly: an unknown key is an error. A key you leave out takes its default,
and an object you write replaces the default object as a whole.

| Key                     | Default             | Meaning                                                                                                                                                                                 |
| ----------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`               | `1`                 | The format version. Always `1`.                                                                                                                                                         |
| `mode`                  | `local`             | `local` or `github`; see [GitHub mode](../github-mode/). kozod applies a change of mode only when it starts again.                                                                      |
| `runtime`               | `sdk`               | How agents run your `claude`: `sdk` through the Agent SDK, or `cli` as `claude -p`. Review and verify always use the Agent SDK.                                                         |
| `locale`                | `en`                | The language of kozo's notifications and of what it records in its own words, such as the reasons for holds, stage changes and runs: `en` or `ja`. It applies without restarting kozod. |
| `repositories`          | `[]`                | The local clones kozo works in.                                                                                                                                                         |
| `repositories[].path`   |                     | The clone's path; `~` is expanded.                                                                                                                                                      |
| `repositories[].github` |                     | In GitHub mode, `<owner>/<name>`. Required there, and two repositories may not share a name.                                                                                            |
| `repositories[].label`  |                     | In GitHub mode, only open Issues with this label become items. It may not start with `kozo:`.                                                                                           |
| `agent_defaults.model`  | `claude-sonnet-5-5` | The model every agent uses unless another key names one.                                                                                                                                |
| `agents.<name>.model`   |                     | The model of one agent, which wins over its `agent.md` and `agent_defaults`.                                                                                                            |
| `concurrency`           | `1`                 | How many runs, checks and drafts kozod runs at once, across every repository.                                                                                                           |
| `budget.daily_usd`      | `15`                | The cap on a day's spending, counted from local midnight; see [Operating kozo](../operations/#the-budget).                                                                              |
| `prepare_hosts`         |                     | Hosts that prepare may reach besides the package registries, as a name or a `*.` suffix, such as a registry mirror. Applies without a restart.                                          |

```yaml
version: 1
mode: local
runtime: sdk
locale: en
repositories:
  - { path: ~/src/shop }
agent_defaults:
  model: claude-sonnet-5-5
agents:
  review: { model: claude-opus-5-5 }
concurrency: 2
budget:
  daily_usd: 20
prepare_hosts: [npm.example.com]
```

## Agents

Each `agents/<name>/agent.md` defines one agent. Its body becomes the session's system prompt,
and its front matter takes three keys:

| Key           | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `name`        | The agent's name. Required.                                         |
| `description` | One line on what it does. Required.                                 |
| `model`       | Optional model, used unless `factory.yml` names one for this agent. |

The tools an agent gets are fixed by kozo, not by its definition: implement, triage and plan work
with files and the shell inside their worktree, triage and plan without writing; review and the
explorer are judges without tools; verify uses the shell only.

## Skills

kozo reads one skill, `skills/verify-app/SKILL.md`, and adds its body to the verify agent's
instructions. Its front matter takes `name`, `description` and
`disable-model-invocation: true`.

## Blueprints

`blueprints/<class>.yml` sets how a task of that work class moves from Building to Handoff. A
class without a blueprint uses bugfix's.

| Key         | Meaning                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`   | Always `1`.                                                                                                                                                                                                                     |
| `nodes`     | The steps, always in this order: `claim`, `prepare`, `brief`, `implement`, `verify-deterministic`, `review`, `verify-app`, `handoff`, `final-verify`. Every node is required; whether verify runs is the risk tier's to decide. |
| `reproduce` | `true`: the changed tests must fail without the change. `false`: work that keeps behaviour, whose added tests must pass without the change too.                                                                                 |
| `gates`     | Optional minimum gate level, `fast`, `full` or `deep`, whatever the risk tier.                                                                                                                                                  |

## Automations

An automation adds an item on a schedule, in local mode only. Each is a Markdown file in
`automations/`:

```markdown
---
version: 1
schedule: '0 3 * * *'
class: bugfix
---

# Fix one error that the code swallows

What to change and why.
```

| Key          | Meaning                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `version`    | Always `1`.                                                                                                                  |
| `schedule`   | Five-field cron in kozod's local time: numbers, `*`, lists, ranges and steps. A minute kozod was not running is not made up. |
| `repository` | The repository's path as registered. Optional when only one is registered.                                                   |
| `class`      | Optional work class.                                                                                                         |

The body starts with `# <title>`; the rest is the request. An automation's item always waits for
your start and plan approvals, and none is added while an open item has the same title.

`kozo admin init` installs and commits one automation, `nightly-habit.md`, which asks every night
at 03:00 for one swallowed error to be fixed. Delete the file and commit to stop it.

## Eval cases

`evals/<case>.yml` describes a past request and the outcome it should reach. `kozo admin eval add`
drafts one from a run; see [Operating kozo](../operations/#evals).

| Key                                  | Meaning                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `version`                            | Always `1`.                                                                |
| `id`                                 | The case's name: lowercase letters, digits, `.`, `_` and `-`.              |
| `repository`, `start`                | The repository and the commit the case starts from.                        |
| `request`                            | The title and body, or for an Issue its title, URL and the body's SHA-256. |
| `expected.outcome`                   | `complete`, `question`, `split` or `attention`.                            |
| `expected.hidden`, `expected.checks` | Tests and commands that the agents never see, run on the result.           |
