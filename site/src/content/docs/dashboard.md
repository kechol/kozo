---
title: Dashboard
description: Open the dashboard, clear the inbox, follow work on the board, and act on an item, a task or a run from its detail view.
---

The dashboard is a local web page that kozod serves. It shows the same state as `kozo` and
calls the same local API, so anything you do in one shows in the other. It holds no state of
its own.

## Open it

```sh
kozo dashboard
```

This opens `http://127.0.0.1:7420/` in your browser with a one-time code in the address. The page
trades the code for a session for that tab and removes it from the address at once. The code
works once, within a minute; `kozo dashboard --url` prints the address instead of opening it.

- **Each tab has its own session.** A new tab shows how to open one; run `kozo dashboard`
  again.
- **A session lasts while you use it.** It ends after 24 hours without a request, and whenever
  kozod restarts. The page then says the session ended; open a new one the same way.
- **When kozod does not answer**, a banner under the header says since when the page shows old
  state. The page tries again every few seconds, and **Try now** tries at once.
- **The API token never reaches the browser.** kozod answers only on `127.0.0.1`, and only to
  requests for `127.0.0.1` or `localhost` on its own port.

The page refreshes every three seconds while it is visible. The events of a detail view stream as
they happen.

## The header

The header links to the **Inbox**, with the number of what waits for you, and to the **Board**.
Beside them it shows the factory:

- **Running** or **Paused**, with the reason for a pause.
- **The runs now running.** Open it to list each run, its agent, and what it works on.
- **Today's cost**, and the mode, `local` or `github`.
- **Pause factory** or **Resume factory**. While the factory is paused, nothing new starts, and
  running runs finish.

## Inbox

The inbox lists what waits for you, oldest first, which is what `kozo ls` prints. Each row shows
why it waits, the title, the reference, how long it has waited, and its repository when kozo
works in several.

| Row            | Verbs                                                                                |
| -------------- | ------------------------------------------------------------------------------------ |
| Start approval | **Approve start…**, **Cancel…**                                                      |
| Plan approval  | **Read the plan**, which opens the item, then **Approve plan…** and **Reject plan…** |
| Question       | **Answer…**, and for a task **Take it over**                                         |
| Attention      | **Retry…**, for a task **Take it over**, **Close as done…**, **Cancel…**             |
| Ready to merge | **Read the diff**, which opens the task                                              |

- **A verb whose label ends in "…" asks for something first.** It opens a text field in place
  of the button, and Cmd+Enter or Ctrl+Enter sends it. Escape and **Back** close it. Text is
  required where the verb needs it: an answer, or the reason for rejecting a plan.
- **Closing verbs confirm in a dialog.** **Cancel…** names what goes with the item or task (its
  runs, its worktrees and its branches) and asks why. **Close as done…** says the item or task
  closes as Complete.
- **A row leaves the inbox once it is settled.** Focus then moves to the next row's first verb,
  so you can work down the list from the keyboard.
- **There is no merge button.** Merging is yours, in git or on GitHub.

## Board

The board shows every item, or with **Tasks** every task, as cards in stage columns from Intake
to Cancelled. The address keeps the view, so a link opens the same one.

- An item card shows its reference, its autonomy level, the title, any hold, the work class, and
  how many of its tasks are done, held or ready to merge.
- A task card shows its reference, its goal, any hold, whether it is ready to merge, and how many
  revisions review asked for.
- Complete and Cancelled are folded to their count; open one to see its ten newest cards.
- The arrows on an item card move it one place up or down in the order kozod starts work, as
  `kozo reorder` does.
- In local mode, **New item** opens a dialog with the title, the request, the repository when
  there are several, and the work class, which triage chooses unless you do. Closing the dialog
  keeps what you typed until you add the item.

## Detail view

Selecting a reference opens its detail view, with the path from item to task to run above the
title. The verbs sit under the title, after any hold's reason; the ones you seldom need, such as
Pause, Take it over, Close as done and Cancel, sit behind **More**.

### Item

The item's page starts with the request as it was written, then the plan: the drafted one while
it waits for your approval, or the accepted one. Each shows the approach, the completion
conditions and the tasks. A list of its tasks follows.

### Task

A task ready to merge starts with what the merge needs: the branch, the base and the repository,
a button that copies the branch name, the handoff report, and the diff, already open. Under them
come the run report, the review's verdict and findings, verify's verdict and evidence, the
completion conditions, the blueprint the task followed, and the agents' decision log.

A task still in progress shows the same sections, led by its completion conditions, with the
diff last; **Show the diff** reads it. The dashboard cuts a long diff short; `kozo show --diff`
prints all of it.

| State     | Verbs                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| Working   | **Instruct…**, which reaches the running run at its next turn and every run after it, **Pause** |
| Question  | **Answer…**, **Take it over**, **Cancel…**                                                      |
| Attention | **Retry…**, **Instruct…**, **Take it over**, **Close as done…**, **Cancel…**                    |
| Taken     | **Give it back…**, once your work is committed, **Cancel…**                                     |

Pause in the detail view stops the work at once, as `kozo pause --now` does.

### Run

A run's page shows its agent, its model, when it started and ended, and its cost. While it
runs, **Instruct…** and **Pause** act on its task or item.

### Events and properties

Every detail view ends with its events, newest first and grouped by run. The properties beside
the body list the repository, the class, the risk tier and the level of an item; the scope, the
dependencies and the branch of a task; and the cost and the runs of each.

## What only the CLI does

The dashboard covers the daily work. A few things stay in the command line:

- Asking the explorer about the work: `kozo say --ask`.
- Moving an item to a GitHub Issue: `kozo issue`.
- Moving an item before any other in one step: `kozo reorder --before`.
- Pausing an item or a task at its next node rather than at once: `kozo pause` without `--now`.
- Reports, setup and maintenance: `kozo report`, `kozo check` and `kozo admin`.
