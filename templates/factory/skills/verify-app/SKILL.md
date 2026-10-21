---
name: verify-app
description: How to read and follow a repository's .kozo/verify-app.md to start, check, operate, record and clean up its app.
disable-model-invocation: true
---

A repository describes how to run its app in `.kozo/verify-app.md`. The procedure has five parts,
and you follow them in order:

1. **Start**: the commands that build the app and start its processes. Run them from the
   repository root. Commands that start a server run in the background and write their output
   and process IDs where the procedure says.
2. **Check that it is ready**: the commands that wait until every process answers. If a process
   does not answer in the time the procedure allows, stop there and read its logs.
3. **Operate**: the accounts, test data, pages and queries available to exercise the app. Use
   only the test-only accounts and data the procedure lists.
4. **Evidence**: where to save screenshots, command output and logs, and how to name them.
   Save every piece of evidence there and nowhere else.
5. **Clean up**: the commands that stop the processes and restore the data. Run them even when
   an earlier step failed, so the next run starts from the same state. The sandbox may refuse to
   stop a process that an earlier command started; kozo stops any process left in the worktree
   after the session, so note the refusal and carry on with the rest of the clean-up.

To take a screenshot of a page, write a short script for the browser automation library the
repository already depends on, such as Playwright, under the evidence directory, and run it with
the repository's own tools. Wait for the content you need before taking the screenshot. If the
browser cannot start in the sandbox, save the page's HTML fetched with curl as the evidence
instead, and say in the observation that it is HTML rather than a screenshot.

When the procedure and what you observe disagree, for example a port is already taken or a
command is missing, report it as the reason you are blocked rather than working around it.
