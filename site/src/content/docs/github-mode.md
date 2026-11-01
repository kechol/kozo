---
title: GitHub mode
description: Take requests from GitHub Issues and hand back pull requests, with labels and comments that show what kozo does and what waits for you.
---

In GitHub mode, kozo takes its requests from the open Issues of your repositories and hands each
verified diff back as a pull request. You approve, answer and merge on GitHub or with `kozo`,
whichever is at hand. kozod still runs on your machine: it reads GitHub every five minutes and
opens no port, so there are no webhooks to set up.

## What changes from local mode

|                         | Local mode                 | GitHub mode                                                                |
| ----------------------- | -------------------------- | -------------------------------------------------------------------------- |
| Requests                | `kozo add` and automations | Open Issues, and `kozo add`                                                |
| Item reference          | `K-<n>`                    | `<repository>#<n>` for an Issue, such as `shop#42`; `K-<n>` for `kozo add` |
| Base of every task      | The local default branch   | `origin`'s default branch, fetched every five minutes                      |
| The diff                | A task branch you merge    | A pull request you merge                                                   |
| Installing kozo's files | Written into the clone     | Opened as a pull request                                                   |
| Automations             | Run                        | Do not run                                                                 |

kozod never moves a local branch in GitHub mode; it works only against `origin`.

## Set it up

### 1. Sign gh in

kozod reaches GitHub only through the [GitHub CLI](https://cli.github.com/), with gh's active
sign-in for github.com, and only with a fixed list of gh commands. Sign in as the account kozo
should act as:

```sh
gh auth login
gh auth status
```

kozod's comments, pushes and pull requests carry this account. It may be your own. Agents and
the commands kozo runs never see this sign-in.

### 2. Register the repositories

In `~/.kozo/factory/factory.yml`, set the mode and name each repository's GitHub counterpart. The
local clone's `origin` must point at it.

```yaml
mode: github
repositories:
  - { path: ~/src/shop, github: me/shop }
  - { path: ~/src/site, github: me/site, label: kozo }
```

| Key      | Meaning                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github` | `<owner>/<name>` of the repository. Required in GitHub mode. Two repositories may not share a name, since references leave the owner out.                           |
| `label`  | Optional. Only open Issues with this label become items. It may not start with `kozo:`.                                                                             |
| `locale` | Optional. The language of the comments, pull requests and label descriptions kozod writes here; `locale` in `factory.yml` when unset. Label names stay as they are. |

Commit the change, then restart kozod with `kozo down` and `kozo up`: kozod refuses a change of
mode while it runs.

### 3. Install kozo's files through a pull request

```sh
kozo admin install ~/src/shop
```

In GitHub mode kozod opens a pull request named **Install kozo** from the branch
`kozo/<factory ID>/install`. It adds the same files as in local mode, and
`.github/workflows/kozo.yml`, which runs `kozo check .` on every pull request. Before you merge
it:

1. Describe the repository in `AGENTS.md`.
2. Replace the commands in `.kozo/constraints.yml` and `.kozo/verify-app.md` with the
   repository's own.
3. Read every setting in `.kozo/charter.yml` and set `status: ready`.

kozo takes no Issue from the repository until the Charter on `origin`'s default branch is ready.

The pull request body also gives a `gh api` command that adds a ruleset named
**kozo: default branch**: no deletion, no force push, changes only through pull requests, and
`kozo check` as a required status check. kozod does not change repository settings; an
administrator runs the command if they want the ruleset.

### 4. Check

```sh
kozo check
```

In GitHub mode, `kozo check` reads each repository's `.kozo/` files from `origin`'s default
branch, and checks that gh is signed in to github.com, naming the account kozod will act as.

## Which Issues become items

On each pass kozod reads the open Issues of each repository, or only those with its `label`.
It never takes an Issue from a bot, or one labelled `kozo:paused`.

An Issue is trusted when its author may write to the repository (the write, maintain or admin
role) and opened it after the repository was registered. A trusted Issue follows the
[autonomy level](../concept/#autonomy-levels); any other Issue needs a start approval and a plan
approval at every level.

| Approval | On GitHub                                         | With kozo                                |
| -------- | ------------------------------------------------- | ---------------------------------------- |
| Start    | A user who may write adds the `kozo:accept` label | `kozo approve shop#42`, or the dashboard |
| Plan     | Not available                                     | `kozo approve shop#42`, or the dashboard |

Edits and closes on GitHub carry over:

- **An edited title or body** becomes the request for every run from then on. An edit by
  someone who may not write, after the item started, holds it for your attention; `kozo retry`
  takes the new text.
- **An Issue closed as completed** by a writer completes the item. One closed as not planned or
  as a duplicate, by a writer or its author, cancels the item and its open tasks. Any other close
  holds the item for attention.

## Labels

kozod creates these labels in each repository and keeps the stage and waiting labels in step
with each item:

| Label                            | Set by | Meaning                                                                                                                                              |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kozo:intake` … `kozo:cancelled` | kozod  | The item's stage: intake, triage, planning, building, reviewing, handoff, complete or cancelled. While tasks are open, the earliest of their stages. |
| `kozo:needs-approval`            | kozod  | A start or plan approval waits for you.                                                                                                              |
| `kozo:needs-question`            | kozod  | A question waits for your answer.                                                                                                                    |
| `kozo:needs-attention`           | kozod  | An item or task waits for your attention.                                                                                                            |
| `kozo:accept`                    | You    | Approves the start of an Issue that waits for one.                                                                                                   |
| `kozo:paused`                    | You    | Pauses the whole factory while the Issue is open. Labelled by a user who may write.                                                                  |

kozod adds and removes only the stage and `needs` labels; the other labels on an Issue are yours.

## Comments

kozod keeps one **status comment** on each Issue it works on and rewrites it as things change: the
stage, what the item waits for, each task with its stage and pull request, and the cost so far.

When a question comes up, kozod comments it on the Issue. Answer with a reply there, if you may
write to the repository, or with `kozo say shop#42 "<answer>"`. kozo takes the first reply from a
writer after the question, and passes it to the agents as data, not as instructions.

kozod also comments when a task is ready for your review and merge, with its pull request. Text
from agents in comments and pull requests cannot mention anyone or close an Issue: kozod breaks
mentions and closing keywords.

## Pull requests

Once a task has passed every check, kozod pushes its branch, `kozo/<factory ID>/<n>-t<t>` where
`<n>` is the Issue number, and opens a pull request against the default branch. Its title is the
task's goal, its body is the handoff report followed by `Part of #<n>`, and it is ready for review.

kozod then follows the pull request:

| On GitHub                            | What kozod does                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You merge it, by any merge method    | Runs the gates on the merged default branch and completes the task; once every task is complete, it completes the item and closes the Issue.                    |
| A writer requests changes            | Sends the task back to Building with the review's text as an instruction.                                                                                       |
| A check fails                        | Sends the task back to Building, up to the Charter's `limits.ci_fix_rounds` times; after that, holds it for your attention. `kozo retry` gives the rounds back. |
| Someone pushes commits to the branch | Takes them and runs review and verify again on them.                                                                                                            |
| You close it without merging         | Holds the task for your attention; `kozo retry` opens a new pull request.                                                                                       |

Merging the pull request does not close the Issue by itself. kozod closes it once the item is
complete, after the gates pass on the merged default branch.

## Moving a local item to an Issue

```sh
kozo issue K-7
```

Opens an Issue with the item's title and request in its repository, with the repository's label
if one is set, and cancels the local item. kozod takes the Issue up on its next pass as a new
item. The item must be open, have no tasks yet, and belong to a repository with `github:`.

## What kozod can do on GitHub

kozod refuses every gh command outside a fixed list before it runs. The list lets it read Issues,
their events and a user's permission; create its labels; add and remove labels; comment and edit
its own comments; open an Issue for `kozo issue`; close an Issue as completed; open pull requests
and rewrite their body; and read pull requests and their checks. Git reaches GitHub only to fetch,
push and list `origin`'s refs. There is no merge, no change of repository settings, and no
free-form API call.
